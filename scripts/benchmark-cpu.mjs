import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readSgf,kataQuery} from '../src/sgf.js';
const [filename,functionName,outdir='/private/tmp/weiqi-cpu-benchmarks',depths='10,100,1000']=process.argv.slice(2);
if(!filename||!functionName)throw Error('Usage: node scripts/benchmark-cpu.mjs record.sgf function-name [output-directory] [comma-separated-visits]');
const source=await readFile(filename,'utf8'),record=readSgf(source),runId=new Date().toISOString().replace(/[:.]/g,'-');
const sgfSha256=createHash('sha256').update(source).digest('hex'),execute=promisify(execFile);await mkdir(outdir,{recursive:true});
const results=[];
for(const visits of depths.split(',').map(Number)){
 const request={id:'benchmark-'+runId,query:kataQuery(record,'benchmark-'+runId,visits),nodeIds:record.mainLine,sgfSha256,requestedAt:new Date().toISOString(),outputPrefix:'benchmarks/'+runId+'/cpu-'+visits};
 const file=path.join(outdir,'request-'+visits+'.json'),output=path.join(outdir,'response-'+visits+'.json');await writeFile(file,JSON.stringify(request));
 console.log('Starting CPU '+visits+' visits for '+(record.mainLine.length-1)+' moves.');const started=Date.now();
 const {stdout}=await execute('aws',['lambda','invoke','--function-name',functionName,'--payload','fileb://'+file,'--log-type','Tail','--cli-read-timeout','950','--region','eu-west-1',output],{timeout:960000,maxBuffer:1024*1024});
 const invocation=JSON.parse(stdout),response=JSON.parse(await readFile(output,'utf8')),log=Buffer.from(invocation.LogResult || '','base64').toString();
 const billedMs=Number(log.match(/Billed Duration: ([\d.]+) ms/)?.[1] || 0),costUSD=billedMs/1000*(3008/1024)*.0000166667+.0000002;
 const result={visits,status:invocation.FunctionError?'failed':'complete',waitMs:Date.now()-started,billedMs,costUSD,response};results.push(result);await writeFile(path.join(outdir,'log-'+visits+'.txt'),log);await writeFile(path.join(outdir,'summary.json'),JSON.stringify({runId,sgfSha256,moves:record.mainLine.length-1,memoryMB:3008,pricing:'USD estimate before free tier/credits; excludes storage, requests and transfer',results},null,2));console.log(JSON.stringify(result));
}
