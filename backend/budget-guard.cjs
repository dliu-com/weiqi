// Private IAM/SNS entry point; never exposed through the website API.
const {S3Client,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const {BatchClient,UpdateJobQueueCommand,ListJobsCommand,TerminateJobCommand}=require('@aws-sdk/client-batch');
const {BudgetsClient,DescribeBudgetCommand}=require('@aws-sdk/client-budgets');
const s3=new S3Client({}),batch=new BatchClient({}),budgets=new BudgetsClient({});
const bucket=process.env.LIBRARY_BUCKET,key=process.env.AI_CONTROL_KEY;
const queues=JSON.parse(process.env.JOB_QUEUES);
async function spendCheck(){
 const checks=[{name:process.env.BUDGET_NAME,limit:Number(process.env.MONTHLY_USD),reason:'monthly_budget'},...JSON.parse(process.env.DAILY_BUDGET_NAMES||'[]').map(name=>({name,limit:Number(process.env.DAILY_USD),reason:'daily_budget'}))];
 for(const c of checks){const o=await budgets.send(new DescribeBudgetCommand({AccountId:process.env.ACCOUNT_ID,BudgetName:c.name})),a=o.Budget?.CalculatedSpend?.ActualSpend;if(a?.Unit==='USD'&&Number(a.Amount)>c.limit)return {...c,actualUSD:Number(a.Amount)};}
 return null;
}
async function overBudget(){return Boolean(await spendCheck());}
async function activateProjectTag(){if(!process.env.PROJECT_TAG_KEY||new Date().getUTCMinutes()!==0)return;try{const {CostExplorerClient,UpdateCostAllocationTagsStatusCommand}=require('@aws-sdk/client-cost-explorer');await new CostExplorerClient({region:'us-east-1'}).send(new UpdateCostAllocationTagsStatusCommand({CostAllocationTagsStatus:[{TagKey:process.env.PROJECT_TAG_KEY,Status:'Active'}]}));}catch(e){console.log('Project billing tag awaiting discovery',{name:e.name});}}
async function control(){try{const o=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));return JSON.parse(await o.Body.transformToString());}catch(e){if(e.name==='NoSuchKey')return {paused:false};throw e;}}
async function pauseGame(job){
 const match=/^weiqi-(\d{10,14})-a\d+-[a-f0-9]{8}$/.exec(job.jobName||'');if(!match)return;
 const id=match[1],path='games/'+id.slice(0,8)+'/'+id.slice(8)+'/metadata.json';
 for(let n=0;n<6;n++){
  const o=await s3.send(new GetObjectCommand({Bucket:bucket,Key:path})),m=JSON.parse(await o.Body.transformToString()),s=m.analysis;
  if(s.deep?.status==='ready'||['ready','limited','paused'].includes(s.status))return;
  s.status='paused';s.reason=(await control()).reason||'spending_budget';s.pausedAt=new Date().toISOString();delete s.retryAt;delete s.retrySentAt;
  for(const p of ['quick','deep'])if(s[p]&&!['ready','limited'].includes(s[p].status))s[p]={...s[p],status:'paused'};
  try{await s3.send(new PutObjectCommand({Bucket:bucket,Key:path,Body:JSON.stringify(m),ContentType:'application/json',IfMatch:o.ETag}));return;}catch(e){if(![409,412].includes(e.$metadata?.httpStatusCode)||n===5)throw e;}
 }
}
async function stopJobs(dryRun=false){
 let found=0;
 for(const queue of queues){
  if(!dryRun)await batch.send(new UpdateJobQueueCommand({jobQueue:queue,state:'DISABLED'}));
  for(const jobStatus of ['SUBMITTED','PENDING','RUNNABLE','STARTING','RUNNING']){
   let nextToken;
   do{
    const page=await batch.send(new ListJobsCommand({jobQueue:queue,jobStatus,...(nextToken?{nextToken}:{})}));
    for(const job of page.jobSummaryList||[]){found++;if(dryRun)continue;
     // TerminateJob also cancels jobs which have not started. Reconciliation
     // catches a job changing state during this paginated sweep.
     await batch.send(new TerminateJobCommand({jobId:job.jobId,reason:'Weiqi project spending safeguard'}));
     await pauseGame(job);
    }
    nextToken=page.nextToken;
   }while(nextToken);
  }
 }
 return found;
}
exports.handler=async event=>{
 if(event.mode==='resume'){
  const breach=await spendCheck();if(breach)return {resumed:false,reason:breach.reason+'_exceeded',message:'The project daily or monthly spending limit is still exceeded. Wait for the next budget period or update configs.yml and deploy, then run make ai-resume again.'};
  for(const queue of queues)await batch.send(new UpdateJobQueueCommand({jobQueue:queue,state:'ENABLED'}));
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,ContentType:'application/json',Body:JSON.stringify({paused:false,resumedAt:new Date().toISOString()})}));
  return {resumed:true,message:'AI is enabled for newly saved games. Previously stopped analyses are not automatically restarted.'};
 }
 if(event.mode==='status')return {...await control(),overBudget:await overBudget(),monthlyUsd:Number(process.env.MONTHLY_USD),dailyUsd:Number(process.env.DAILY_USD||0)};
 if(event.mode==='dryRun')return {dryRun:true,overBudget:await overBudget(),paused:(await control()).paused===true,queues:queues.length,activeJobs:await stopJobs(true)};
 const alert=event.Records?.some(r=>r.EventSource==='aws:sns'&&r.Sns?.TopicArn===process.env.BUDGET_TOPIC_ARN);
 // Confirm the budget's actual spend rather than treating SNS setup/test
 // messages or a forecast notification as a spending breach.
 if(alert||event.source==='aws.events'){await activateProjectTag();const breach=await spendCheck();if(breach){const old=await control();if(!old.paused)await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,ContentType:'application/json',Body:JSON.stringify({paused:true,reason:breach.reason,thresholdUSD:breach.limit,actualUSD:breach.actualUSD,budgetName:breach.name,pausedAt:new Date().toISOString()})}));}}
 if(!(await control()).paused)return {paused:false};
 return {paused:true,stopped:await stopJobs()};
};
