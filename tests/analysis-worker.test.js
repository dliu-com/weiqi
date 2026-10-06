import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {processCloudJob} from '../scripts/cloud-analysis-worker.mjs';
import {runLocalJob} from '../scripts/analysis-worker.mjs';
const id='12345678-1234-1234-1234-123456789abc';
async function setup(t,mode='success'){
 const directory=await mkdtemp(path.join(os.tmpdir(),'weiqi-worker-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const folder=path.join(directory,'games',id);await mkdir(folder,{recursive:true});
 await writeFile(path.join(folder,'original.sgf'),'(;SZ[19]RU[Japanese]KM[6.5];B[dd];W[pp])');
 await writeFile(path.join(folder,'metadata.json'),JSON.stringify({id,analysis:{status:'queued'}}));
 const model=path.join(directory,'model.bin');await writeFile(model,'fictional test model');
 const engine=path.join(directory,'fake-engine');await writeFile(engine,`#!/usr/bin/env node\nconst fs=require('node:fs');if(process.argv.includes('version')){console.log('KataGo test version');process.exit(0);}const q=JSON.parse(fs.readFileSync(0,'utf8'));if('${mode}'==='failure'){console.log(JSON.stringify({id:q.id,error:'test engine failure'}));process.exit(1);}for(const turnNumber of q.analyzeTurns){if('${mode}'==='incomplete'&&turnNumber>0)break;console.log(JSON.stringify({id:q.id,turnNumber,isDuringSearch:false,rootInfo:{scoreLead:turnNumber-1,winrate:.5+turnNumber/10,visits:1}}));}\n`);await chmod(engine,0o755);return {directory,folder,options:{model,engine,visits:1,timeoutMs:5000}};
}
test('analysis writes only complete results, records provenance and reuses saved output',async t=>{
 const {directory,folder,options}=await setup(t);await runLocalJob(directory,id,options);const meta=JSON.parse(await readFile(path.join(folder,'metadata.json'),'utf8'));const output=await readFile(path.join(folder,'analysis.json'),'utf8'),analysis=JSON.parse(output);
 assert.equal(meta.analysis.status,'ready');assert.equal(analysis.positions.length,3);assert.equal(analysis.reportPerspective,'BLACK');assert.equal(analysis.engineVersion,'KataGo test version');assert.equal(analysis.visits,1);assert.equal(analysis.rules,'japanese');assert.equal(analysis.komi,6.5);assert.equal(analysis.sgfSha256.length,64);
 await runLocalJob(directory,id,options);assert.equal(await readFile(path.join(folder,'analysis.json'),'utf8'),output);
});
for(const mode of ['failure','incomplete'])test(mode+' analysis keeps the original game and marks the job failed',async t=>{
 const {directory,folder,options}=await setup(t,mode);await assert.rejects(()=>runLocalJob(directory,id,options));assert.equal(JSON.parse(await readFile(path.join(folder,'metadata.json'),'utf8')).analysis.status,'failed');assert.ok((await readFile(path.join(folder,'original.sgf'),'utf8')).includes('B[dd]'));await assert.rejects(()=>readFile(path.join(folder,'analysis.json')),e=>e.code==='ENOENT');await assert.rejects(()=>readFile(path.join(folder,'.analysis-lock')),e=>e.code==='ENOENT');
});

test('cloud bridge claims work conditionally and publishes output before readiness',async t=>{
 const {folder,options}=await setup(t);const files=new Map([['games/'+id+'/metadata.json',{body:JSON.stringify({id,analysis:{status:'queued'}}),etag:'1'}],['games/'+id+'/original.sgf',{body:await readFile(path.join(folder,'original.sgf'),'utf8'),etag:'1'}]]),writes=[];
 const store={get:async key=>files.get(key),put:async(key,body,etag)=>{const old=files.get(key);if(etag&&old.etag!==etag)throw Object.assign(Error(),{conflict:true});const next={body,etag:String(Number(old?.etag || 0)+1)};files.set(key,next);writes.push(key);return next;}};
 assert.equal(await processCloudJob(store,id,options),'ready');assert.deepEqual(writes,['games/'+id+'/metadata.json','games/'+id+'/analysis.json','games/'+id+'/metadata.json']);assert.equal(JSON.parse(files.get('games/'+id+'/analysis.json').body).positions.length,3);assert.equal(await processCloudJob(store,id,options),'ready');assert.equal(writes.length,3);
});
test('cloud bridge skips another worker active claim',async()=>{const store={get:async()=>({body:JSON.stringify({analysis:{status:'running',startedAt:new Date().toISOString()}}),etag:'1'}),put:async()=>{throw Error('must not write');}};assert.equal(await processCloudJob(store,id,{}),'busy');});
test('deployed CPU worker bundle analyses queue messages and does not repeat ready jobs',async t=>{
 const {options}=await setup(t);const {default:vm}=await import('node:vm'),fs=await import('node:fs'),child=await import('node:child_process'),util=await import('node:util'),crypto=await import('node:crypto');
 const files=new Map([['games/'+id+'/metadata.json',{body:JSON.stringify({id,moves:2,analysis:{status:'queued'}}),etag:'1'}],['games/'+id+'/original.sgf',{body:'(;SZ[19]KM[6.5];B[dd];W[pp])',etag:'1'}]]);
 class GetObjectCommand{constructor(input){this.input=input;}}class PutObjectCommand{constructor(input){this.input=input;}}class S3Client{async send(command){const {Key,Body,IfMatch}=command.input;if(command instanceof GetObjectCommand){const value=files.get(Key);return {ETag:value.etag,Body:{transformToString:async()=>value.body}};}const old=files.get(Key);if(IfMatch&&old.etag!==IfMatch)throw Error('Lost claim');const next={body:Body,etag:String(Number(old?.etag || 0)+1)};files.set(Key,next);return {ETag:next.etag};}}
 const source=['src/engine.js','src/sgf.js','src/analysis-status.js','backend/library-service.js'].map(name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
 const worker=fs.readFileSync(new URL('../scripts/analysis-worker.mjs',import.meta.url),'utf8'),analyse=worker.slice(worker.indexOf('export async function analyse'),worker.indexOf('export async function runLocalJob')).replace(/^export /gm,'');
 const exports={},require=name=>name.includes('client-s3')?{S3Client,GetObjectCommand,PutObjectCommand}:name==='node:child_process'?{spawn:(_engine,args,opt)=>child.spawn(options.engine,args,opt),execFile:Object.assign((_engine,args,opt,cb)=>child.execFile(options.engine,args,opt,cb),{[util.promisify.custom]:(_engine,args,opt)=>util.promisify(child.execFile)(options.engine,args,opt)})}:name==='node:fs/promises'?{readFile:async()=>Buffer.from('fictional model'),writeFile:async()=>{},rename:async()=>{}}:name==='node:path'?path:name==='node:util'?util:crypto;
 vm.runInNewContext(source+'\n'+analyse+'\n'+fs.readFileSync(new URL('../backend/cpu-worker.cjs',import.meta.url),'utf8'),{exports,require,process:{env:{LIBRARY_BUCKET:'fictional',KATAGO_MODEL_KEY:'models/test.bin.gz'}},console,TextEncoder,Buffer,setTimeout,clearTimeout});
 const event={Records:[{messageId:'message',body:JSON.stringify({id})}]};const context={getRemainingTimeInMillis:()=>900000};assert.equal((await exports.handler(event,context)).batchItemFailures.length,0);const result=files.get('games/'+id+'/analysis.json').body;assert.equal(JSON.parse(result).positions.length,3);assert.equal(JSON.parse(result).visits,10);assert.equal(JSON.parse(result).rules,'japanese');assert.equal(JSON.parse(files.get('games/'+id+'/metadata.json').body).analysis.status,'ready');await exports.handler(event,context);assert.equal(files.get('games/'+id+'/analysis.json').body,result);
});
