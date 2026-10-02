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
