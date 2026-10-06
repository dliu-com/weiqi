import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {uploadRecord} from '../backend/library-service.js';
const execute=promisify(execFile),region='eu-west-1';
export async function attachBenchmarkRecords(summary,source){
 const temp=await mkdtemp('/private/tmp/weiqi-benchmark-record-');
 const get=async key=>{try{return (await execute('aws',['s3','cp','s3://'+summary.bucket+'/'+key,'-','--region',region,'--only-show-errors'])).stdout;}catch(e){if(e.stderr?.includes('NoSuchKey')||e.stderr?.includes('does not exist')||e.stderr?.includes('(404)'))e.name='NoSuchKey';throw e;}};
 const put=async(key,body,type,create=false)=>{const file=temp+'/'+randomUUID();await writeFile(file,body);try{await execute('aws',['s3api','put-object','--bucket',summary.bucket,'--key',key,'--body',file,'--content-type',type,'--region',region,...(create?['--if-none-match','*']:[])]);return true;}catch(e){if(create&&e.stderr?.includes('PreconditionFailed'))return false;throw e;}};
 const store={get,create:(key,body,type)=>put(key,body,type,true)};
 for(const r of summary.results){
  if(r.recordId)continue;
  const m=await uploadRecord(store,source,'benchmark.sgf',randomUUID(),new Date(),{analysis:false});
  const network=summary.model.match(/b(\d+)c(\d+)/);
  m.name=`Benchmark · ${r.gpuType?r.gpuType+" GPU · ":""}${r.cpu} CPUs / ${r.memoryGB} GB · ${network?network.slice(1).join('×'):summary.model} · ${r.visits} visits`+(r.analysisThreads?` · ${r.analysisThreads} analysis threads / batch ${r.maxBatchSize}`:'');
  m.benchmark={queueKind:summary.queueKind,jobId:r.jobId,prefix:r.prefix,cpu:r.cpu,memoryGB:r.memoryGB,visits:r.visits,...(r.gpuType?{gpu:'NVIDIA '+r.gpuType,gpuCount:1,instanceType:r.instanceType}:{}),...(r.analysisThreads?{analysisThreads:r.analysisThreads,maxBatchSize:r.maxBatchSize}: {})};
  m.analysis={status:r.status==='FAILED'?'failed':'running',visits:r.visits,jobId:r.jobId,startedAt:new Date().toISOString(),estimatedSeconds:6300};
  await put('games/'+m.id+'/metadata.json',JSON.stringify(m),'application/json');r.recordId=m.id;r.recordUrl='https://weiqi.dliu.com/record/'+m.id;
 }
}
if(process.argv[1]?.endsWith('/benchmark-records.mjs')){
 const [dir,sgf]=process.argv.slice(2),summary=JSON.parse(await readFile(dir+'/summary.json','utf8'));await attachBenchmarkRecords(summary,await readFile(sgf,'utf8'));await writeFile(dir+'/summary.json',JSON.stringify(summary,null,2));for(const r of summary.results)console.log(r.recordUrl);
}
