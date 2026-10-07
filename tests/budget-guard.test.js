import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
function harness(spend=51,dailySpend=null){
 const files=new Map([['games/20261006/01/metadata.json',JSON.stringify({analysis:{status:'running',available:'quick',quick:{status:'ready'},deep:{status:'running'},retryAt:'later'}})]]),operations=[];let active=true;
 const command=name=>class {constructor(input){this.input=input;this.name=name;}};
 const s3cmd={GetObjectCommand:command('get'),PutObjectCommand:command('put')},batchcmd={UpdateJobQueueCommand:command('disable'),ListJobsCommand:command('list'),TerminateJobCommand:command('terminate')},budgetcmd={DescribeBudgetCommand:command('budget')};
 class S3Client{async send(c){if(c.name==='get'){if(!files.has(c.input.Key))throw Object.assign(Error(),{name:'NoSuchKey'});return {ETag:'v1',Body:{transformToString:async()=>files.get(c.input.Key)}};}operations.push(c);files.set(c.input.Key,c.input.Body);return {};}}
 class BatchClient{async send(c){operations.push(c);if(c.name==='list')return {jobSummaryList:active&&c.input.jobStatus==='RUNNING'?[{jobId:'job1',jobName:'weiqi-2026100601-a1-1234abcd'}]:[]};if(c.name==='terminate')active=false;return {};}}
 class BudgetsClient{async send(c){return {Budget:{CalculatedSpend:{ActualSpend:{Amount:String(c.input.BudgetName==='Weiqi-monthly-spending'?spend:dailySpend),Unit:'USD'}}}};}}
 const exports={};vm.runInNewContext(readFileSync(new URL('../backend/budget-guard.cjs',import.meta.url),'utf8'),{exports,process:{env:{LIBRARY_BUCKET:'library',AI_CONTROL_KEY:'control/ai-spending.json',JOB_QUEUES:'["owned-queue"]',BUDGET_TOPIC_ARN:'trusted-topic',ACCOUNT_ID:'123456789012',BUDGET_NAME:'Weiqi-monthly-spending',MONTHLY_USD:'50',DAILY_USD:'15',DAILY_BUDGET_NAMES:dailySpend===null?'[]':'["daily-project","daily-service"]'}},require:name=>name.includes('client-s3')?{S3Client,...s3cmd}:name.includes('client-batch')?{BatchClient,...batchcmd}:{BudgetsClient,...budgetcmd}});
 return {files,operations,call:exports.handler,alert:()=>exports.handler({Records:[{EventSource:'aws:sns',Sns:{TopicArn:'trusted-topic',Message:'budget alert'}}]})};
}
test('actual spend over USD50 latches pause, disables owned queues and terminates jobs while keeping completed quick analysis',async()=>{
 const h=harness();assert.equal((await h.alert()).paused,true);const flag=JSON.parse(h.files.get('control/ai-spending.json'));assert.equal(flag.thresholdUSD,50);const s=JSON.parse(h.files.get('games/20261006/01/metadata.json')).analysis;assert.equal(s.status,'paused');assert.equal(s.quick.status,'ready');assert.equal(s.deep.status,'paused');assert.equal(s.retryAt,undefined);assert.equal(h.operations.filter(c=>c.name==='terminate').length,1);assert.equal(h.operations.find(c=>c.name==='disable').input.jobQueue,'owned-queue');await h.alert();assert.equal(h.files.get('control/ai-spending.json'),JSON.stringify(flag));
});
test('setup/test messages below the threshold and messages from another SNS topic cannot pause AI',async()=>{
 const h=harness(50);await h.alert();assert.equal(h.operations.length,0);const untrusted=harness();await untrusted.call({Records:[{EventSource:'aws:sns',Sns:{TopicArn:'another-topic'}}]});assert.equal(untrusted.operations.length,0);
});
test('scheduled reconciliation catches a missed alert; private dry run performs no writes or cancellations',async()=>{
 const h=harness();const dry=await h.call({mode:'dryRun'});assert.equal(dry.activeJobs,1);assert.equal(dry.overBudget,true);assert.equal(h.operations.every(c=>c.name==='list'),true);assert.equal(h.files.has('control/ai-spending.json'),false);assert.equal((await h.call({source:'aws.events'})).paused,true);
});
test('private resume refuses an exhausted monthly budget and re-enables queues only when spending permits',async()=>{
 const exhausted=harness();assert.equal((await exhausted.call({mode:'resume'})).resumed,false);assert.equal(exhausted.operations.length,0);
 const safe=harness(49);safe.files.set('control/ai-spending.json','{"paused":true}');assert.equal((await safe.call({mode:'resume'})).resumed,true);assert.equal(safe.operations.find(c=>c.name==='disable').input.state,'ENABLED');assert.equal(JSON.parse(safe.files.get('control/ai-spending.json')).paused,false);
});

test('daily tagged-project spend above USD15 pauses all AI and prevents resume independently of the monthly limit',async()=>{const h=harness(10,16);assert.equal((await h.call({source:'aws.events'})).paused,true);const flag=JSON.parse(h.files.get('control/ai-spending.json'));assert.equal(flag.reason,'daily_budget');assert.equal(flag.thresholdUSD,15);assert.equal((await h.call({mode:'resume'})).resumed,false);const nextDay=harness(10,0);nextDay.files.set('control/ai-spending.json','{"paused":true,"reason":"daily_budget"}');assert.equal((await nextDay.call({mode:'resume'})).resumed,true);});
