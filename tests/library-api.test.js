import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function api(){
 const files=new Map(),messages=[];
 class GetObjectCommand{constructor(input){this.input=input;}}
 class PutObjectCommand{constructor(input){this.input=input;}}
 class ListObjectsV2Command{constructor(input){this.input=input;}}
 class SendMessageCommand{constructor(input){this.input=input;}}
 class S3Client{async send(c){const key=c.input.Key;if(c instanceof GetObjectCommand){if(!files.has(key))throw Object.assign(Error(),{name:'NoSuchKey'});return {Body:{transformToString:async()=>files.get(key)}};}if(c instanceof PutObjectCommand){if(files.has(key))throw Object.assign(Error(),{$metadata:{httpStatusCode:412}});files.set(key,c.input.Body);return {};}const keys=[...files.keys()].filter(k=>k.startsWith(c.input.Prefix)).sort(),offset=Number(c.input.ContinuationToken||0);return {Contents:keys.slice(offset,offset+c.input.MaxKeys).map(Key=>({Key})),NextContinuationToken:keys.length>offset+c.input.MaxKeys?String(offset+c.input.MaxKeys):undefined};}}
 class SQSClient{async send(c){messages.push(c.input);return {};}}
 class DynamoDBClient{}
 const exports={},source=['src/engine.js','backend/game-service.js','src/sgf.js','backend/library-service.js','backend/library-handler.cjs','backend/handler.cjs'].map(file=>readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
 vm.runInNewContext(source,{exports,require:name=>name.includes('client-s3')?{S3Client,GetObjectCommand,PutObjectCommand,ListObjectsV2Command}:name.includes('client-sqs')?{SQSClient,SendMessageCommand}:{DynamoDBClient},process:{env:{LIBRARY_BUCKET:'test',ANALYSIS_QUEUE:'testqueue',SITE_ORIGIN:'https://test.invalid'}},TextEncoder,Buffer,console});
 const call=async(path,body,headers={})=>{const result=await exports.handler({rawPath:new URL(path,'https://test.invalid').pathname,queryStringParameters:Object.fromEntries(new URL(path,'https://test.invalid').searchParams),requestContext:{http:{method:body?'POST':'GET'}},headers:{'content-type':'application/json',origin:'https://test.invalid',...headers},body:body?JSON.stringify(body):undefined});return {status:result.statusCode,...JSON.parse(result.body)};};
 return {call,files,messages};
}
const id='12345678-1234-1234-1234-123456789abc',sgf='(;GM[1]SZ[19]KM[7.5]GN[API test];B[dd];W[pp])';
test('deployed library handler allocates a short ID, stores portable files, queues analysis and immediately serves the original record',async()=>{
 const {call,files,messages}=api();const uploaded=await call('/api/library',{id,sgf,filename:'test.sgf'});assert.equal(uploaded.status,200);const recordId=uploaded.id;assert.match(recordId,/^[0-9]{8}01$/);assert.equal(messages.length,1);assert.equal(messages[0].MessageBody,JSON.stringify({id:recordId}));
 const record=await call('/api/library/'+recordId);assert.equal(record.sgf,sgf);assert.equal(record.metadata.analysis.status,'queued');assert.equal(record.analysis,null);assert.equal((await call('/api/library')).games.length,1);
 files.set('games/'+recordId+'/analysis.json',JSON.stringify({positions:[{move:0,blackLead:2,blackWinrate:.9}]}));const meta=JSON.parse(files.get('games/'+recordId+'/metadata.json'));meta.analysis.status='ready';files.set('games/'+recordId+'/metadata.json',JSON.stringify(meta));assert.equal((await call('/api/library/'+recordId)).analysis.positions[0].blackWinrate,.9);
});
test('deployed library rejects wrong origin, unsupported sizes, malformed files, missing records and overwrite attempts',async()=>{
 const {call,files}=api();assert.equal((await call('/api/library',{id,sgf,filename:'x.sgf'},{origin:'https://evil.invalid'})).status,403);
 assert.equal((await call('/api/library',{id,sgf:'(;SZ[9])',filename:'x.sgf'})).status,400);assert.equal(files.size,0);
 assert.equal((await call('/api/library',{id,sgf:'garbage',filename:'x.sgf'})).status,400);assert.equal((await call('/api/library/'+id)).status,404);
 await call('/api/library',{id,sgf,filename:'x.sgf'});assert.equal((await call('/api/library',{id,sgf:'(;SZ[19])',filename:'x.sgf'})).status,409);
 assert.equal((await call('/api/library/../../etc')).status,404);
});
test('quick results are served during deeper work, then the API switches to deeper results',async()=>{
 const {call,files}=api(),uploaded=await call('/api/library',{id,sgf,filename:'test.sgf'}),prefix='games/'+uploaded.id+'/';
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
  files.set('games/'+recordId+'/metadata.json',JSON.stringify(metadata));
  const stamp=String(Date.parse(metadata.uploadedAt)).replace(/[0-9]/g,d=>9-Number(d));
  files.set('library-index/'+stamp+'-'+recordId+'.json',JSON.stringify({id:recordId}));
 }
 const first=await call('/api/library');assert.equal(first.games.length,10);assert.equal(first.games[0].id,'2026100523');
 const second=await call('/api/library?cursor='+first.cursor);assert.equal(second.games.length,10);assert.equal(second.games[0].id,'2026100513');
 const last=await call('/api/library?cursor='+second.cursor);assert.equal(last.games.length,3);assert.equal(last.cursor,null);
 assert.equal(new Set([...first.games,...second.games,...last.games].map(r=>r.id)).size,23);
});
