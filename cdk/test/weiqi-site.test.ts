import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { WeiqiStorageStack } from '../lib/weiqi-storage-stack';
import { WeiqiSiteStack } from '../lib/weiqi-site-stack';

const app=new App();const storage=new WeiqiStorageStack(app,'WeiqiStorage',{terminationProtection:true});const site=new WeiqiSiteStack(app,'TestWeiqi',{storage});
const template=Template.fromStack(site),retained=Template.fromStack(storage);
function makeSite(id:string,props:any){const app=new App(),storage=new WeiqiStorageStack(app,'WeiqiStorage',{env:props.env});return new WeiqiSiteStack(app,id,{...props,storage});}

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
 template.resourceCountIs('AWS::Lambda::EventSourceMapping',0);
 template.hasResourceProperties('AWS::Lambda::Function',{Environment:{Variables:Match.objectLike({LIBRARY_BUCKET:Match.anyValue(),ANALYSIS_QUEUE:Match.anyValue()})}});
});

test('validated upload queue can be selected while retaining the old queue for draining',()=>{
 const selected='arn:aws:sqs:eu-west-1:123456789012:validated-uploads';
 const cutover=Template.fromStack(makeSite('Cutover',{analysisQueueArnOverride:selected,env:{account:'123456789012',region:'eu-west-1'}}));
 cutover.resourceCountIs('AWS::SQS::Queue',1);
 const functions=Object.values(cutover.findResources('AWS::Lambda::Function'));
 const game=functions.find(f=>f.Properties.Environment?.Variables?.ANALYSIS_QUEUE);
 expect(JSON.stringify(game?.Properties.Environment.Variables.ANALYSIS_QUEUE)).toContain('validated-uploads');
 cutover.hasResourceProperties('AWS::IAM::Policy',{PolicyDocument:{Statement:Match.arrayWith([Match.objectLike({Action:Match.arrayWith(['sqs:SendMessage']),Resource:selected})])}});
});

test('legacy upload queue can be removed after the selected route is validated',()=>{
 const final=Template.fromStack(makeSite('Final',{analysisQueueArnOverride:'arn:aws:sqs:eu-west-1:123456789012:validated-uploads',keepLegacyAnalysisQueue:false,env:{account:'123456789012',region:'eu-west-1'}}));
 final.resourceCountIs('AWS::SQS::Queue',0);
 expect(()=>makeSite('Invalid',{keepLegacyAnalysisQueue:false})).toThrow('queue');
});

test('completed GPU jobs prepare cached reports through an event, without another paid worker',()=>{
 template.hasResourceProperties('AWS::Events::Rule',{EventPattern:{source:['aws.batch'],'detail-type':['Batch Job State Change'],detail:{status:['SUCCEEDED'],jobName:[{prefix:'weiqi-'}]}},Targets:Match.arrayWith([Match.objectLike({RetryPolicy:{MaximumRetryAttempts:2,MaximumEventAgeInSeconds:3600}})])});
 template.hasResourceProperties('AWS::Lambda::Permission',{Principal:'events.amazonaws.com',Action:'lambda:InvokeFunction'});
});
