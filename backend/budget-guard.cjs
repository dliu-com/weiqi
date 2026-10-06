// Private IAM/SNS entry point; never exposed through the website API.
const {S3Client,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const {BatchClient,UpdateJobQueueCommand,ListJobsCommand,TerminateJobCommand}=require('@aws-sdk/client-batch');
const {BudgetsClient,DescribeBudgetCommand}=require('@aws-sdk/client-budgets');
const s3=new S3Client({}),batch=new BatchClient({}),budgets=new BudgetsClient({});
const bucket=process.env.LIBRARY_BUCKET,key=process.env.AI_CONTROL_KEY;
const queues=JSON.parse(process.env.JOB_QUEUES);
async function overBudget(){const o=await budgets.send(new DescribeBudgetCommand({AccountId:process.env.ACCOUNT_ID,BudgetName:process.env.BUDGET_NAME}));const actual=o.Budget?.CalculatedSpend?.ActualSpend;return actual?.Unit==='USD'&&Number(actual.Amount)>Number(process.env.MONTHLY_USD);}
async function control(){try{const o=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));return JSON.parse(await o.Body.transformToString());}catch(e){if(e.name==='NoSuchKey')return {paused:false};throw e;}}
async function pauseGame(job){
 const match=/^weiqi-(\d{10,14})-a\d+-[a-f0-9]{8}$/.exec(job.jobName||'');if(!match)return;
 const id=match[1],path='games/'+id.slice(0,8)+'/'+id.slice(8)+'/metadata.json';
 for(let n=0;n<6;n++){
  const o=await s3.send(new GetObjectCommand({Bucket:bucket,Key:path})),m=JSON.parse(await o.Body.transformToString()),s=m.analysis;
  if(s.deep?.status==='ready'||['ready','limited','paused'].includes(s.status))return;
  s.status='paused';s.reason='monthly_budget';s.pausedAt=new Date().toISOString();delete s.retryAt;delete s.retrySentAt;
  for(const p of ['quick','deep'])if(s[p]&&s[p].status!=='ready')s[p]={...s[p],status:'paused'};
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
     await batch.send(new TerminateJobCommand({jobId:job.jobId,reason:'Weiqi monthly spending safeguard'}));
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
  if(await overBudget())return {resumed:false,reason:'monthly_budget_exceeded',message:'Raise the monthly budget in configs.yml and deploy it, or wait for the next month, then run make ai-resume again.'};
  for(const queue of queues)await batch.send(new UpdateJobQueueCommand({jobQueue:queue,state:'ENABLED'}));
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,ContentType:'application/json',Body:JSON.stringify({paused:false,resumedAt:new Date().toISOString()})}));
  return {resumed:true,message:'AI is enabled for newly saved games. Previously stopped analyses are not automatically restarted.'};
 }
 if(event.mode==='status')return {...await control(),overBudget:await overBudget(),monthlyUsd:Number(process.env.MONTHLY_USD)};
 if(event.mode==='dryRun')return {dryRun:true,overBudget:await overBudget(),paused:(await control()).paused===true,queues:queues.length,activeJobs:await stopJobs(true)};
 const alert=event.Records?.some(r=>r.EventSource==='aws:sns'&&r.Sns?.TopicArn===process.env.BUDGET_TOPIC_ARN);
 // Confirm the budget's actual spend rather than treating SNS setup/test
 // messages or a forecast notification as a spending breach.
 if((alert||event.source==='aws.events')&&await overBudget()){const old=await control();if(!old.paused)await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,ContentType:'application/json',Body:JSON.stringify({paused:true,reason:'monthly_budget',thresholdUSD:Number(process.env.MONTHLY_USD),pausedAt:new Date().toISOString()})}));}
 if(!(await control()).paused)return {paused:false};
 return {paused:true,stopped:await stopJobs()};
};
