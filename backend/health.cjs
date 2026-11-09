// GET /health for status.dliu.com. It ignores the request completely: no cookies, headers, query or body.
// One cheap read per dependency, no writes, no S3 LIST, and it never starts paid work.
const {S3Client,HeadObjectCommand,GetObjectCommand}=require('@aws-sdk/client-s3');
const {DynamoDBClient,GetItemCommand}=require('@aws-sdk/client-dynamodb');
const {SQSClient,GetQueueAttributesCommand}=require('@aws-sdk/client-sqs');
const {LambdaClient,GetFunctionConfigurationCommand}=require('@aws-sdk/client-lambda');
const {SSMClient,GetParametersCommand}=require('@aws-sdk/client-ssm');

const FUNCTIONS=[['pages','Pages'],['live-game','Live game and shared draft'],['library','Game library'],['reports','Game reports'],['analysis','AI game analysis'],['position','Photo recognition and position analysis'],['signin','Admin sign-in and API']];
const RANK={pass:0,warn:1,fail:2};
const CHECK_MS=2000;

const pass=()=>({status:'pass'}),warn=output=>({status:'warn',output}),fail=output=>({status:'fail',output});
function limit(promise,ms=CHECK_MS){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('timeout'),{health:'timeout'})),ms);})]).finally(()=>clearTimeout(timer));}
const reason=error=>error?.health==='timeout'?'timeout':'read failed';
// Failed is broken; Pending or an update in progress is temporary. Inactive functions start on the next call.
function functionState(config){if(config.State==='Failed'||config.LastUpdateStatus==='Failed')return 'fail';if(config.State==='Pending'||config.LastUpdateStatus==='InProgress')return 'warn';return 'pass';}

async function checkHealth({s3,db,sqs,lambda,ssm},env,now=new Date()){
 const lambdaState=name=>limit(lambda.send(new GetFunctionConfigurationCommand({FunctionName:name}))).then(functionState);
 const control=limit(s3.send(new GetObjectCommand({Bucket:env.LIBRARY_BUCKET,Key:env.AI_CONTROL_KEY})).then(r=>r.Body.transformToString()))
  .then(text=>({paused:JSON.parse(text).paused===true}),error=>error?.name==='NoSuchKey'?{paused:false}:{error});
 const [pages,game,controlState,dlq,renderer,recognizer,engine,owner,signin]=await Promise.allSettled([
  limit(s3.send(new HeadObjectCommand({Bucket:env.SITE_BUCKET,Key:'index.html'}))),
  limit(db.send(new GetItemCommand({TableName:env.TABLE_NAME,Key:{gameId:{S:'current'}},ProjectionExpression:'gameId'}))),
  control,
  limit(sqs.send(new GetQueueAttributesCommand({QueueUrl:env.REPORT_DLQ_URL,AttributeNames:['ApproximateNumberOfMessages']}))),
  lambdaState(env.REPORT_RENDERER),lambdaState(env.POSITION_RECOGNIZER),lambdaState(env.POSITION_ENGINE),
  // Only the two non-secret sign-in settings, never decrypted: the client secret is not read.
  lambdaState(env.OWNER_API),limit(ssm.send(new GetParametersCommand({Names:[env.TENANT_PARAMETER,env.CLIENT_ID_PARAMETER]})))
 ]);
 const ctl=controlState.value,ok=r=>r.status==='fulfilled';
 const lambdaResult=(...results)=>{if(results.some(r=>!ok(r)))return fail(reason(results.find(r=>!ok(r)).reason));if(results.some(r=>r.value==='fail'))return fail('function not ready');if(results.some(r=>r.value==='warn'))return warn('function not ready');return pass();};
 const results={
  pages:ok(pages)?pass():fail(reason(pages.reason)),
  'live-game':ok(game)?pass():fail(reason(game.reason)),
  library:ctl.error?fail(reason(ctl.error)):pass(),
  reports:(()=>{const fn=lambdaResult(renderer);if(fn.status!=='pass')return fn;if(!ok(dlq))return fail(reason(dlq.reason));return Number(dlq.value.Attributes?.ApproximateNumberOfMessages??0)>0?warn('failed reports waiting'):pass();})(),
  analysis:ctl.error?fail(reason(ctl.error)):ctl.paused?warn('paused by spending guard'):pass(),
  position:(()=>{const fn=lambdaResult(recognizer,engine);if(fn.status==='fail')return fn;if(ctl.error)return fail(reason(ctl.error));if(ctl.paused)return warn('paused by spending guard');return fn;})(),
  signin:(()=>{const fn=lambdaResult(owner);if(fn.status!=='pass')return fn;if(!ok(signin))return fail(reason(signin.reason));const v=signin.value;return (v.InvalidParameters||[]).length||(v.Parameters||[]).length<2?fail('sign-in not configured'):pass();})()
 };
 const functions=FUNCTIONS.map(([key,name])=>({key,name,...results[key]}));
 const status=functions.reduce((worst,f)=>RANK[f.status]>RANK[worst]?f.status:worst,'pass');
 return {status,time:now.toISOString(),functions};
}

let clients;
exports.FUNCTIONS=FUNCTIONS;
exports.checkHealth=checkHealth;
exports.handler=async()=>{
 clients??={s3:new S3Client({}),db:new DynamoDBClient({}),sqs:new SQSClient({}),lambda:new LambdaClient({}),ssm:new SSMClient({})};
 let body;
 try{body=await checkHealth(clients,process.env);}
 catch{body={status:'fail',time:new Date().toISOString(),functions:FUNCTIONS.map(([key,name])=>({key,name,status:'fail',output:'read failed'}))};}
 return {statusCode:body.status==='fail'?503:200,headers:{'content-type':'application/health+json','cache-control':'public, max-age=60','x-content-type-options':'nosniff'},body:JSON.stringify(body)};
};
