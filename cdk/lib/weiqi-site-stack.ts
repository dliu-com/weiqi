import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';
import {
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
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
    const sharedLibrarySource = ['src/sgf.js','backend/library-service.js'].map(file => fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
    const libraryHandlerSource = fs.readFileSync(path.join(root,'backend/library-handler.cjs'),'utf8');
    const handlerSource = fs.readFileSync(path.join(root, 'backend/handler.cjs'), 'utf8');
    const gameHandler = new lambda.Function(this, 'GameHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(20),
      memorySize: 256,
      logGroup: new logs.LogGroup(this, 'GameLogs', { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY }),
      environment: { LIBRARY_BUCKET:libraryBucket.bucketName, ANALYSIS_QUEUE:analysisQueue.queueUrl, TABLE_NAME: gameTable.tableName, SITE_ORIGIN: Fn.join('', ['https://', domainName]) },
      code: lambda.Code.fromInline([engineSource, serviceSource, sharedLibrarySource, libraryHandlerSource, handlerSource].join('\n')),
    });
    libraryBucket.grantReadWrite(gameHandler);
    analysisQueue.grantSendMessages(gameHandler);
    gameTable.grant(gameHandler, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Scan');
    const functionUrl = gameHandler.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    const recordRoutes=new cloudfront.Function(this,'RecordRoutes',{code:cloudfront.FunctionCode.fromInline("function handler(event){var request=event.request;if(/^\\/(?:record|game)\\/(?:[0-9]{10,14}|[a-f0-9-]{36})\\/?$/.test(request.uri))request.uri='/record.html';return request;}")});
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
