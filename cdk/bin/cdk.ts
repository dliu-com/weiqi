#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { WeiqiSiteStack } from '../lib/weiqi-site-stack';

const app = new App();
const profilePath=path.join(__dirname,'../../cloud/deployment-config.json');
const profile=fs.existsSync(profilePath)?JSON.parse(fs.readFileSync(profilePath,'utf8')):{};
const context=(name:string)=>app.node.tryGetContext(name)??profile[name];
if((process.env.CDK_DEFAULT_REGION||'eu-west-1')!=='eu-west-1')throw Error('Weiqi resources must be provisioned in Ireland (eu-west-1).');
new WeiqiSiteStack(app, 'WeiqiSite', {
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
if(context('fargate')){
 const {WeiqiFargateStack}=require('../lib/weiqi-fargate-stack');new WeiqiFargateStack(app,'WeiqiFargate',{dispatchEnabled:context('cpuDispatch')!=='false',libraryBucket:context('libraryBucket'),analysisQueueArn:context('analysisQueueArn'),tags:{service:'weiqi-fargate'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION || 'eu-west-1'}});
}
if(context('gpuBenchmark')){
 const {WeiqiGpuBenchmarkStack}=require('../lib/weiqi-gpu-benchmark-stack');
 new WeiqiGpuBenchmarkStack(app,'WeiqiGpuBenchmark',{libraryBucket:context('libraryBucket'),production:context('gpuProduction')==='true',dispatchEnabled:context('gpuDispatch')!=='false',analysisQueueArn:context('analysisQueueArn'),cpuQuickQueue:context('cpuQuickQueue'),cpuDeepQueue:context('cpuDeepQueue'),cpuJobDefinition:context('cpuJobDefinition'),tags:{service:'weiqi-gpu-benchmark'},env:{account:process.env.CDK_DEFAULT_ACCOUNT,region:process.env.CDK_DEFAULT_REGION||'eu-west-1'}});
}
