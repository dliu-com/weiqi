import * as fs from 'fs';
import * as path from 'path';
// CDK's existing YAML dependency; the source file contains no private recipient.
const yaml=require('js-yaml');
export const projectConfig=yaml.safeLoad(fs.readFileSync(path.join(__dirname,'../../configs.yml'),'utf8'));
if(projectConfig.aws.region!=='eu-west-1')throw Error('Weiqi resources must stay in Ireland.');
for(const [name,value]of Object.entries(projectConfig.analysis))if(!Number.isInteger(value)||Number(value)<=0)throw Error('Invalid analysis setting: '+name);
if(!Number.isFinite(projectConfig.budget.monthlyUsd)||projectConfig.budget.monthlyUsd<=0)throw Error('Invalid monthly budget.');
if(!projectConfig.project.tagKey||!projectConfig.project.tagValue)throw Error('Missing project tag.');
