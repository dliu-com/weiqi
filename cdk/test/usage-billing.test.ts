import {App} from 'aws-cdk-lib';import {Template} from 'aws-cdk-lib/assertions';
import {WeiqiStorageStack} from '../lib/weiqi-storage-stack';import {WeiqiSiteStack} from '../lib/weiqi-site-stack';
import {WeiqiGpuBenchmarkStack} from '../lib/weiqi-gpu-benchmark-stack';import {WeiqiBudgetStack} from '../lib/weiqi-budget-stack';import {WeiqiPositionStack} from '../lib/weiqi-position-stack';

// Production must stay usage-billed: idle charges are limited to retained storage
// and the tiny spending-guard schedule (under US$2/month in total).
const env={account:'123456789012',region:'eu-west-1'},app=new App(),storage=new WeiqiStorageStack(app,'WeiqiStorage',{env});
const gpu=new WeiqiGpuBenchmarkStack(app,'Gpu',{libraryBucket:'fictional-library',production:true,analysisQueueArn:'arn:aws:sqs:eu-west-1:123456789012:uploads',cpuQuickQueue:'arn:aws:batch:eu-west-1:123456789012:job-queue/cpu-quick',cpuDeepQueue:'arn:aws:batch:eu-west-1:123456789012:job-queue/cpu-deep',cpuJobDefinition:'arn:aws:batch:eu-west-1:123456789012:job-definition/cpu:1',env});
const stacks=[storage,new WeiqiSiteStack(app,'Site',{storage,env}),gpu,new WeiqiBudgetStack(app,'Budget',{libraryBucket:'fictional-library',jobQueues:gpu.productionJobQueues,env}),new WeiqiPositionStack(app,'Position',{libraryBucket:'fictional-library',release:{recognitionKey:'runtime/recognition.zip',aiKey:'runtime/ai.zip'},env})];
const resources=stacks.flatMap(stack=>Object.entries(Template.fromStack(stack).toJSON().Resources as Record<string,any>).map(([id,r])=>({stack:stack.stackName,id,...r})));

test('production stacks create no resources with fixed monthly charges',()=>{
 const fixed=['AWS::EC2::NatGateway','AWS::EC2::EIP','AWS::EC2::Instance','AWS::KMS::Key','AWS::WAFv2::WebACL','AWS::CloudWatch::Alarm','AWS::CloudWatch::Dashboard','AWS::SecretsManager::Secret','AWS::ElasticLoadBalancingV2::LoadBalancer','AWS::RDS::DBInstance','AWS::Route53::HostedZone','AWS::Budgets::BudgetsAction','AWS::ECS::Service'];
 expect(resources.filter(r=>fixed.includes(r.Type)||r.Type==='AWS::EC2::VPCEndpoint'&&r.Properties.VpcEndpointType==='Interface').map(r=>`${r.stack}/${r.id}`)).toEqual([]);
 expect(resources.filter(r=>r.Properties?.ProvisionedConcurrencyConfig||r.Type==='AWS::DynamoDB::Table'&&r.Properties.BillingMode!=='PAY_PER_REQUEST').map(r=>r.id)).toEqual([]);
 const compute=resources.filter(r=>r.Type==='AWS::Batch::ComputeEnvironment');expect(compute.length).toBeGreaterThan(0);
 for(const c of compute)expect(c.Properties.ComputeResources.MinvCpus).toBe(0);
});

test('Lambda logs use CloudFormation-managed log groups instead of logRetention helpers',()=>{
 expect(resources.filter(r=>r.Type==='AWS::Lambda::Function').length).toBeGreaterThan(5);
 expect(resources.filter(r=>r.Type==='Custom::LogRetention').map(r=>r.id)).toEqual([]);
 // The certificate requestor belongs to the legacy DnsValidatedCertificate construct shared with sibling sites.
 const unmanaged=resources.filter(r=>r.Type==='AWS::Lambda::Function'&&!r.id.startsWith('SiteCertificate')&&!resources.some(g=>g.stack===r.stack&&g.Type==='AWS::Logs::LogGroup'&&g.id===r.Properties.LoggingConfig?.LogGroup?.Ref));
 expect(unmanaged.map(r=>`${r.stack}/${r.id}`)).toEqual([]);
});
