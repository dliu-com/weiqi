import {App} from 'aws-cdk-lib';
import {Template,Match} from 'aws-cdk-lib/assertions';
import {WeiqiGpuBenchmarkStack} from '../lib/weiqi-gpu-benchmark-stack';
const template=Template.fromStack(new WeiqiGpuBenchmarkStack(new App(),'GpuTest',{libraryBucket:'fictional-library',env:{account:'123456789012',region:'eu-west-1'}}));
test('GPU comparison isolates two instance types with zero idle capacity and no NAT gateway',()=>{
 template.resourceCountIs('AWS::Batch::ComputeEnvironment',2);
 template.resourceCountIs('AWS::EC2::NatGateway',0);
 for(const [type,cpu] of [['g4dn.xlarge',4],['g5.xlarge',4]])template.hasResourceProperties('AWS::Batch::ComputeEnvironment',{State:'ENABLED',ComputeResources:Match.objectLike({Type:'EC2',MinvCpus:0,MaxvCpus:cpu,InstanceTypes:[type]})});
 template.hasResourceProperties('AWS::EC2::VPCCidrBlock',{CidrBlock:'10.1.0.0/16'});
 template.hasResourceProperties('AWS::EC2::Subnet',{CidrBlock:'10.1.0.0/24',MapPublicIpOnLaunch:true});
 template.hasResourceProperties('AWS::Batch::JobDefinition',{RetryStrategy:{Attempts:1},Timeout:{AttemptDurationSeconds:3600},ContainerProperties:Match.objectLike({ResourceRequirements:Match.arrayWith([{Type:'GPU',Value:'1'}])})});
 template.resourceCountIs('AWS::Lambda::Function',0);
});

test('production uses T4 across three zones, delayed fallback messages and bounded jobs without idle polling',()=>{
 const prod=Template.fromStack(new WeiqiGpuBenchmarkStack(new App(),'GpuProduction',{libraryBucket:'fictional-library',production:true,analysisQueueArn:'arn:aws:sqs:eu-west-1:123456789012:uploads',cpuQuickQueue:'arn:aws:batch:eu-west-1:123456789012:job-queue/cpu-quick',cpuDeepQueue:'arn:aws:batch:eu-west-1:123456789012:job-queue/cpu-deep',cpuJobDefinition:'arn:aws:batch:eu-west-1:123456789012:job-definition/cpu:1',env:{account:'123456789012',region:'eu-west-1'}}));
 prod.resourceCountIs('AWS::Batch::ComputeEnvironment',1);
 prod.hasResourceProperties('AWS::Batch::ComputeEnvironment',{ComputeResources:Match.objectLike({MinvCpus:0,InstanceTypes:['g4dn.xlarge'],Subnets:Match.arrayWith([{Ref:'CapacitySubnet'}])})});
 prod.resourceCountIs('AWS::Lambda::EventSourceMapping',2);
 prod.hasResourceProperties('AWS::Batch::JobDefinition',{Timeout:{AttemptDurationSeconds:14400}});
 const rules=Object.values(prod.findResources('AWS::Events::Rule'));for(const rule of rules)expect(rule.Properties.ScheduleExpression).toBeUndefined();
 prod.resourceCountIs('AWS::EC2::NatGateway',0);
});
