#!/usr/bin/env node
import 'source-map-support/register';
import { App, Tags } from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import {projectConfig} from '../lib/project-config';
import { WeiqiStorageStack } from '../lib/weiqi-storage-stack';
import { WeiqiSiteStack } from '../lib/weiqi-site-stack';

const app = new App();
const profilePath=path.join(__dirname,'../../cloud/deployment-config.json');
const profile=fs.existsSync(profilePath)?JSON.parse(fs.readFileSync(profilePath,'utf8')):{};
const context=(name:string)=>app.node.tryGetContext(name)??profile[name];
if((process.env.CDK_DEFAULT_REGION||'eu-west-1')!=='eu-west-1')throw Error('Weiqi resources must be provisioned in Ireland (eu-west-1).');
const storage=new WeiqiStorageStack(app,'WeiqiStorage',{terminationProtection:true,tags:{service:'weiqi'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION||'eu-west-1'}});
new WeiqiSiteStack(app, 'WeiqiSite', {storage,
  analysisQueueArnOverride:context('analysisQueueArnOverride'),keepLegacyAnalysisQueue:context('keepLegacyAnalysisQueue')!=='false',
  tags: { service: 'weiqi' },
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
  },
});

if(context('benchmarks')){
 const {WeiqiBenchmarkStack}=require('../lib/weiqi-benchmark-stack');
 const libraryBucket=context('libraryBucket');
 if(!libraryBucket)throw Error('Provide -c libraryBucket=<bucket> for benchmark deployment.');
 new WeiqiBenchmarkStack(app,'WeiqiCpuAnalysis',{analysisQueueArn:context('analysisQueueArn'),enableGpu:context('gpu')==='true',libraryBucket,tags:{service:'weiqi-benchmark'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION || 'eu-west-1'}});
}
if(context('fargate')==='true'){
 const {WeiqiFargateStack}=require('../lib/weiqi-fargate-stack');new WeiqiFargateStack(app,'WeiqiFargate',{dispatchEnabled:context('cpuDispatch')!=='false',libraryBucket:context('libraryBucket'),analysisQueueArn:context('analysisQueueArn'),tags:{service:'weiqi-fargate'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION || 'eu-west-1'}});
}
if(context('gpuBenchmark')){
 const {WeiqiGpuBenchmarkStack}=require('../lib/weiqi-gpu-benchmark-stack');
 const gpu=new WeiqiGpuBenchmarkStack(app,'WeiqiGpuBenchmark',{libraryBucket:context('libraryBucket'),production:context('gpuProduction')==='true',dispatchEnabled:context('gpuDispatch')!=='false',analysisQueueArn:context('analysisQueueArn'),cpuQuickQueue:context('cpuQuickQueue'),cpuDeepQueue:context('cpuDeepQueue'),cpuJobDefinition:context('cpuJobDefinition'),tags:{service:'weiqi-gpu-benchmark'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION||'eu-west-1'}});
 if(context('spendingGuard')==='true'){const {WeiqiBudgetStack}=require('../lib/weiqi-budget-stack');new WeiqiBudgetStack(app,'WeiqiBudget',{libraryBucket:context('libraryBucket'),jobQueues:gpu.productionJobQueues,tags:{service:'weiqi'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:'eu-west-1'}});}
}

if(context('positionAnalysis')==='true'){
 const {WeiqiPositionStack}=require('../lib/weiqi-position-stack');
 const release=JSON.parse(fs.readFileSync(path.join(__dirname,'../../cloud/position-release.json'),'utf8'));
 new WeiqiPositionStack(app,'WeiqiPositionAnalysis',{libraryBucket:context('libraryBucket'),release,tags:{service:'weiqi'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:'eu-west-1'}});
}

// Stack tags propagate to every supported CloudFormation resource.
for(const stack of app.node.children)Tags.of(stack).add(projectConfig.project.tagKey,projectConfig.project.tagValue,{excludeResourceTypes:['AWS::Batch::ComputeEnvironment','AWS::Batch::JobQueue']});
