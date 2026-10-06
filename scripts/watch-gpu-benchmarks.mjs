import {readFile} from 'node:fs/promises';
import {updateBenchmarks} from './update-benchmarks.mjs';

// Development-only: follows an existing runner, never launches compute.
const directory=process.argv[2];
if(!directory)throw Error('Provide the GPU benchmark output directory.');
let previous='';
for(let n=0;n<240;n++){
 const report=JSON.parse(await readFile(directory+'/summary.json','utf8'));
 const signature=JSON.stringify({results:report.results,error:report.error,released:report.instances.map(i=>i.releasedAt)});
 if(signature!==previous){
  const data=await updateBenchmarks({publish:true});
  console.log('Published '+data.experiments.length+' benchmark experiments.');
  previous=signature;
 }
 if(report.error||report.instances.length&&report.instances.every(i=>i.releasedAt))break;
 await new Promise(resolve=>setTimeout(resolve,30000));
}
