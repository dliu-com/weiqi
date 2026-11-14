import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { WeiqiStorageStack } from '../lib/weiqi-storage-stack';
import { WeiqiSiteStack } from '../lib/weiqi-site-stack';

const app=new App();const storage=new WeiqiStorageStack(app,'WeiqiStorage',{terminationProtection:true});const site=new WeiqiSiteStack(app,'TestWeiqi',{storage});
const template=Template.fromStack(site),retained=Template.fromStack(storage);
function makeSite(id:string,props:any){const app=new App(),storage=new WeiqiStorageStack(app,'WeiqiStorage',{env:props.env});return new WeiqiSiteStack(app,id,{...props,storage});}

test('response headers include a Permissions-Policy that disables unused browser features', () => {
  template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {ResponseHeadersPolicyConfig: Match.objectLike({CustomHeadersConfig: {Items: [{Header: 'Permissions-Policy', Value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', Override: true}]}})});
});
test('static site storage stays private and encrypted', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    VersioningConfiguration: { Status: 'Enabled' },
  });
  template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
  template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: Match.objectLike({ SigningBehavior: 'always', SigningProtocol: 'sigv4', OriginAccessControlOriginType: 's3' }),
  });
  template.hasResourceProperties('AWS::S3::BucketPolicy', {
    PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({
      Action: 's3:GetObject',
      Principal: { Service: 'cloudfront.amazonaws.com' },
      Condition: { StringEquals: { 'AWS:SourceArn': Match.anyValue() } },
    })]) },
  });
});

test('serves only the Weiqi subdomain over HTTPS, without always-on infrastructure', () => {
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      DefaultRootObject: 'index.html',
      HttpVersion: 'http2and3',
      Aliases: [{ 'Fn::Join': ['', ['weiqi.', { 'Fn::ImportValue': 'MainDomain' }]] }],
      DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https', AllowedMethods: ['GET', 'HEAD'] }),
    }),
  });
  template.resourceCountIs('AWS::Route53::RecordSet', 2);
  template.resourceCountIs('AWS::ECS::Service', 0);
  template.resourceCountIs('AWS::ApiGateway::RestApi', 0);
  template.resourceCountIs('AWS::DynamoDB::Table', 0);
  template.resourceCountIs('AWS::EC2::NatGateway', 0);
  template.resourceCountIs('AWS::EC2::Instance', 0);
  template.resourceCountIs('AWS::RDS::DBInstance', 0);
  template.resourceCountIs('AWS::RDS::DBCluster', 0);
  template.resourceCountIs('AWS::Route53::HostedZone', 0);
  template.resourceCountIs('AWS::KMS::Key', 0);
  template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
});

test('game persistence is on-demand and requests reach Lambda only through CloudFront', () => {
  retained.hasResourceProperties('AWS::DynamoDB::Table', {
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [{ AttributeName: 'gameId', KeyType: 'HASH' }],
    ProvisionedThroughput: Match.absent(),
    PointInTimeRecoverySpecification: {PointInTimeRecoveryEnabled:true},DeletionProtectionEnabled:true,
  });
  retained.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });
  template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
  template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: 'lambda', SigningBehavior: 'always' }),
  });
  template.hasResourceProperties('AWS::Lambda::Permission', {
    Principal: 'cloudfront.amazonaws.com', Action: 'lambda:InvokeFunctionUrl', SourceArn: Match.anyValue(),
  });
  template.hasResourceProperties('AWS::Lambda::Permission', {
    Principal: 'cloudfront.amazonaws.com', Action: 'lambda:InvokeFunction', SourceArn: Match.anyValue(),
  });
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({ CacheBehaviors: Match.arrayWith([Match.objectLike({
      PathPattern: 'api/*', CachePolicyId: cloudfrontNoCache(),
    })]) }),
  });
});

function cloudfrontNoCache() {
  return '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
}

test('record library uses a separate retained private bucket and a queue without paid workers',()=>{
 template.resourceCountIs('AWS::S3::Bucket',1);retained.resourceCountIs('AWS::S3::Bucket',1);
 template.hasResourceProperties('AWS::SQS::Queue',{MessageRetentionPeriod:1209600,VisibilityTimeout:180});
 template.resourceCountIs('AWS::Batch::ComputeEnvironment',0);
 template.resourceCountIs('AWS::Lambda::EventSourceMapping',1);
 template.hasResourceProperties('AWS::Lambda::Function',{Environment:{Variables:Match.objectLike({LIBRARY_BUCKET:Match.anyValue(),ANALYSIS_QUEUE:Match.anyValue()})}});
 template.hasResourceProperties('AWS::Lambda::Function',{Environment:{Variables:Match.objectLike({DAILY_UPLOAD_CAP:'100',DAILY_ANALYSIS_CAP:'10',POSITION_DAILY_MICROS:'3000000',POSITION_REQUEST_MICROS:'1500',CLIENT_POSITIONS_PER_DAY:'500'})}});
});

test('validated upload queue can be selected while retaining the old queue for draining',()=>{
 const selected='arn:aws:sqs:eu-west-1:123456789012:validated-uploads';
 const cutover=Template.fromStack(makeSite('Cutover',{analysisQueueArnOverride:selected,env:{account:'123456789012',region:'eu-west-1'}}));
 cutover.resourceCountIs('AWS::SQS::Queue',3);
 const functions=Object.values(cutover.findResources('AWS::Lambda::Function'));
 const game=functions.find(f=>f.Properties.Environment?.Variables?.ANALYSIS_QUEUE);
 expect(JSON.stringify(game?.Properties.Environment.Variables.ANALYSIS_QUEUE)).toContain('validated-uploads');
 cutover.hasResourceProperties('AWS::IAM::Policy',{PolicyDocument:{Statement:Match.arrayWith([Match.objectLike({Action:Match.arrayWith(['sqs:SendMessage']),Resource:selected})])}});
});

test('legacy upload queue can be removed after the selected route is validated',()=>{
 const final=Template.fromStack(makeSite('Final',{analysisQueueArnOverride:'arn:aws:sqs:eu-west-1:123456789012:validated-uploads',keepLegacyAnalysisQueue:false,env:{account:'123456789012',region:'eu-west-1'}}));
 final.resourceCountIs('AWS::SQS::Queue',2);
 expect(()=>makeSite('Invalid',{keepLegacyAnalysisQueue:false})).toThrow('queue');
});

test('completed GPU jobs prepare cached reports through an event, without another paid worker',()=>{
 template.hasResourceProperties('AWS::Events::Rule',{EventPattern:{source:['aws.batch'],'detail-type':['Batch Job State Change'],detail:{status:['SUCCEEDED'],jobName:[{prefix:'weiqi-'}]}},Targets:Match.arrayWith([Match.objectLike({RetryPolicy:{MaximumRetryAttempts:2,MaximumEventAgeInSeconds:3600}})])});
 template.hasResourceProperties('AWS::Lambda::Permission',{Principal:'events.amazonaws.com',Action:'lambda:InvokeFunction'});
});

 test('report files are prepared asynchronously without interaction or another GPU job',()=>{
 template.hasResourceProperties('AWS::Lambda::Function',{Handler:'index.handler',MemorySize:2048,Timeout:300,Environment:{Variables:Match.objectLike({SITE_BUCKET:Match.anyValue(),LIBRARY_BUCKET:Match.anyValue()})}});
 template.hasResourceProperties('AWS::SQS::Queue',{FifoQueue:true,VisibilityTimeout:360,RedrivePolicy:Match.objectLike({maxReceiveCount:3})});
 template.hasResourceProperties('AWS::Lambda::EventSourceMapping',{BatchSize:1});
 template.hasResourceProperties('AWS::IAM::Policy',{PolicyDocument:{Statement:Match.arrayWith([Match.objectLike({Action:Match.arrayWith(['sqs:SendMessage'])})])}});
 });

test('game status may read Batch queue state without submitting or cancelling analysis jobs',()=>{
 const policies=Object.values(template.findResources('AWS::IAM::Policy'));const game=policies.find((policy:any)=>JSON.stringify(policy.Properties.Roles).includes('GameHandler')) as any;
 const actions=game.Properties.PolicyDocument.Statement.flatMap((statement:any)=>Array.isArray(statement.Action)?statement.Action:[statement.Action]);
 expect(actions).toContain('batch:ListJobs');expect(actions).toContain('batch:DescribeJobs');expect(actions).not.toContain('batch:SubmitJob');expect(actions).not.toContain('batch:CancelJob');
});
test('the public API function has a concurrency ceiling, so a request flood cannot scale cost without limit',()=>{
 template.hasResourceProperties('AWS::Lambda::Function',{Handler:'index.handler',MemorySize:256,ReservedConcurrentExecutions:20});
});
test('the public API may read and create library records but never delete them',()=>{
 const policies=Object.values(template.findResources('AWS::IAM::Policy'));const game=policies.find((policy:any)=>JSON.stringify(policy.Properties.Roles).includes('GameHandler')) as any;
 const statements=game.Properties.PolicyDocument.Statement,actions=statements.flatMap((statement:any)=>Array.isArray(statement.Action)?statement.Action:[statement.Action]);
 expect(actions.filter((action:string)=>/^s3:/.test(action)).sort()).toEqual(['s3:GetObject','s3:GetObject','s3:ListBucket','s3:PutObject','s3:PutObject']);
 expect(actions.some((action:string)=>action.includes('*'))).toBe(false);
 const objects=JSON.stringify(statements.filter((statement:any)=>([] as string[]).concat(statement.Action).includes('s3:PutObject')).map((statement:any)=>statement.Resource));
 for(const prefix of ['games/*','library-index/*','uploads/*','reservations/*','daily-analysis/*','share/*'])expect(objects).toContain(prefix);
 expect(objects).not.toContain('control/');
});

test('GET /health is a cached, read-only Lambda behind CloudFront that receives no cookies, Authorization or query string',()=>{
  const res=template.toJSON().Resources as Record<string,any>;
  const [healthId,health]=Object.entries(res).find(([,r])=>r.Type==='AWS::Lambda::Function'&&r.Properties.Description==='Weiqi read-only health check for status.dliu.com')!;
  expect(health.Properties.ReservedConcurrentExecutions).toBe(2);
  const [cacheId]=Object.entries(res).find(([,r])=>r.Type==='AWS::CloudFront::CachePolicy'&&r.Properties.CachePolicyConfig.Name?.toString().includes('HealthCache')||r.Type==='AWS::CloudFront::CachePolicy'&&r.Properties.CachePolicyConfig.Comment?.includes('/health'))!;
  const cache=res[cacheId].Properties.CachePolicyConfig;
  expect([cache.DefaultTTL,cache.MaxTTL,cache.MinTTL]).toEqual([60,60,0]);
  const key=cache.ParametersInCacheKeyAndForwardedToOrigin;
  expect([key.HeadersConfig.HeaderBehavior,key.CookiesConfig.CookieBehavior,key.QueryStringsConfig.QueryStringBehavior]).toEqual(['none','none','none']);
  const dist=Object.values(res).find(r=>r.Type==='AWS::CloudFront::Distribution')!.Properties.DistributionConfig;
  const behavior=dist.CacheBehaviors.find((b:any)=>b.PathPattern==='health');
  expect(behavior.CachePolicyId).toEqual({Ref:cacheId});
  expect(behavior.OriginRequestPolicyId).toBeUndefined();expect(behavior.FunctionAssociations).toBeUndefined();
  expect(behavior.AllowedMethods).toEqual(['GET','HEAD']);
  const urls=Object.entries(res).filter(([,r])=>r.Type==='AWS::Lambda::Url'&&JSON.stringify(r.Properties.TargetFunctionArn).includes(healthId));
  expect(urls.map(([,u])=>u.Properties.AuthType)).toEqual(['AWS_IAM']);
  const perms=Object.values(res).filter(r=>r.Type==='AWS::Lambda::Permission'&&JSON.stringify(r.Properties.FunctionName).includes(urls[0][0]));
  expect(perms.map(r=>r.Properties.Action).sort()).toEqual(['lambda:InvokeFunction','lambda:InvokeFunctionUrl']);
  expect(perms.every(r=>r.Properties.Principal==='cloudfront.amazonaws.com')).toBe(true);
  const roleId=health.Properties.Role['Fn::GetAtt'][0];
  const actions=Object.values(res).filter(r=>r.Type==='AWS::IAM::Policy'&&r.Properties.Roles.some((x:any)=>x.Ref===roleId)).flatMap(r=>r.Properties.PolicyDocument.Statement).flatMap((s:any)=>{expect(s.Effect).toBe('Allow');expect(s.Resource).not.toBe('*');return [].concat(s.Action);}).sort();
  expect(actions).toEqual(['dynamodb:GetItem','lambda:GetFunctionConfiguration','s3:GetObject','sqs:GetQueueAttributes','ssm:GetParameters']);
  // Sign-in check: the two non-secret settings only, never the client secret, and no kms:Decrypt.
  const ssmResources=JSON.stringify(Object.values(res).filter(r=>r.Type==='AWS::IAM::Policy'&&r.Properties.Roles.some((x:any)=>x.Ref===roleId)).flatMap(r=>r.Properties.PolicyDocument.Statement).filter((s:any)=>s.Action==='ssm:GetParameters').map((s:any)=>s.Resource));
  expect(ssmResources).toContain('weiqi/entra-client-id');expect(ssmResources).toContain('dliu/entra-tenant-id');
  expect(ssmResources).not.toContain('secret');expect(ssmResources).not.toContain('weiqi/*');
});

const ownerRoutes:Record<string,{scope:string}>=JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'../../backend/managed-routes.json'),'utf8'));
const functionNamed=(t:Template,description:string)=>Object.entries(t.toJSON().Resources as Record<string,any>).find(([,r])=>r.Type==='AWS::Lambda::Function'&&r.Properties.Description===description)!;
const roleStatements=(t:Template,fn:any)=>{const roleId=fn.Properties.Role['Fn::GetAtt'][0];return Object.values(t.toJSON().Resources as Record<string,any>).filter(r=>r.Type==='AWS::IAM::Policy'&&r.Properties.Roles.some((x:any)=>x.Ref===roleId)).flatMap(r=>r.Properties.PolicyDocument.Statement);};
const actionsOf=(statements:any[])=>statements.flatMap((s:any)=>[].concat(s.Action));
test('only OwnerApi may delete, only a game\'s own files, and never object versions',()=>{
 const [,owner]=functionNamed(template,'Weiqi owner sign-in, owner tools and the Microsoft-token API');
 expect(owner.Properties.ReservedConcurrentExecutions).toBe(5);
 const statements=roleStatements(template,owner),actions=actionsOf(statements);
 expect(actions.some((a:string)=>a.includes('*')||/Version|DeleteBucket|PutBucket/.test(a))).toBe(false);
 const deletes=JSON.stringify(statements.filter((s:any)=>[].concat(s.Action).includes('s3:DeleteObject' as never)).map((s:any)=>s.Resource));
 for(const prefix of ['games/*','library-index/*','share/*','prepared-reports/*'])expect(deletes).toContain(prefix);
 for(const prefix of ['uploads/','reservations/','daily-analysis/','control/','index.html'])expect(deletes).not.toContain(prefix);
 const all=Object.values(template.toJSON().Resources as Record<string,any>).filter(r=>r.Type==='AWS::IAM::Policy').flatMap(r=>actionsOf(r.Properties.PolicyDocument.Statement));
 expect(all.filter((a:string)=>/DeleteObjectVersion/.test(a))).toEqual([]);
 const policies=Object.values(template.findResources('AWS::IAM::Policy'));const game=policies.find((policy:any)=>JSON.stringify(policy.Properties.Roles).includes('GameHandler')) as any;
 expect(actionsOf(game.Properties.PolicyDocument.Statement).filter((a:string)=>/Delete/.test(a))).toEqual([]);
});
test('OwnerApi may queue a report rebuild after a game-info edit, on the report queue only',()=>{
 const [,owner]=functionNamed(template,'Weiqi owner sign-in, owner tools and the Microsoft-token API');
 const env=owner.Properties.Environment.Variables,res=template.toJSON().Resources as Record<string,any>;
 const reportQueue=Object.keys(res).find(k=>res[k].Type==='AWS::SQS::Queue'&&k.startsWith('ReportQueue'))!;expect(env.REPORT_QUEUE).toEqual({Ref:reportQueue});
 expect(res[reportQueue].Properties.FifoQueue).toBe(true);
 const sends=roleStatements(template,owner).filter((s:any)=>[].concat(s.Action).includes('sqs:SendMessage' as never));
 expect(sends.map((s:any)=>JSON.stringify(s.Resource)).some((r:string)=>r.includes(reportQueue))).toBe(true);
 expect(sends.flatMap((s:any)=>[].concat(s.Action))).not.toContain('sqs:DeleteMessage');
});
test('owner sign-in secrets are readable only under /weiqi and the shared tenant ID, through SSM',()=>{
 for(const description of ['Weiqi owner sign-in, owner tools and the Microsoft-token API']){
  const [,fn]=functionNamed(template,description),statements=roleStatements(template,fn);
  const ssmStatement=statements.find((s:any)=>[].concat(s.Action).includes('ssm:GetParameters' as never));
  expect(JSON.stringify(ssmStatement.Resource)).toContain('parameter/weiqi/*');expect(JSON.stringify(ssmStatement.Resource)).toContain('parameter/dliu/entra-tenant-id');
  const kms=statements.find((s:any)=>[].concat(s.Action).includes('kms:Decrypt' as never));
  expect(kms.Condition.StringEquals['kms:ViaService']).toEqual({'Fn::Join':['',['ssm.',{Ref:'AWS::Region'},'.amazonaws.com']]});
 }
});
test('the public API bundle checks the limits pass but contains no delete code',()=>{
 const game=Object.values(template.toJSON().Resources as Record<string,any>).find(r=>r.Type==='AWS::Lambda::Function'&&r.Properties.ReservedConcurrentExecutions===20)!;
 const code=game.Properties.Code.ZipFile;expect(code).toContain('hasLimitsPass');expect(code).not.toMatch(/Delete(Object|Objects)Command/);expect(code).not.toMatch(/^module\.exports=/m);
});
test('W-13: the public API reads only the limits key, never the Microsoft secret, and never receives the admin session cookie',()=>{
 const res=template.toJSON().Resources as Record<string,any>;
 const [gameId,game]=Object.entries(res).find(([,r])=>r.Type==='AWS::Lambda::Function'&&r.Properties.ReservedConcurrentExecutions===20)!;
 const statements=roleStatements(template,game),ssmStatements=statements.filter((s:any)=>[].concat(s.Action).some((a:string)=>a.startsWith('ssm:')));
 expect(ssmStatements.flatMap((s:any)=>[].concat(s.Action))).toEqual(['ssm:GetParameters']);
 const resources=JSON.stringify(ssmStatements.map((s:any)=>s.Resource));
 expect(resources).toContain('parameter/weiqi/limits-key');expect(resources).not.toMatch(/weiqi\/\*|entra|dliu\//);
 expect(game.Properties.Environment.Variables.TENANT_PARAMETER).toBeUndefined();
 const dist=Object.values(res).find(r=>r.Type==='AWS::CloudFront::Distribution')!.Properties.DistributionConfig;
 const api=dist.CacheBehaviors.find((b:any)=>b.PathPattern==='api/*');
 const urlId=Object.keys(res).find(k=>res[k].Type==='AWS::Lambda::Url'&&JSON.stringify(res[k].Properties.TargetFunctionArn).includes(gameId))!;
 expect(JSON.stringify(dist.Origins.find((o:any)=>o.Id===api.TargetOriginId).DomainName)).toContain(urlId);
 const policy=res[api.OriginRequestPolicyId.Ref].Properties.OriginRequestPolicyConfig;
 expect(policy.CookiesConfig).toEqual({CookieBehavior:'allExcept',Cookies:['__Host-weiqi_session','__Host-weiqi_auth']});
 expect(policy.HeadersConfig).toEqual({HeaderBehavior:'allExcept',Headers:['host']});
 expect(policy.QueryStringsConfig).toEqual({QueryStringBehavior:'all'});
});
test('/auth/* and /api/owner/* reach OwnerApi uncached, ahead of the public /api/* behaviour',()=>{
 const res=template.toJSON().Resources as Record<string,any>;const [ownerId]=functionNamed(template,'Weiqi owner sign-in, owner tools and the Microsoft-token API');
 const dist=Object.values(res).find(r=>r.Type==='AWS::CloudFront::Distribution')!.Properties.DistributionConfig;
 const patterns=dist.CacheBehaviors.map((b:any)=>b.PathPattern);
 expect(patterns.indexOf('api/owner/*')).toBeLessThan(patterns.indexOf('api/*'));expect(patterns).toContain('auth/*');
 const owner=dist.CacheBehaviors.find((b:any)=>b.PathPattern==='api/owner/*'),auth=dist.CacheBehaviors.find((b:any)=>b.PathPattern==='auth/*');
 expect(auth.AllowedMethods).toEqual(['GET','HEAD']);
 for(const b of [owner,auth]){expect(b.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');expect(b.ResponseHeadersPolicyId).toBeDefined();expect(b.TargetOriginId).toBe(owner.TargetOriginId);}
 const origin=dist.Origins.find((o:any)=>o.Id===owner.TargetOriginId);expect(JSON.stringify(origin.DomainName)).toContain('OwnerApi');
 const urls=Object.values(res).filter(r=>r.Type==='AWS::Lambda::Url'&&JSON.stringify(r.Properties.TargetFunctionArn).includes(ownerId));
 expect(urls.map(u=>u.Properties.AuthType)).toEqual(['AWS_IAM']);
 const perms=Object.values(res).filter(r=>r.Type==='AWS::Lambda::Permission'&&JSON.stringify(r.Properties.FunctionName).includes(ownerId));
 expect(perms.every(r=>r.Properties.Principal==='cloudfront.amazonaws.com')).toBe(true);
});
test('finished saved games are edge-cached on the path only (GET only); the list and live API stay uncached',()=>{
 const res=template.toJSON().Resources as Record<string,any>;
 const dist=Object.values(res).find(r=>r.Type==='AWS::CloudFront::Distribution')!.Properties.DistributionConfig;
 const patterns=dist.CacheBehaviors.map((b:any)=>b.PathPattern);
 expect(patterns.indexOf('api/library/*')).toBeGreaterThan(-1);expect(patterns.indexOf('api/library/*')).toBeLessThan(patterns.indexOf('api/*'));
 const library=dist.CacheBehaviors.find((b:any)=>b.PathPattern==='api/library/*'),api=dist.CacheBehaviors.find((b:any)=>b.PathPattern==='api/*');
 expect(library.TargetOriginId).toBe(api.TargetOriginId);expect(library.OriginRequestPolicyId).toEqual(api.OriginRequestPolicyId);
 expect(library.AllowedMethods).toEqual(['GET','HEAD']);expect(library.Compress).toBe(true);expect(api.CachePolicyId).toBe(cloudfrontNoCache());
 const cache=res[library.CachePolicyId.Ref].Properties.CachePolicyConfig;
 expect(cache.MinTTL).toBe(0);expect(cache.DefaultTTL).toBe(0);expect(cache.MaxTTL).toBe(86400);
 expect(cache.ParametersInCacheKeyAndForwardedToOrigin).toMatchObject({HeadersConfig:{HeaderBehavior:'none'},CookiesConfig:{CookieBehavior:'none'},QueryStringsConfig:{QueryStringBehavior:'none'},EnableAcceptEncodingGzip:true,EnableAcceptEncodingBrotli:true});
 const [fn]=library.FunctionAssociations;expect(fn.EventType).toBe('viewer-request');
 const code=res[fn.FunctionARN['Fn::GetAtt'][0]].Properties.FunctionCode;
 expect(code).toContain("request.method!=='GET'");expect(code).toContain('statusCode:405');expect(code).toContain('x-weiqi-viewer');
 const [,game]=Object.entries(res).find(([,r])=>r.Type==='AWS::Lambda::Function'&&r.Properties.ReservedConcurrentExecutions===20)!;
 const [,owner]=functionNamed(template,'Weiqi owner sign-in, owner tools and the Microsoft-token API');
 expect(game.Properties.Environment.Variables.EDGE_CACHE_SECONDS).toBe('86400');
 expect(owner.Properties.Environment.Variables.EDGE_CACHE_SECONDS).toBeUndefined();
 expect(owner.Properties.Environment.Variables.DISTRIBUTION_PARAMETER).toBe('/weiqi/distribution-id');
 template.hasResourceProperties('AWS::SSM::Parameter',{Name:'/weiqi/distribution-id',Type:'String',Value:{Ref:Match.stringLikeRegexp('SiteDistribution')}});
 const invalidations=Object.values(res).filter(r=>r.Type==='AWS::IAM::Policy').flatMap(r=>r.Properties.PolicyDocument.Statement.filter((s:any)=>[].concat(s.Action).includes('cloudfront:CreateInvalidation' as never)).map((s:any)=>({s,roles:r.Properties.Roles})));
 expect(invalidations).toHaveLength(1);
 expect(invalidations[0].roles).toEqual([{Ref:owner.Properties.Role['Fn::GetAtt'][0]}]);
 expect(JSON.stringify(invalidations[0].s.Resource)).toMatch(/distribution\/.*SiteDistribution/);
 expect(actionsOf(roleStatements(template,game))).not.toContain('cloudfront:CreateInvalidation');
});
test('the managed API exists only when enabled; every route needs a Microsoft token with its weiqi.* scope',()=>{
 expect(Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))).toEqual([]);
 const managed=Template.fromStack(makeSite('Managed',{microsoftApi:true}));
 const routes=Object.values(managed.findResources('AWS::ApiGatewayV2::Route')) as any[];
 expect(Object.fromEntries(routes.map(r=>[r.Properties.RouteKey,r.Properties.AuthorizationScopes]))).toEqual(Object.fromEntries(Object.entries(ownerRoutes).map(([k,v])=>[k,[v.scope]])));
 expect(routes.every(r=>r.Properties.AuthorizationType==='JWT')).toBe(true);
 expect(new Set(Object.values(ownerRoutes).map(v=>v.scope))).toEqual(new Set(['weiqi.read','weiqi.write','weiqi.delete']));
 managed.hasResourceProperties('AWS::ApiGatewayV2::Authorizer',{AuthorizerType:'JWT',IdentitySource:['$request.header.Authorization'],JwtConfiguration:{Audience:[Match.anyValue()],Issuer:Match.anyValue()}});
 managed.hasResourceProperties('AWS::ApiGatewayV2::Stage',{DefaultRouteSettings:{ThrottlingRateLimit:10,ThrottlingBurstLimit:20}});
 const apiHost={'Fn::Join':['',['api.weiqi.',{'Fn::ImportValue':'MainDomain'}]]};
 managed.hasResourceProperties('AWS::ApiGatewayV2::Api',{DisableExecuteApiEndpoint:true});
 managed.hasResourceProperties('AWS::CertificateManager::Certificate',{DomainName:apiHost,ValidationMethod:'DNS'});
 managed.hasResourceProperties('AWS::ApiGatewayV2::DomainName',{DomainName:apiHost,DomainNameConfigurations:[Match.objectLike({EndpointType:'REGIONAL',SecurityPolicy:'TLS_1_2'})]});
 managed.resourceCountIs('AWS::ApiGatewayV2::ApiMapping',1);
 managed.hasResourceProperties('AWS::Route53::RecordSet',{Type:'A',Name:{'Fn::Join':['',['api.weiqi.',{'Fn::ImportValue':'MainDomain'},'.']]}});
 managed.hasOutput('MicrosoftApiUrl',{Value:{'Fn::Join':['',['https://api.weiqi.',{'Fn::ImportValue':'MainDomain'}]]}});
 const [,owner]=functionNamed(managed,'Weiqi owner sign-in, owner tools and the Microsoft-token API');
 expect(Object.keys(owner.Properties.Environment.Variables)).toEqual(expect.arrayContaining(['API_GATEWAY_ID','API_TENANT_ID','API_AUDIENCE','API_CLIENT_ID']));
});
