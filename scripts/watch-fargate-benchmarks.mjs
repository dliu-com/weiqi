import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
const execute=promisify(execFile),dir=process.argv[2];
if(!dir)throw Error('Provide the benchmark output directory.');
let previous='',failures=0;
while(true){
 try{
  const {stdout}=await execute(process.execPath,['scripts/collect-fargate-benchmarks.mjs',dir],{maxBuffer:1024*1024});
  const s=JSON.parse(await readFile(dir+'/summary.json','utf8')),states=s.results.map(r=>r.cpu+':'+r.status).join(',');
  if(states!==previous){console.log(stdout.trim());previous=states;}
  failures=0;
  if(s.results.every(r=>['SUCCEEDED','FAILED'].includes(r.status))){console.log('Benchmark records updated; all jobs have stopped.');break;}
 }catch(e){console.error('Benchmark collection error:',e.message);if(++failures>=3)throw e;}
 await new Promise(resolve=>setTimeout(resolve,30000));
}
