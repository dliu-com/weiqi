#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { WeiqiSiteStack } from '../lib/weiqi-site-stack';

const app = new App();
if((process.env.CDK_DEFAULT_REGION||'eu-west-1')!=='eu-west-1')throw Error('Weiqi resources must be provisioned in Ireland (eu-west-1).');
new WeiqiSiteStack(app, 'WeiqiSite', {
  tags: { service: 'weiqi' },
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
  },
});

if(app.node.tryGetContext('benchmarks')){
 const {WeiqiBenchmarkStack}=require('../lib/weiqi-benchmark-stack');
 const libraryBucket=app.node.tryGetContext('libraryBucket');
 if(!libraryBucket)throw Error('Provide -c libraryBucket=<bucket> for benchmark deployment.');
 new WeiqiBenchmarkStack(app,'WeiqiCpuAnalysis',{analysisQueueArn:app.node.tryGetContext('analysisQueueArn'),enableGpu:app.node.tryGetContext('gpu')==='true',libraryBucket,tags:{service:'weiqi-benchmark'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION || 'eu-west-1'}});
}
if(app.node.tryGetContext('fargate')){
 const {WeiqiFargateStack}=require('../lib/weiqi-fargate-stack');new WeiqiFargateStack(app,'WeiqiFargate',{dispatchEnabled:app.node.tryGetContext('cpuDispatch')!=='false',libraryBucket:app.node.tryGetContext('libraryBucket'),analysisQueueArn:app.node.tryGetContext('analysisQueueArn'),tags:{service:'weiqi-fargate'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION || 'eu-west-1'}});
}
if(app.node.tryGetContext('gpuBenchmark')){
 const {WeiqiGpuBenchmarkStack}=require('../lib/weiqi-gpu-benchmark-stack');
 new WeiqiGpuBenchmarkStack(app,'WeiqiGpuBenchmark',{libraryBucket:app.node.tryGetContext('libraryBucket'),production:app.node.tryGetContext('gpuProduction')==='true',dispatchEnabled:app.node.tryGetContext('gpuDispatch')!=='false',analysisQueueArn:app.node.tryGetContext('analysisQueueArn'),cpuQuickQueue:app.node.tryGetContext('cpuQuickQueue'),cpuDeepQueue:app.node.tryGetContext('cpuDeepQueue'),cpuJobDefinition:app.node.tryGetContext('cpuJobDefinition'),tags:{service:'weiqi-gpu-benchmark'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION||'eu-west-1'}});
}
