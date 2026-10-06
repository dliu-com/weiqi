import {gamePrefix} from '../backend/library-service.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
function api(){
 const files=new Map(),messages=[],invocations=[],batchJobs=new Map();let batchFailure=false;
 class GetObjectCommand{constructor(input){this.input=input;}}
 class PutObjectCommand{constructor(input){this.input=input;}}
 class ListObjectsV2Command{constructor(input){this.input=input;}}
 class SendMessageCommand{constructor(input){this.input=input;}}
 class S3Client{async send(c){const key=c.input.Key;if(c instanceof GetObjectCommand){if(!files.has(key))throw Object.assign(Error(),{name:'NoSuchKey'});return {ETag:'test',Body:{transformToString:async()=>files.get(key)}};}if(c instanceof PutObjectCommand){if(c.input.IfNoneMatch==='*'&&files.has(key))throw Object.assign(Error(),{$metadata:{httpStatusCode:412}});files.set(key,c.input.Body);return {};}const keys=[...files.keys()].filter(k=>k.startsWith(c.input.Prefix)).sort(),offset=Number(c.input.ContinuationToken||0);return {Contents:keys.slice(offset,offset+c.input.MaxKeys).map(Key=>({Key})),NextContinuationToken:keys.length>offset+c.input.MaxKeys?String(offset+c.input.MaxKeys):undefined};}}
 class SQSClient{async send(c){messages.push(c.input);return {};}}
 class InvokeCommand{constructor(input){this.input=input;}}
 class LambdaClient{async send(c){invocations.push(c.input);return {StatusCode:202};}}
 class DescribeJobsCommand{constructor(input){this.input=input;}}
 class ListJobsCommand{constructor(input){this.input=input;}}
 class BatchClient{async send(c){if(batchFailure)throw Error('Batch unavailable');return c instanceof DescribeJobsCommand?{jobs:c.input.jobs.map(id=>batchJobs.get(id)).filter(Boolean)}:{jobSummaryList:[...batchJobs.values()].filter(j=>j.jobQueue===c.input.jobQueue&&j.status===c.input.jobStatus)};}}
 class GetItemCommand{constructor(input){this.input=input;}}
 class PutItemCommand{constructor(input){this.input=input;}}
 const rows=new Map();class DynamoDBClient{async send(c){if(c instanceof GetItemCommand)return {Item:rows.get(c.input.Key.gameId.S)};const old=rows.get(c.input.Item.gameId.S),v=c.input.ExpressionAttributeValues;if(old&&v){const ok=v[':m']?old.minute.N===v[':m'].N&&old.count.N===v[':n'].N:v[':r']?old.revision.N===v[':r'].N:old.revision.N===v[':expected'].N&&(old.clockVersion?.N||'0')===v[':clockVersion'].N;if(!ok)throw Object.assign(Error(),{name:'ConditionalCheckFailedException'});}rows.set(c.input.Item.gameId.S,c.input.Item);return {};}}
 const exports={},source=['src/engine.js','backend/game-service.js','src/sgf.js','src/recording-tree.js','backend/draft-service.js','src/ai-review.js','src/report-data.js','backend/library-service.js','src/queue-estimate.js','backend/library-handler.cjs','backend/queue-status.cjs','backend/handler.cjs'].map(file=>readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
 vm.runInNewContext(source,{exports,require:name=>name.includes('client-s3')?{S3Client,GetObjectCommand,PutObjectCommand,ListObjectsV2Command}:name.includes('client-sqs')?{SQSClient,SendMessageCommand}:name.includes('client-batch')?{BatchClient,DescribeJobsCommand,ListJobsCommand}:name.includes('client-lambda')?{LambdaClient,InvokeCommand}:name==='node:crypto'?{createHash}:{DynamoDBClient,GetItemCommand,PutItemCommand},process:{env:{LIBRARY_BUCKET:'test',AI_CONTROL_KEY:'control/ai-spending.json',ANALYSIS_QUEUE:'testqueue',SITE_ORIGIN:'https://test.invalid',REPORT_QUEUE:'reportqueue'}},structuredClone,TextEncoder,Buffer,console});
 const call=async(path,body,headers={})=>{const result=await exports.handler({rawPath:new URL(path,'https://test.invalid').pathname,queryStringParameters:Object.fromEntries(new URL(path,'https://test.invalid').searchParams),requestContext:{http:{method:body?'POST':'GET'}},headers:{'content-type':'application/json',origin:'https://test.invalid',...headers},body:body?JSON.stringify(body):undefined});return {status:result.statusCode,...JSON.parse(result.body)};};
 return {call,files,messages,invocations,batchJobs,failBatch:()=>batchFailure=true,event:exports.handler};
}
const id='12345678-1234-1234-1234-123456789abc',sgf='(;GM[1]SZ[19]KM[7.5]GN[API test];B[dd];W[pp])';
test('the monthly pause preserves uploads/replay without reserving paid daily slots or sending jobs',async()=>{
 const h=api();h.files.set('control/ai-spending.json',JSON.stringify({paused:true}));const saved=await h.call('/api/library',{id,sgf,filename:'test.sgf'});assert.equal(saved.status,200);assert.equal(h.messages.length,0);assert.equal([...h.files.keys()].some(k=>k.startsWith('daily-analysis/')),false);const game=await h.call('/api/library/'+saved.id);assert.equal(game.sgf,sgf);assert.equal(game.metadata.analysis.status,'paused');assert.equal((await h.call('/api/library')).games[0].analysis.status,'paused');
});
test('deployed library handler allocates a short ID, stores portable files, queues analysis and immediately serves the original record',async()=>{
 const {call,files,messages}=api();const uploaded=await call('/api/library',{id,sgf,filename:'test.sgf'});assert.equal(uploaded.status,200);const recordId=uploaded.id;assert.match(recordId,/^[0-9]{8}01$/);assert.equal(messages.length,1);assert.equal(messages[0].MessageBody,JSON.stringify({id:recordId}));
 const record=await call('/api/library/'+recordId);assert.equal(record.sgf,sgf);assert.equal(record.metadata.analysis.status,'queued');assert.ok(Number.isFinite(Date.parse(record.metadata.analysis.enqueuedAt)));assert.equal(record.analysis,null);assert.equal((await call('/api/library')).games.length,1);
 files.set(gamePrefix(recordId)+'/analysis.json',JSON.stringify({positions:[{move:0,blackLead:2,blackWinrate:.9}]}));const meta=JSON.parse(files.get(gamePrefix(recordId)+'/metadata.json'));meta.analysis.status='ready';files.set(gamePrefix(recordId)+'/metadata.json',JSON.stringify(meta));assert.equal((await call('/api/library/'+recordId)).analysis.positions[0].blackWinrate,.9);
});
test('deployed library rejects wrong origin, unsupported sizes, malformed files, missing records and overwrite attempts',async()=>{
 const {call,files}=api();assert.equal((await call('/api/library',{id,sgf,filename:'x.sgf'},{origin:'https://evil.invalid'})).status,403);
 assert.equal((await call('/api/library',{id,sgf:'(;SZ[9])',filename:'x.sgf'})).status,400);assert.equal(files.size,0);
 assert.equal((await call('/api/library',{id,sgf:'garbage',filename:'x.sgf'})).status,400);assert.equal((await call('/api/library/'+id)).status,404);
 await call('/api/library',{id,sgf,filename:'x.sgf'});assert.equal((await call('/api/library',{id,sgf:'(;SZ[19])',filename:'x.sgf'})).status,409);
 assert.equal((await call('/api/library/../../etc')).status,404);
});
test('quick results are served during deeper work, then the API switches to deeper results',async()=>{
 const {call,files}=api(),uploaded=await call('/api/library',{id,sgf,filename:'test.sgf'}),prefix=gamePrefix(uploaded.id)+'/';
 const meta=JSON.parse(files.get(prefix+'metadata.json'));
 meta.analysis={status:'running',available:'quick',quick:{status:'ready'},deep:{status:'running'}};
 files.set(prefix+'metadata.json',JSON.stringify(meta));files.set(prefix+'analysis-quick.json',JSON.stringify({phase:'quick',visits:1}));
 assert.equal((await call('/api/library/'+uploaded.id)).analysis.phase,'quick');
 files.set(prefix+'analysis.json',JSON.stringify({phase:'deep',visits:1000}));meta.analysis={status:'ready',available:'deep',quick:{status:'ready'},deep:{status:'ready'}};files.set(prefix+'metadata.json',JSON.stringify(meta));
 const result=await call('/api/library/'+uploaded.id);assert.equal(result.analysis.phase,'deep');assert.equal(result.analysis.visits,1000);
});

test('library lists newest ten records and returns a cursor for the next page without duplicates',async()=>{
 const {call,files}=api();
 for(let n=0;n<23;n++){
  const recordId='20261005'+String(n+1).padStart(2,'0');
  const metadata={id:recordId,uploadedAt:new Date(Date.UTC(2026,9,5,12,0,n)).toISOString()};
  files.set(gamePrefix(recordId)+'/metadata.json',JSON.stringify(metadata));
  const stamp=String(Date.parse(metadata.uploadedAt)).replace(/[0-9]/g,d=>9-Number(d));
  files.set('library-index/'+stamp+'-'+recordId+'.json',JSON.stringify({id:recordId}));
 }
 const first=await call('/api/library');assert.equal(first.games.length,10);assert.equal(first.games[0].id,'2026100523');
 const second=await call('/api/library?cursor='+first.cursor);assert.equal(second.games.length,10);assert.equal(second.games[0].id,'2026100513');
 const last=await call('/api/library?cursor='+second.cursor);assert.equal(last.games.length,3);assert.equal(last.cursor,null);
 assert.equal(new Set([...first.games,...second.games,...last.games].map(r=>r.id)).size,23);
});

test('report reads never generate artifacts or invoke document workers',async()=>{
 const {call,files,messages,invocations,event}=api(),upload=await call('/api/library',{id,sgf,filename:'report.sgf'}),prefix=gamePrefix(upload.id)+'/';
 const meta=JSON.parse(files.get(prefix+'metadata.json'));meta.analysis={status:'ready',available:'deep',deep:{status:'ready',jobId:'job'}};files.set(prefix+'metadata.json',JSON.stringify(meta));
 const a={phase:'deep',visits:3000,completedAt:'2026-10-06T00:00:00Z',sgfSha256:createHash('sha256').update(sgf).digest('hex'),modelSha256:'abc',positions:[0,1,2].map(n=>({nodeId:n,move:n,blackLead:0,blackWinrate:.5,candidates:[{move:n===0?'Q16':'D4',order:0,blackLead:2,blackWinrate:.6,visits:100,pv:[n===0?'Q16':'D4']}]}))};files.set(prefix+'analysis.json',JSON.stringify(a));
 assert.equal((await call('/api/library/'+upload.id+'/report')).status,409);assert.equal(invocations.length,0);assert.equal([...files.keys()].filter(k=>k.includes('/reports/')).length,0);
 await event({source:'aws.batch','detail-type':'Batch Job State Change',detail:{status:'SUCCEEDED',jobName:'weiqi-'+upload.id+'-a1-1234abcd',jobId:'job'}});
 assert.equal(invocations.length,0);assert.equal(messages.length,2);assert.equal(messages[1].MessageGroupId,'reports');assert.equal(messages[1].QueueUrl,'reportqueue');
 const first=await call('/api/library/'+upload.id+'/report'),second=await call('/api/library/'+upload.id+'/report');assert.equal(first.status,200);assert.deepEqual(first,second);assert.equal(invocations.length,0);assert.equal(messages.length,2);
 files.set(prefix+'analysis.json',JSON.stringify({...a,visits:1000}));assert.equal((await call('/api/library/'+upload.id+'/report')).status,409);assert.equal(invocations.length,0);assert.equal(messages.length,2);
});
test('report API rejects analysis for another SGF and incomplete positions',async()=>{
 const {call,files}=api(),upload=await call('/api/library',{id,sgf,filename:'report.sgf'}),prefix=gamePrefix(upload.id)+'/';const meta=JSON.parse(files.get(prefix+'metadata.json'));meta.analysis={status:'ready',available:'deep'};files.set(prefix+'metadata.json',JSON.stringify(meta));
 files.set(prefix+'analysis.json',JSON.stringify({phase:'deep',sgfSha256:'wrong',positions:[]}));assert.equal((await call('/api/library/'+upload.id+'/report')).status,409);
 files.set(prefix+'analysis.json',JSON.stringify({phase:'deep',sgfSha256:createHash('sha256').update(sgf).digest('hex'),positions:[]}));assert.equal((await call('/api/library/'+upload.id+'/report')).status,409);
});

test('successful production completion prepares the report before viewing, deduplicates repeats and ignores stale jobs',async()=>{
 const {call,files,messages,event}=api(),upload=await call('/api/library',{id,sgf,filename:'automatic-report.sgf'}),prefix=gamePrefix(upload.id)+'/';
 const meta=JSON.parse(files.get(prefix+'metadata.json'));meta.analysis={status:'ready',available:'deep',deep:{status:'ready',jobId:'completed-job'}};files.set(prefix+'metadata.json',JSON.stringify(meta));
 files.set(prefix+'analysis.json',JSON.stringify({phase:'deep',visits:3000,completedAt:'2026-10-06T00:00:00Z',sgfSha256:createHash('sha256').update(sgf).digest('hex'),modelSha256:'model',positions:[0,1,2].map(n=>({nodeId:n,move:n,blackLead:0,blackWinrate:.5,candidates:[{move:n===0?'Q16':'D4',order:0,blackLead:2,blackWinrate:.6,visits:100,pv:[n===0?'Q16':'D4']}]}))}));
 const notice=jobId=>({source:'aws.batch','detail-type':'Batch Job State Change',detail:{status:'SUCCEEDED',jobName:'weiqi-'+upload.id+'-a1-1234abcd',jobId}});
 assert.equal((await event(notice('old-job'))).ignored,true);assert.equal([...files.keys()].filter(k=>k.includes('/reports/')).length,0);
 assert.equal((await event(notice('completed-job'))).reportDataReady,true);const reportKeys=[...files.keys()].filter(k=>k.includes('/reports/'));assert.equal(reportKeys.length,1);
 const prepared=JSON.parse(files.get(reportKeys[0]));assert.deepEqual(prepared.availableLanguages,['en','zh']);
 await event(notice('completed-job'));const viewed=await call('/api/library/'+upload.id+'/report');assert.equal(viewed.generatedAt,prepared.generatedAt);assert.equal([...files.keys()].filter(k=>k.includes('/reports/')).length,1);assert.equal(messages.length,3);assert.equal(messages[1].MessageDeduplicationId,messages[2].MessageDeduplicationId);
 meta.analysis.deep.status='running';files.set(prefix+'metadata.json',JSON.stringify(meta));assert.equal((await event(notice('completed-job'))).ignored,true);
});

test('queued record reads expose a stable queue forecast without changing records or scheduling jobs',async()=>{
 const h=api(),upload=await h.call('/api/library',{id,sgf,filename:'queue.sgf'}),key=gamePrefix(upload.id)+'/metadata.json',m=JSON.parse(h.files.get(key));
 m.analysis={status:'queued',backend:'primary',jobId:'job',quick:{status:'queued',estimatedSeconds:60},deep:{status:'queued',estimatedSeconds:3000}};h.files.set(key,JSON.stringify(m));
 h.batchJobs.set('job',{jobId:'job',jobName:'weiqi-'+upload.id+'-a1-1234abcd',jobQueue:'gpu-queue',status:'RUNNABLE',createdAt:Date.now()});
 const original=h.files.get(key),first=await h.call('/api/library/'+upload.id),second=await h.call('/api/library/'+upload.id);
 assert.equal(first.status,200);assert.equal(first.metadata.analysis.queueStatus.jobsAhead,0);assert.equal(first.metadata.analysis.queueStatus.basis,'typical_startup');assert.deepEqual(first.metadata.analysis.queueStatus.startsAt,second.metadata.analysis.queueStatus.startsAt);assert.equal(h.files.get(key),original);assert.equal(h.messages.length,1);
 h.failBatch();assert.equal((await h.call('/api/library/'+upload.id)).metadata.analysis.queueStatus.state,'unavailable');assert.equal(h.files.get(key),original);
});

 test('public draft API persists edits, rejects stale writes, prunes variations and retries saving idempotently',async()=>{const h=api(),initial=await h.call('/api/draft');assert.equal(initial.draft.revision,0);const source='(;SZ[19]GN[Draft test];B[dd](;W[pp])(;W[dp]))',edit=await h.call('/api/draft',{action:'update',expectedRevision:0,sgf:source,selected:1});assert.equal(edit.status,200);assert.equal((await h.call('/api/draft')).draft.sgf,source);assert.equal((await h.call('/api/draft',{action:'update',expectedRevision:0,sgf:source,selected:0})).status,409);const save={action:'save',expectedRevision:1,id},first=await h.call('/api/draft',save),again=await h.call('/api/draft',save);assert.equal(first.status,200);assert.equal(again.id,first.id);assert.equal([...h.files.keys()].filter(k=>k.endsWith('/original.sgf')).length,1);const saved=await h.call('/api/library/'+first.id);assert.equal(saved.metadata.moves,2);assert.equal(saved.metadata.result,'0');assert.ok(!saved.sgf.includes('W[dp]'));assert.equal((await h.call('/api/draft')).draft.publication.status,'ready');});
 test('site mutation limiter uses bounded state and refuses excess requests before new records',async()=>{const h=api();for(let n=0;n<120;n++)assert.equal((await h.call('/api/draft',{action:'invalid'})).status,400);assert.equal((await h.call('/api/library',{id,sgf,filename:'over-limit.sgf'})).status,429);assert.equal(h.files.size,0);});


test('a different game cannot reuse an upload ID, mutate saved files or enqueue another analysis',async()=>{
 const {call,files,messages,event}=api();
 const saved=await call('/api/library',{id,sgf,filename:'original.sgf'}),prefix=gamePrefix(saved.id)+'/';
 const original=[...files].filter(([key])=>key.startsWith(prefix)),slots=[...files].filter(([key])=>key.startsWith('daily-analysis/'));
 const replacements=['(;SZ[19]GN[Different game];B[pp];W[dd])',sgf.replace('GN[API test]','GN[Changed name]'),sgf.replace('KM[7.5]','KM[6.5]')];
 for(const replacement of replacements){
  assert.equal((await call('/api/library',{id,sgf:replacement,filename:'replacement.sgf'})).status,409);
 }
 assert.equal((await call('/api/library',{id:saved.id,sgf:replacements[0],filename:'replacement.sgf'})).status,400);
 for(const method of ['POST','PUT','PATCH','DELETE']){
  const denied=await event({rawPath:'/api/library/'+saved.id,requestContext:{http:{method}},headers:{'content-type':'application/json',origin:'https://test.invalid'},body:JSON.stringify({id,sgf:replacements[0],name:'Changed name',action:'update'})});
  assert.ok(denied.statusCode>=400);
 }
 assert.deepEqual([...files].filter(([key])=>key.startsWith(prefix)),original);
 assert.deepEqual([...files].filter(([key])=>key.startsWith('daily-analysis/')),slots);
 assert.equal(messages.length,1);assert.equal((await call('/api/library/'+saved.id)).sgf,sgf);
});
