import {projectConfig} from './project-config';
import * as fs from 'fs';
import * as path from 'path';
import {execFileSync} from 'child_process';
import { Construct } from 'constructs';
import {SqsEventSource} from 'aws-cdk-lib/aws-lambda-event-sources';
import {
  aws_apigatewayv2 as apigateway,
  aws_apigatewayv2_authorizers as authorizers,
  aws_apigatewayv2_integrations as integrations,
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
  aws_ssm as ssm,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Size,
  Stack,
  StackProps,
} from 'aws-cdk-lib';

// Owner sign-in settings (scripts/set-secrets.sh) and the shared dliu.com Entra tenant and "dliu API" app.
export const PARAMETER_PREFIX='/weiqi';
export const TENANT_PARAMETER='/dliu/entra-tenant-id';
export const API_APP_PARAMETER='/dliu/api-app-id';
// Managed API stage throttle: above this API Gateway answers 429 before Lambda runs.
export const MANAGED_API_RATE=10;
export const MANAGED_API_BURST=20;

export class WeiqiSiteStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & {analysisQueueArnOverride?:string;keepLegacyAnalysisQueue?:boolean;microsoftApi?:boolean;storage?:{gameTable:dynamodb.ITable;libraryBucket:s3.IBucket}} = {}) {
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
    // The legacy construct's helper Lambda otherwise logs to an unmanaged group.
    const certificateRequestor=certificate.node.findChild('CertificateRequestorFunction').node.defaultChild as lambda.CfnFunction;
    certificateRequestor.loggingConfig={logGroup:new logs.LogGroup(this,'CertificateRequestorLogs',{retention:logs.RetentionDays.THREE_MONTHS,removalPolicy:RemovalPolicy.DESTROY}).logGroupName};

    const cachePolicy = new cloudfront.CachePolicy(this, 'SiteCachePolicy', {
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.minutes(5),
      // Lets s-maxage keep static files at the edge for a day; each publish invalidates them.
      maxTtl: Duration.days(1),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SiteResponseHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {contentSecurityPolicy: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://files.dliu.com/dliu.com/ui/; img-src 'self' data: blob: https://files.dliu.com/dliu.com/; font-src 'self'; connect-src 'self' blob: https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'", override:true},
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: false, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [{ header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', override: true }],
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
    const sharedLibrarySource = ['src/sgf.js','src/recording-tree.js','backend/draft-service.js','src/ai-review.js','src/report-insights.js','src/report-data.js','backend/library-service.js'].map(file => fs.readFileSync(path.join(root,file),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
    const queueEstimateSource=fs.readFileSync(path.join(root,'src/queue-estimate.js'),'utf8').replace(/^export /gm,'');
    const queueStatusSource=fs.readFileSync(path.join(root,'backend/queue-status.cjs'),'utf8');
    const libraryHandlerSource = fs.readFileSync(path.join(root,'backend/library-handler.cjs'),'utf8');
    const sharePreviewSource = fs.readFileSync(path.join(root,'backend/share-preview.cjs'),'utf8').replace(/^module.exports=.*;$/gm,'');
    const handlerSource = fs.readFileSync(path.join(root, 'backend/handler.cjs'), 'utf8');
    // auth.cjs ends with module.exports for tests; inside a bundle that line would replace the handler's exports.
    const authSource = fs.readFileSync(path.join(root,'backend/auth.cjs'),'utf8').replace(/^module.exports=.*;$/gm,'');
    execFileSync(process.execPath,[path.join(root,'scripts/build-report-renderer.mjs')],{stdio:'inherit'});
    const reportDeadLetters=new sqs.Queue(this,'ReportDeadLetters',{fifo:true,retentionPeriod:Duration.days(14)});
    const reportQueue=new sqs.Queue(this,'ReportQueue',{fifo:true,visibilityTimeout:Duration.minutes(6),retentionPeriod:Duration.days(1),deadLetterQueue:{queue:reportDeadLetters,maxReceiveCount:3}});
    const reportRenderer=new lambda.Function(this,'ReportRenderer',{
      description:'Prepared bilingual Weiqi reports - renderer '+JSON.parse(fs.readFileSync(path.join(root,'backend/report-renderer/version.json'),'utf8')).version,
      runtime:lambda.Runtime.NODEJS_22_X,handler:'index.handler',memorySize:2048,
      timeout:Duration.minutes(5),ephemeralStorageSize:Size.gibibytes(1),
      logGroup:new logs.LogGroup(this,'ReportRendererLogs',{retention:logs.RetentionDays.THREE_MONTHS,removalPolicy:RemovalPolicy.DESTROY}),
      code:lambda.Code.fromAsset(path.join(root,'backend/report-renderer')),
      environment:{LIBRARY_BUCKET:libraryBucket.bucketName,SITE_BUCKET:bucket.bucketName},
    });
    reportRenderer.addEventSource(new SqsEventSource(reportQueue,{batchSize:1}));
    libraryBucket.grantRead(reportRenderer,'games/*');
    bucket.grantReadWrite(reportRenderer,'prepared-reports/*');
    const gameHandler = new lambda.Function(this, 'GameHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(30),
      memorySize: 256,
      // Caps the cost of a request flood; normal use needs only a few at once.
      reservedConcurrentExecutions: 20,
      logGroup: new logs.LogGroup(this, 'GameLogs', { retention: logs.RetentionDays.THREE_MONTHS, removalPolicy: RemovalPolicy.DESTROY }),
      environment: { POSITION_USAGE_TABLE:'weiqi-position-usage',POSITION_RECOGNIZER:'WeiqiPositionRecognition',POSITION_ENGINE:'WeiqiPositionEngine',POSITION_DAILY_MICROS:String(projectConfig.positionAnalysis.dailyRequests*projectConfig.positionAnalysis.requestReserveMicros),POSITION_REQUEST_MICROS:String(projectConfig.positionAnalysis.requestReserveMicros),CLIENT_EDITS_PER_MINUTE:'60',CLIENT_POSITIONS_PER_DAY:String(projectConfig.positionAnalysis.connectionDailyRequests),DAILY_ANALYSIS_CAP:String(projectConfig.analysis.dailyDeepLimit),DAILY_UPLOAD_CAP:String(projectConfig.analysis.dailyGameLimit), AI_CONTROL_KEY:'control/ai-spending.json', LIBRARY_BUCKET:libraryBucket.bucketName, SITE_BUCKET:bucket.bucketName, ANALYSIS_QUEUE:analysisQueue.queueUrl, TABLE_NAME: gameTable.tableName, REPORT_QUEUE:reportQueue.queueUrl, SITE_ORIGIN: Fn.join('', ['https://', domainName]), PARAMETER_PREFIX, TENANT_PARAMETER },
      code: lambda.Code.fromInline([engineSource, serviceSource, sharedLibrarySource, queueEstimateSource, sharePreviewSource, libraryHandlerSource, queueStatusSource, fs.readFileSync(path.join(root,'backend/client-limit.cjs'),'utf8'), fs.readFileSync(path.join(root,'backend/position-handler.cjs'),'utf8'), authSource, handlerSource].join('\n')),
    });
    // Both functions read the owner sign-in settings: this app's client ID and secret (also the session key) and the tenant ID.
    const parameterArn=(name:string)=>this.formatArn({service:'ssm',resource:'parameter',resourceName:name.slice(1)});
    const readSecrets=(fn:lambda.Function)=>{
      fn.addToRolePolicy(new iam.PolicyStatement({actions:['ssm:GetParameters'],resources:[parameterArn(`${PARAMETER_PREFIX}/*`),parameterArn(TENANT_PARAMETER)]}));
      fn.addToRolePolicy(new iam.PolicyStatement({actions:['kms:Decrypt'],resources:['*'],conditions:{StringEquals:{'kms:ViaService':`ssm.${this.region}.amazonaws.com`}}}));
    };
    // GameHandler only checks the owner's session cookie to lift per-connection limits; it can never delete.
    readSecrets(gameHandler);
    gameHandler.addToRolePolicy(new iam.PolicyStatement({actions:['lambda:InvokeFunction'],resources:[`arn:${this.partition}:lambda:${this.region}:${this.account}:function:WeiqiPositionRecognition`,`arn:${this.partition}:lambda:${this.region}:${this.account}:function:WeiqiPositionEngine`]}));
    gameHandler.addToRolePolicy(new iam.PolicyStatement({actions:['dynamodb:PutItem','dynamodb:UpdateItem'],resources:[`arn:${this.partition}:dynamodb:${this.region}:${this.account}:table/weiqi-position-usage`]}));
    reportQueue.grantSendMessages(gameHandler);
    gameHandler.addToRolePolicy(new iam.PolicyStatement({actions:['s3:PutObject'],resources:[bucket.arnForObjects('share/*')]}));
    gameHandler.addToRolePolicy(new iam.PolicyStatement({actions:['batch:DescribeJobs','batch:ListJobs'],resources:['*']}));
    new events.Rule(this,'CompletedGameReport',{
      eventPattern:{source:['aws.batch'],detailType:['Batch Job State Change'],detail:{status:['SUCCEEDED'],jobName:[{prefix:'weiqi-'}]}},
      targets:[new eventTargets.LambdaFunction(gameHandler,{retryAttempts:2,maxEventAge:Duration.hours(1)})],
    });
    // Only the prefixes the API uses, and no delete: library writes are create-only or conditional.
    // ListBucket keeps a missing key as NoSuchKey instead of AccessDenied.
    const apiLibraryPrefixes=['games/*','library-index/*','uploads/*','reservations/*','daily-analysis/*'];
    gameHandler.addToRolePolicy(new iam.PolicyStatement({actions:['s3:GetObject','s3:PutObject'],resources:apiLibraryPrefixes.map(p=>libraryBucket.arnForObjects(p))}));
    gameHandler.addToRolePolicy(new iam.PolicyStatement({actions:['s3:GetObject'],resources:[libraryBucket.arnForObjects('control/ai-spending.json')]}));
    gameHandler.addToRolePolicy(new iam.PolicyStatement({actions:['s3:ListBucket'],resources:[libraryBucket.bucketArn]}));
    analysisQueue.grantSendMessages(gameHandler);
    gameTable.grant(gameHandler, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Scan');
    const functionUrl = gameHandler.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    // OwnerApi: owner sign-in (/auth/*), the owner's website tools (/api/owner/*) and the managed API. It is the only
    // function that may delete games; guests reach just sign-in and GET /api/owner/session (backend/owner-api.cjs).
    const managedRoutes:Record<string,{scope:string}>=JSON.parse(fs.readFileSync(path.join(root,'backend/managed-routes.json'),'utf8'));
    const strip=(source:string)=>source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replace(/^module.exports=.*;$/gm,'');
    const ownerSource=[
      ...['src/engine.js','backend/game-service.js','src/sgf.js','src/recording-tree.js','backend/draft-service.js','src/ai-review.js','src/report-insights.js','src/report-data.js','backend/library-service.js','src/queue-estimate.js','backend/share-preview.cjs','backend/library-handler.cjs','backend/queue-status.cjs','backend/auth.cjs'].map(file=>strip(fs.readFileSync(path.join(root,file),'utf8'))),
      'const MANAGED_ROUTES='+JSON.stringify(managedRoutes)+';',
      strip(fs.readFileSync(path.join(root,'backend/owner-api.cjs'),'utf8')),
    ].join('\n');
    const ownerApi=new lambda.Function(this,'OwnerApi',{
      description:'Weiqi owner sign-in, owner tools and the Microsoft-token API',
      runtime:lambda.Runtime.NODEJS_22_X,handler:'index.handler',timeout:Duration.seconds(30),memorySize:256,
      reservedConcurrentExecutions:5,
      logGroup:new logs.LogGroup(this,'OwnerApiLogs',{retention:logs.RetentionDays.THREE_MONTHS,removalPolicy:RemovalPolicy.DESTROY}),
      environment:{LIBRARY_BUCKET:libraryBucket.bucketName,SITE_BUCKET:bucket.bucketName,AI_CONTROL_KEY:'control/ai-spending.json',ANALYSIS_QUEUE:analysisQueue.queueUrl,TABLE_NAME:gameTable.tableName,
        SITE_ORIGIN:Fn.join('',['https://',domainName]),DAILY_ANALYSIS_CAP:String(projectConfig.analysis.dailyDeepLimit),DAILY_UPLOAD_CAP:String(projectConfig.analysis.dailyGameLimit),PARAMETER_PREFIX,TENANT_PARAMETER,REPORT_QUEUE:reportQueue.queueUrl},
      code:lambda.Code.fromInline(ownerSource),
    });
    readSecrets(ownerApi);
    ownerApi.addToRolePolicy(new iam.PolicyStatement({actions:['s3:GetObject','s3:PutObject'],resources:apiLibraryPrefixes.map(p=>libraryBucket.arnForObjects(p))}));
    ownerApi.addToRolePolicy(new iam.PolicyStatement({actions:['s3:GetObject'],resources:[libraryBucket.arnForObjects('control/ai-spending.json')]}));
    // Delete is limited to a game's files and its list entry. Buckets are versioned and no function may delete
    // versions, so every delete can be undone. Uploads, reservations and daily counters are never deleted.
    ownerApi.addToRolePolicy(new iam.PolicyStatement({actions:['s3:DeleteObject'],resources:[libraryBucket.arnForObjects('games/*'),libraryBucket.arnForObjects('library-index/*')]}));
    ownerApi.addToRolePolicy(new iam.PolicyStatement({actions:['s3:ListBucket'],resources:[libraryBucket.bucketArn,bucket.bucketArn]}));
    ownerApi.addToRolePolicy(new iam.PolicyStatement({actions:['s3:PutObject'],resources:[bucket.arnForObjects('share/*')]}));
    ownerApi.addToRolePolicy(new iam.PolicyStatement({actions:['s3:DeleteObject'],resources:[bucket.arnForObjects('share/*'),bucket.arnForObjects('prepared-reports/*')]}));
    ownerApi.addToRolePolicy(new iam.PolicyStatement({actions:['batch:DescribeJobs','batch:ListJobs'],resources:['*']}));
    ownerApi.addToRolePolicy(new iam.PolicyStatement({actions:['dynamodb:GetItem'],resources:[gameTable.tableArn]}));
    analysisQueue.grantSendMessages(ownerApi);
    // A game-info edit prepares the report again (backend/owner-api.cjs refreshReport).
    reportQueue.grantSendMessages(ownerApi);
    const ownerUrl=ownerApi.addFunctionUrl({authType:lambda.FunctionUrlAuthType.AWS_IAM});

    // ---------- Managed API (Microsoft access tokens) ----------
    // API Gateway checks the token (signature, issuer, audience, expiry, route scope); OwnerApi re-checks the claims
    // (authorize in backend/owner-api.cjs). The website and its cookies don't use this API.
    if(props.microsoftApi){
      const tenantId=ssm.StringParameter.valueForStringParameter(this,TENANT_PARAMETER);
      // The shared "dliu API" app: tokens are issued for it (audience) and through it (azp).
      const apiAppId=ssm.StringParameter.valueForStringParameter(this,API_APP_PARAMETER);
      const httpApi=new apigateway.HttpApi(this,'MicrosoftApi',{description:'Weiqi API: Microsoft Entra access tokens, delegated weiqi.* permissions and assigned users'});
      (httpApi.defaultStage!.node.defaultChild as apigateway.CfnStage).defaultRouteSettings={throttlingRateLimit:MANAGED_API_RATE,throttlingBurstLimit:MANAGED_API_BURST};
      const authorizer=new authorizers.HttpJwtAuthorizer('MicrosoftJwt',Fn.join('',['https://login.microsoftonline.com/',tenantId,'/v2.0']),{jwtAudience:[apiAppId]});
      const integration=new integrations.HttpLambdaIntegration('WeiqiApi',ownerApi);
      for(const [route,{scope}] of Object.entries(managedRoutes)){
        const [method,routePath]=route.split(' ');
        httpApi.addRoutes({path:routePath,methods:[apigateway.HttpMethod[method as 'GET'|'POST'|'PATCH'|'DELETE']],integration,authorizer,authorizationScopes:[scope]});
      }
      ownerApi.addEnvironment('API_GATEWAY_ID',httpApi.apiId);
      ownerApi.addEnvironment('API_TENANT_ID',tenantId);
      ownerApi.addEnvironment('API_AUDIENCE',apiAppId);
      ownerApi.addEnvironment('API_CLIENT_ID',apiAppId);
      new CfnOutput(this,'MicrosoftApiUrl',{value:httpApi.apiEndpoint});
    }

    // Public GET /health for status.dliu.com: read only, one cheap read per dependency, never paid work.
    const healthCheck=new lambda.Function(this,'HealthCheck',{
      description:'Weiqi read-only health check for status.dliu.com',
      runtime:lambda.Runtime.NODEJS_22_X,handler:'index.handler',timeout:Duration.seconds(10),memorySize:256,
      // The CloudFront cache answers almost every request; this caps a flood that misses it.
      reservedConcurrentExecutions:2,
      logGroup:new logs.LogGroup(this,'HealthCheckLogs',{retention:logs.RetentionDays.THREE_MONTHS,removalPolicy:RemovalPolicy.DESTROY}),
      code:lambda.Code.fromInline(fs.readFileSync(path.join(root,'backend/health.cjs'),'utf8')),
      environment:{SITE_BUCKET:bucket.bucketName,LIBRARY_BUCKET:libraryBucket.bucketName,AI_CONTROL_KEY:'control/ai-spending.json',TABLE_NAME:gameTable.tableName,REPORT_DLQ_URL:reportDeadLetters.queueUrl,REPORT_RENDERER:reportRenderer.functionName,POSITION_RECOGNIZER:'WeiqiPositionRecognition',POSITION_ENGINE:'WeiqiPositionEngine',OWNER_API:ownerApi.functionName,TENANT_PARAMETER,CLIENT_ID_PARAMETER:`${PARAMETER_PREFIX}/entra-client-id`},
    });
    healthCheck.addToRolePolicy(new iam.PolicyStatement({actions:['s3:GetObject'],resources:[bucket.arnForObjects('index.html'),libraryBucket.arnForObjects('control/ai-spending.json')]}));
    // Without ListBucket a missing control file reads as AccessDenied (fail), never as "not paused".
    healthCheck.addToRolePolicy(new iam.PolicyStatement({actions:['dynamodb:GetItem'],resources:[gameTable.tableArn]}));
    healthCheck.addToRolePolicy(new iam.PolicyStatement({actions:['sqs:GetQueueAttributes'],resources:[reportDeadLetters.queueArn]}));
    healthCheck.addToRolePolicy(new iam.PolicyStatement({actions:['lambda:GetFunctionConfiguration'],resources:[reportRenderer.functionArn,`arn:${this.partition}:lambda:${this.region}:${this.account}:function:WeiqiPositionRecognition`,`arn:${this.partition}:lambda:${this.region}:${this.account}:function:WeiqiPositionEngine`,ownerApi.functionArn]}));
    // The two non-secret sign-in settings only: no access to the client secret and no kms:Decrypt.
    healthCheck.addToRolePolicy(new iam.PolicyStatement({actions:['ssm:GetParameters'],resources:[parameterArn(TENANT_PARAMETER),parameterArn(`${PARAMETER_PREFIX}/entra-client-id`)]}));
    const healthUrl=healthCheck.addFunctionUrl({authType:lambda.FunctionUrlAuthType.AWS_IAM});
    // Keyed on nothing: every viewer shares one copy for 60 s, so status checks cost at most one call a minute per edge.
    const healthCache=new cloudfront.CachePolicy(this,'HealthCache',{
      comment:'Weiqi /health: 60 s, no headers, cookies or query strings',
      minTtl:Duration.seconds(0),defaultTtl:Duration.seconds(60),maxTtl:Duration.seconds(60),
      headerBehavior:cloudfront.CacheHeaderBehavior.none(),cookieBehavior:cloudfront.CacheCookieBehavior.none(),queryStringBehavior:cloudfront.CacheQueryStringBehavior.none(),
      enableAcceptEncodingGzip:true,enableAcceptEncodingBrotli:true,
    });

    const recordRoutes=new cloudfront.Function(this,'RecordRoutes',{code:cloudfront.FunctionCode.fromInline(fs.readFileSync(path.join(root,'src/routes.cjs'),'utf8'))});
    // Overwrites any client-supplied value, so the API can give each connection a fair share of public limits.
    const apiViewer=new cloudfront.Function(this,'ApiViewer',{code:cloudfront.FunctionCode.fromInline("function handler(event){var request=event.request;request.headers['x-weiqi-viewer']={value:event.viewer.ip};return request;}")});
    // Central traffic monitoring (dliu-com/traffic-monitor): shared visitor cookie; TrafficMonitor
    // creates this distribution's access-log delivery (CloudFront standard logging v2).
    const visitorIdFunction = cloudfront.Function.fromFunctionAttributes(this, 'VisitorId', {
      functionArn: Fn.importValue('TrafficVisitorFunctionArn'),
      functionName: 'dliu-visitor-id',
    });
    // Makes CloudFront add CloudFront-Viewer-City so the visitor function can log the city.
    const trafficGeoPolicy = cloudfront.OriginRequestPolicy.fromOriginRequestPolicyId(
      this, 'TrafficGeo', Fn.importValue('TrafficGeoOriginRequestPolicyId'));

    const ownerOrigin=origins.FunctionUrlOrigin.withOriginAccessControl(ownerUrl);
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        functionAssociations:[{eventType:cloudfront.FunctionEventType.VIEWER_REQUEST,function:recordRoutes},{ eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE, function: visitorIdFunction }],
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy,
        originRequestPolicy: trafficGeoPolicy,
        responseHeadersPolicy: headers,
        compress: true,
      },
      additionalBehaviors: {
        // Listed before api/*: CloudFront uses the first matching pattern.
        'api/owner/*': {
          origin: ownerOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: headers,
        },
        'auth/*': {
          origin: ownerOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: headers,
        },
        'api/*': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations:[{eventType:cloudfront.FunctionEventType.VIEWER_REQUEST,function:apiViewer}],
          responseHeadersPolicy: headers,
        },
        // No origin request policy: CloudFront forwards no cookies, Authorization header or query string.
        'health': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(healthUrl),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: healthCache,
          responseHeadersPolicy: headers,
          compress: true,
        },
      },
      domainNames: [domainName],
      certificate,
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.seconds(30) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.seconds(30) },
      ],
    });

    // IncludeCookies is the only legacy logging setting v2 honours: it puts the dl_vid cookie in the logs.
    (distribution.node.defaultChild as cloudfront.CfnDistribution)
      .addPropertyOverride('DistributionConfig.Logging', { IncludeCookies: true });

    // New function URLs require both invoke permissions. CDK adds InvokeFunctionUrl.
    gameHandler.addPermission('CloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: distribution.distributionArn,
      invokedViaFunctionUrl: true,
    });
    ownerApi.addPermission('CloudFrontInvokeFunction', {
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
    new CfnOutput(this, 'OwnerFunctionName', { value: ownerApi.functionName });
    new CfnOutput(this, 'SiteBucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'CloudFrontDomainName', { value: distribution.distributionDomainName });
    new CfnOutput(this, 'WebsiteUrl', { value: Fn.join('', ['https://', domainName]) });
  }
}
