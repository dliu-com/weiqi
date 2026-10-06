import {gamePrefix} from '../backend/library-service.js';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdir,writeFile} from 'node:fs/promises';
const execute=promisify(execFile),[id,bucket,outdir='/private/tmp/weiqi-record-analysis']=process.argv.slice(2);
if(!/^[0-9]{10,14}$/.test(id||'')||!bucket)throw Error('Provide a game ID and library bucket.');
await mkdir(outdir,{recursive:true});let previous='',errors=0;
const get=async key=>JSON.parse((await execute('aws',['s3','cp','s3://'+bucket+'/'+key,'-','--region','eu-west-1','--only-show-errors'])).stdout);
while(true){try{
 const metadata=await get(gamePrefix(id)+'/metadata.json'),state=metadata.analysis;
 await writeFile(outdir+'/metadata.json',JSON.stringify(metadata,null,2));
 const status=[state.status,state.quick?.status,state.deep?.status].join('/');
 if(status!==previous){console.log(id+': '+status);previous=status;}
 for(const phase of ['quick','deep'])if(state[phase]?.status==='ready'){
  const filename=phase==='quick'?'analysis-quick.json':'analysis.json';
  await writeFile(outdir+'/'+filename,JSON.stringify(await get(gamePrefix(id)+'/'+filename),null,2));
  await writeFile(outdir+'/'+phase+'-timings.json',JSON.stringify(await get('jobs/'+id+'/'+phase+'-timings.json'),null,2));
 }
 errors=0;
 if(['ready','failed','limited'].includes(state.status)){console.log('Analysis finished; game files preserved.');break;}
}catch(error){console.error('Unable to read record status:',error.message);if(++errors>=3)throw error;}
await new Promise(resolve=>setTimeout(resolve,30000));}
