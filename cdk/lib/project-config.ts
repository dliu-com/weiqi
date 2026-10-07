import * as fs from 'fs';
import * as path from 'path';
// CDK's existing YAML dependency; the source file contains no private recipient.
const yaml=require('js-yaml');
export const projectConfig=yaml.safeLoad(fs.readFileSync(path.join(__dirname,'../../configs.yml'),'utf8'));
if(projectConfig.aws.region!=='eu-west-1')throw Error('Weiqi resources must stay in Ireland.');
for(const [name,value]of Object.entries(projectConfig.analysis))if(!Number.isInteger(value)||Number(value)<=0)throw Error('Invalid analysis setting: '+name);
if(!Number.isFinite(projectConfig.budget.monthlyUsd)||projectConfig.budget.monthlyUsd<=0)throw Error('Invalid monthly budget.');
if(!Number.isFinite(projectConfig.budget.dailyUsd)||projectConfig.budget.dailyUsd<=0)throw Error('Invalid daily budget.');
if(!Number.isFinite(projectConfig.positionAnalysis.dailyUsd)||projectConfig.positionAnalysis.dailyUsd<=0||projectConfig.positionAnalysis.dailyUsd>projectConfig.budget.dailyUsd)throw Error('Invalid public position allowance.');
if(!projectConfig.project.tagKey||!projectConfig.project.tagValue)throw Error('Missing project tag.');

for(const name of ['requestReserveMicros','recognitionMemoryMb','recognitionTimeoutSeconds','aiMemoryMb','aiTimeoutSeconds','aiVisits'])if(!Number.isInteger(projectConfig.positionAnalysis[name])||projectConfig.positionAnalysis[name]<=0)throw Error('Invalid position setting: '+name);
for(const name of ['recognitionTimeoutSeconds','aiTimeoutSeconds'])if(projectConfig.positionAnalysis[name]>26)throw Error('Position worker must finish within the public API deadline.');
const worstPositionUSD=Math.max(projectConfig.positionAnalysis.recognitionMemoryMb/1024*projectConfig.positionAnalysis.recognitionTimeoutSeconds,projectConfig.positionAnalysis.aiMemoryMb/1024*projectConfig.positionAnalysis.aiTimeoutSeconds)*0.0000166667+30*.25*0.0000166667+0.00002;
if(projectConfig.positionAnalysis.requestReserveMicros/1000000<worstPositionUSD)throw Error('Position request reservation must cover bounded worker and API runtime costs.');
