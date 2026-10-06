import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),region='eu-west-1',bucket='weiqisite-recordlibrary34c28f86-bfnqhy6739na';
const directory=await mkdtemp('/private/tmp/weiqi-analysis-timing-');
const get=async key=>JSON.parse((await execute('aws',['s3','cp','s3://'+bucket+'/'+key,'-','--region',region,'--only-show-errors'],{maxBuffer:8*1024*1024})).stdout);
const put=async(key,value)=>{const filename=directory+'/data.json';await writeFile(filename,JSON.stringify(value));await execute('aws',['s3','cp',filename,'s3://'+bucket+'/'+key,'--region',region,'--content-type','application/json','--only-show-errors']);};
const records=JSON.parse(await readFile(new URL('../cloud/benchmark-catalog.json',import.meta.url),'utf8'));
for(const r of records){
 if(!r.recordId||r.productionPrefix||!r.createdAt)continue;
 let metadata,analysis;try{metadata=await get('games/'+r.recordId+'/metadata.json');if(metadata.analysis.enqueuedAt!==r.createdAt){metadata.analysis.enqueuedAt=r.createdAt;await put('games/'+r.recordId+'/metadata.json',metadata);}if(!['SUCCEEDED','COMPLETE'].includes((r.status||'').toUpperCase())||!r.completedAt)continue;analysis=await get('games/'+r.recordId+'/analysis.json');}catch(e){if(/404|NoSuchKey|does not exist/.test(e.stderr||''))continue;throw e;}
 const total=Date.parse(r.completedAt)-Date.parse(r.createdAt);
 if(!Number.isFinite(total)||total<0)continue;
 analysis.enqueuedAt=r.createdAt;analysis.endToEndMs=total;
 metadata.analysis.enqueuedAt=r.createdAt;
 await put('games/'+r.recordId+'/analysis.json',analysis);await put('games/'+r.recordId+'/metadata.json',metadata);
 console.log('Recorded total timing for '+r.recordId);
}
