#!/usr/bin/env node
// Measures the live site and writes src/performance-data.json, shown on /docs#performance.
// Guest requests only: GET without cookies or tokens, never admin sign-in, /api/owner or the managed API.
// One run makes about 110 requests, 11 of them rate-limited reads (the limit is 120 a minute per connection).
// A page over budget or a page/API answer other than 200 is still saved, so npm test reports it; a script or style that fails to load stops the run.
// --server also reads 7 days of Lambda durations from CloudWatch Logs (read-only AWS calls, < US$0.01).
// Without --server the last server section in the data file is kept.
// Behind a TLS-intercepting proxy (e.g. Zscaler) the times include the proxy; the data records it.
// Usage: node scripts/performance/measure.mjs [--server] [--out src/performance-data.json]
import tls from 'node:tls';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {PAGE_BUDGETS,CPU_BUDGETS,LIVE_SAMPLES,LIVE_TARGETS,SERVER_DAYS,SERVER_BUDGETS} from '../../src/performance-spec.js';
import {pageFiles,pageWeight,timeWorkload} from './workloads.mjs';

const HOST=process.env.WEIQI_HOST||'weiqi.dliu.com',ORIGIN='https://'+HOST,REGION=process.env.AWS_REGION||'eu-west-1';
const args=process.argv.slice(2),SERVER=args.includes('--server');
const OUT=args.includes('--out')?args[args.indexOf('--out')+1]:fileURLToPath(new URL('../../src/performance-data.json',import.meta.url));
const UA='weiqi-performance-test (+https://github.com/dliu-com/weiqi)';
const ms=seconds=>Math.round(seconds*10000)/10;
const median=values=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b);return v.length?v[Math.floor((v.length-1)/2)]:null;};

// One curl process per list, so the first transfer opens the connection (cold) and the rest reuse it (warm).
function curl(urls){
 const out=execFileSync('curl',['-s','--compressed','--proto','=https','-A',UA,'--max-time','60','-w','%{json}\t%header{x-cache}\t%header{content-encoding}\n',...urls.flatMap(url=>['-o','/dev/null',url])],{encoding:'utf8',maxBuffer:1<<24});
 return out.trim().split('\n').map(line=>{const [json,cache,encoding]=line.split('\t'),d=JSON.parse(json);return {
  url:d.url_effective,status:d.http_code,http:d.http_version,connects:d.num_connects,bytes:d.size_download,cache:cache.replace(/ from cloudfront$/i,'')||null,encoding:encoding||null,
  dns:ms(d.time_namelookup),connect:ms(d.time_connect-d.time_namelookup),tls:ms(d.time_appconnect-d.time_connect),wait:ms(d.time_starttransfer-d.time_pretransfer),ttfb:ms(d.time_starttransfer),total:ms(d.time_total)
 };});
}
function liveTarget(target,id){
 const runs=curl(Array(LIVE_SAMPLES).fill(ORIGIN+target.path.replace('<id>',id))),[cold,...warm]=runs;
 return {path:target.path,kind:target.kind,status:runs.every(r=>r.status===cold.status)?cold.status:runs.map(r=>r.status),http:cold.http,bytes:cold.bytes,encoding:cold.encoding,
  cold:{dns:cold.dns,connect:cold.connect,tls:cold.tls,ttfb:cold.ttfb,total:cold.total,cache:cold.cache},
  warm:{samples:warm.length,ttfb:median(warm.map(r=>r.wait)),total:median(warm.map(r=>r.total)),cache:[...new Set(warm.map(r=>r.cache))].join(' / ')||null}};
}

// The site's certificate is issued by Amazon. Any other issuer means a proxy terminates TLS on this network.
const proxy=await new Promise(resolve=>{const s=tls.connect({host:HOST,servername:HOST,port:443},()=>{const o=s.getPeerCertificate().issuer?.O||'';s.end();resolve(/amazon/i.test(o)?null:o||'unknown');});s.on('error',()=>resolve(null));});
if(proxy)console.log(`TLS is intercepted by ${proxy}: live times include the proxy.`);
const library=await fetch(ORIGIN+'/api/library',{headers:{'user-agent':UA}}).then(r=>r.json());
const gameId=library.games?.find(g=>g.analysis?.status==='ready')?.id||library.games?.[0]?.id;
if(!gameId){console.error('Could not read a public game ID from /api/library.');process.exit(2);}

const live=LIVE_TARGETS.map(target=>{const r=liveTarget(target,gameId);console.log(`${target.path.padEnd(20)} ${r.status} cold ${r.cold.total} ms · warm ttfb ${r.warm.ttfb} ms · ${r.warm.cache||''}`);return r;});
// Compressed size actually served for each page: its HTML plus every local file it loads, each fetched once.
const assets=[...new Set(PAGE_BUDGETS.flatMap(page=>pageFiles(page.file)))],served=new Map(curl(assets.map(file=>ORIGIN+'/'+file)).map((r,i)=>[assets[i],r]));
const failed=[...served].filter(([,r])=>r.status!==200).map(([file])=>file);
if(failed.length){console.error('These files did not load: '+failed.join(', '));process.exit(1);}
const pages=PAGE_BUDGETS.map(page=>{const source=pageWeight(page.file),html=live.find(r=>r.path===page.path);
 return {path:page.path,files:source.files.length+1,sourceGzip:source.gzip,servedBytes:html.bytes+source.files.reduce((sum,file)=>sum+served.get(file).bytes,0)};});
const cpu=CPU_BUDGETS.map(budget=>{const r=timeWorkload(budget.id);console.log(`${budget.id.padEnd(16)} ${r.medianMs.toFixed(1)} ms`);return {id:budget.id,medianMs:Math.round(r.medianMs*100)/100,runs:r.runs};});

function aws(command){return JSON.parse(execFileSync('aws',[...command,'--region',REGION,'--output','json'],{encoding:'utf8',maxBuffer:1<<26}));}
async function serverTimes(){
 const all=aws(['lambda','list-functions']).Functions;
 const found=SERVER_BUDGETS.map(budget=>{const fn=all.find(f=>new RegExp(budget.match).test(f.FunctionName));if(!fn)throw Error('No Lambda function matches '+budget.match);
  return {budget,group:fn.LoggingConfig?.LogGroup||'/aws/lambda/'+fn.FunctionName,memoryMB:fn.MemorySize};});
 const end=Math.floor(Date.now()/1000),query='filter @type="REPORT" | stats count() as n, pct(@duration,50) as p50, pct(@duration,95) as p95, pct(@duration,99) as p99, count(@initDuration) as cold, pct(@initDuration,50) as init, max(@maxMemoryUsed)/1000000 as mem by @log';
 const {queryId}=aws(['logs','start-query','--log-group-names',...found.map(f=>f.group),'--start-time',String(end-SERVER_DAYS*86400),'--end-time',String(end),'--query-string',query]);
 let result;for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,2000));result=aws(['logs','get-query-results','--query-id',queryId]);if(result.status==='Complete')break;if(/Failed|Cancelled|Timeout/.test(result.status))throw Error('CloudWatch Logs query '+result.status);}
 if(result.status!=='Complete')throw Error('CloudWatch Logs query did not finish.');
 const rows=result.results.map(r=>Object.fromEntries(r.map(f=>[f.field,f.value])));
 const num=v=>v==null?null:Math.round(Number(v)*10)/10;
 return {measuredAt:new Date().toISOString(),days:SERVER_DAYS,functions:found.map(({budget,group,memoryMB})=>{const r=rows.find(row=>row['@log']?.endsWith(':'+group));
  return {id:budget.id,memoryMB,invocations:Number(r?.n||0),p50Ms:num(r?.p50),p95Ms:num(r?.p95),p99Ms:num(r?.p99),coldStarts:Number(r?.cold||0),initP50Ms:num(r?.init),maxMemoryMB:num(r?.mem)};})};
}
const previous=existsSync(OUT)?JSON.parse(readFileSync(OUT,'utf8')):{};
const server=SERVER?await serverTimes():previous.server||null;
const cold=live.map(r=>r.cold.connect).filter(v=>v>0);
const data={
 measuredAt:new Date().toISOString(),site:ORIGIN,samples:LIVE_SAMPLES,requests:1+live.length*LIVE_SAMPLES+assets.length,
 client:{proxy,http:live[0].http,edgeRttMs:median(cold),machine:os.cpus()[0]?.model?.replace(/\s+/g,' ').trim()||os.arch(),node:process.version},
 pages,live,cpu,server
};
writeFileSync(OUT,JSON.stringify(data,null,1)+'\n');
console.log('Saved '+OUT);
