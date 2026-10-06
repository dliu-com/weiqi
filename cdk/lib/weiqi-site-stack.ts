import {projectConfig} from './project-config';
import * as fs from 'fs';
import * as path from 'path';
import {execFileSync} from 'child_process';
import { Construct } from 'constructs';
import {SqsEventSource} from 'aws-cdk-lib/aws-lambda-event-sources';
import {
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_events as events,
  aws_events_targets as eventTargets,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_s3 as s3,
  aws_sqs as sqs,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Size,
  Stack,
  StackProps,
} from 'aws-cdk-lib';

export class WeiqiSiteStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & {analysisQueueArnOverride?:string;keepLegacyAnalysisQueue?:boolean;storage?:{gameTable:dynamodb.ITable;libraryBucket:s3.IBucket}} = {}) {
    super(scope, id, props);

    const rootDomain = Fn.importValue('MainDomain');
    const domainName = Fn.join('', ['weiqi.', rootDomain]);
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
      zoneName: rootDomain,
      hostedZoneId: Fn.importValue('MainHostedZoneId'),
    });

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(7), abortIncompleteMultipartUploadAfter: Duration.days(1) }],
    });

    // Match the existing apps: CloudFront requires its certificate in us-east-1.
    const certificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
      domainName,
      hostedZone,
      region: 'us-east-1',
    });

    const cachePolicy = new cloudfront.CachePolicy(this, 'SiteCachePolicy', {
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.minutes(5),
      maxTtl: Duration.hours(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SiteResponseHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://files.dliu.com; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'", override:true},
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: false, override: true },
      },
    });

    const gameTable = props.storage!.gameTable;
    const libraryBucket = props.storage!.libraryBucket;
    const legacyAnalysisQueue = props.keepLegacyAnalysisQueue!==false?new sqs.Queue(this,'AnalysisQueue',{
      retentionPeriod:Duration.days(14), visibilityTimeout:Duration.minutes(3),
    }):undefined;
    const analysisQueue=props.analysisQueueArnOverride?sqs.Queue.fromQueueArn(this,'ImportedAnalysisQueue',props.analysisQueueArnOverride):legacyAnalysisQueue;
    if(!analysisQueue)throw Error('Provide the new queue before removing the legacy queue.');
    const root = path.join(__dirname, '..', '..');
    // Reuse the exact browser rules, and keep the deployed handler dependency-free.
    const engineSource = fs.readFileSync(path.join(root, 'src/engine.js'), 'utf8').replace(/^export /gm, '');
    const serviceSource = fs.readFileSync(path.join(root, 'backend/game-service.js'), 'utf8')
      .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    const sharedLibrarySource = ['src/sgf.js','src/recording-tree.js','backend/draft-service.js','src/ai-review.js','src/report-data.js','backend/library-service.js'].map(file => fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
    const queueEstimateSource=fs.readFileSync(path.join(root,'src/queue-estimate.js'),'utf8').replace(/^export /gm,'');
    const queueStatusSource=fs.readFileSync(path.join(root,'backend/queue-status.cjs'),'utf8');
    const libraryHandlerSource = fs.readFileSync(path.join(root,'backend/library-handler.cjs'),'utf8');
    const handlerSource = fs.readFileSync(path.join(root, 'backend/handler.cjs'), 'utf8');
    execFileSync(process.execPath,[path.join(root,'scripts/build-report-renderer.mjs')],{stdio:'inherit'});
    const reportDeadLetters=new sqs.Queue(this,'ReportDeadLetters',{fifo:true,retentionPeriod:Duration.days(14)});
    const reportQueue=new sqs.Queue(this,'ReportQueue',{fifo:true,visibilityTimeout:Duration.minutes(6),retentionPeriod:Duration.days(1),deadLetterQueue:{queue:reportDeadLetters,maxReceiveCount:3}});
    const reportRenderer=new lambda.Function(this,'ReportRenderer',{
      description:'Prepared bilingual Weiqi reports - renderer '+JSON.parse(fs.readFileSync(path.join(root,'backend/report-renderer/version.json'),'utf8')).version,
      runtime:lambda.Runtime.NODEJS_22_X,handler:'index.handler',memorySize:2048,
      timeout:Duration.minutes(5),ephemeralStorageSize:Size.gibibytes(1),
      logGroup:new logs.LogGroup(this,'ReportRendererLogs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:RemovalPolicy.DESTROY}),
      code:lambda.Code.fromAsset(path.join(root,'backend/report-renderer')),
      environment:{LIBRARY_BUCKET:libraryBucket.bucketName,SITE_BUCKET:bucket.bucketName},
    });
    reportRenderer.addEventSource(new SqsEventSource(reportQueue,{batchSize:1}));
    libraryBucket.grantRead(reportRenderer,'games/*');
    bucket.grantReadWrite(reportRenderer,'prepared-reports/*');
    const gameHandler = new lambda.Function(this, 'GameHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(20),
      memorySize: 256,
      logGroup: new logs.LogGroup(this, 'GameLogs', { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY }),
      environment: { DAILY_ANALYSIS_CAP:String(projectConfig.analysis.dailyGameLimit), AI_CONTROL_KEY:'control/ai-spending.json', LIBRARY_BUCKET:libraryBucket.bucketName, ANALYSIS_QUEUE:analysisQueue.queueUrl, TABLE_NAME: gameTable.tableName, REPORT_QUEUE:reportQueue.queueUrl, SITE_ORIGIN: Fn.join('', ['https://', domainName]) },
      code: lambda.Code.fromInline([engineSource, serviceSource, sharedLibrarySource, queueEstimateSource, libraryHandlerSource, queueStatusSource, handlerSource].join('\n')),
    });
    reportQueue.grantSendMessages(gameHandler);
    gameHandler.addToRolePolicy(new iam.PolicyStatement({actions:['batch:DescribeJobs','batch:ListJobs'],resources:['*']}));
    new events.Rule(this,'CompletedGameReport',{
      eventPattern:{source:['aws.batch'],detailType:['Batch Job State Change'],detail:{status:['SUCCEEDED'],jobName:[{prefix:'weiqi-'}]}},
      targets:[new eventTargets.LambdaFunction(gameHandler,{retryAttempts:2,maxEventAge:Duration.hours(1)})],
    });
    libraryBucket.grantReadWrite(gameHandler);
    analysisQueue.grantSendMessages(gameHandler);
    gameTable.grant(gameHandler, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Scan');
    const functionUrl = gameHandler.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    const recordRoutes=new cloudfront.Function(this,'RecordRoutes',{code:cloudfront.FunctionCode.fromInline(fs.readFileSync(path.join(root,'src/routes.cjs'),'utf8'))});
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        functionAssociations:[{eventType:cloudfront.FunctionEventType.VIEWER_REQUEST,function:recordRoutes}],
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy,
        responseHeadersPolicy: headers,
        compress: true,
      },
      additionalBehaviors: {
        'api/*': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: headers,
        },
      },
      domainNames: [domainName],
      certificate,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.seconds(30) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.seconds(30) },
      ],
    });

    // New function URLs require both invoke permissions. CDK adds InvokeFunctionUrl.
    gameHandler.addPermission('CloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: distribution.distributionArn,
      invokedViaFunctionUrl: true,
    });

    new route53.ARecord(this, 'SiteAliasRecord', {
      recordName: 'weiqi', zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });
    new route53.AaaaRecord(this, 'SiteAliasIpv6Record', {
      recordName: 'weiqi', zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new CfnOutput(this,'ReportQueueUrl',{value:reportQueue.queueUrl});
    new CfnOutput(this,'ReportRendererName',{value:reportRenderer.functionName});
    new CfnOutput(this,'LibraryBucketName',{value:libraryBucket.bucketName});
    new CfnOutput(this,'AnalysisQueueUrl',{value:analysisQueue.queueUrl});
    new CfnOutput(this, 'GameTableName', { value: gameTable.tableName });
    new CfnOutput(this, 'GameFunctionName', { value: gameHandler.functionName });
    new CfnOutput(this, 'SiteBucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'CloudFrontDomainName', { value: distribution.distributionDomainName });
    new CfnOutput(this, 'WebsiteUrl', { value: Fn.join('', ['https://', domainName]) });
  }
}
