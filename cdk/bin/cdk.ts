#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { WeiqiSiteStack } from '../lib/weiqi-site-stack';

const app = new App();
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
 const {WeiqiFargateStack}=require('../lib/weiqi-fargate-stack');new WeiqiFargateStack(app,'WeiqiFargate',{libraryBucket:app.node.tryGetContext('libraryBucket'),analysisQueueArn:app.node.tryGetContext('analysisQueueArn'),tags:{service:'weiqi-fargate'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION || 'eu-west-1'}});
}
if(app.node.tryGetContext('gpuBenchmark')){
 const {WeiqiGpuBenchmarkStack}=require('../lib/weiqi-gpu-benchmark-stack');
 new WeiqiGpuBenchmarkStack(app,'WeiqiGpuBenchmark',{libraryBucket:app.node.tryGetContext('libraryBucket'),tags:{service:'weiqi-gpu-benchmark'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION||'eu-west-1'}});
}
