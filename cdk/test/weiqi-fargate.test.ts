import {App} from 'aws-cdk-lib';
import {Template} from 'aws-cdk-lib/assertions';
import {WeiqiFargateStack} from '../lib/weiqi-fargate-stack';
const template=Template.fromStack(new WeiqiFargateStack(new App(),'TestFargate',{libraryBucket:'fictional-library',analysisQueueArn:'arn:aws:sqs:eu-west-1:123456789012:fictional-queue',env:{account:'123456789012',region:'eu-west-1'}}));
test('quick and deep jobs have separate Fargate capacity without NAT or incoming network access',()=>{
 template.resourceCountIs('AWS::Batch::ComputeEnvironment',2);
 template.hasResourceProperties('AWS::Batch::ComputeEnvironment',{ComputeResources:{Type:'FARGATE',MaxvCpus:32}});
 template.hasResourceProperties('AWS::Batch::ComputeEnvironment',{ComputeResources:{Type:'FARGATE',MaxvCpus:32}});
 template.resourceCountIs('AWS::EC2::NatGateway',0);
 const groups=template.findResources('AWS::EC2::SecurityGroup');for(const resource of Object.values(groups))expect(resource.Properties.SecurityGroupIngress).toBeUndefined();
});
test('workers stop on completion with bounded runs and no automatic paid retries',()=>{
 template.hasResourceProperties('AWS::Batch::JobDefinition',{PlatformCapabilities:['FARGATE'],RetryStrategy:{Attempts:1},Timeout:{AttemptDurationSeconds:14400}});
 template.resourceCountIs('AWS::Lambda::Url',0);
 const functions=template.findResources('AWS::Lambda::Function');for(const resource of Object.values(functions))expect(resource.Properties.ProvisionedConcurrencyConfig).toBeUndefined();
});
