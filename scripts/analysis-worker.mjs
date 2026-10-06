import {estimatedAnalysisSeconds} from '../src/analysis-status.js';
import {spawn,execFile} from 'node:child_process';
import {readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readSgf,kataQuery,kataCandidates} from '../src/sgf.js';
import {validRecordId} from '../backend/library-service.js';
export async function analyse(source, {id,model,engine='katago',visits=1,timeoutMs=120000,configPath}) {
  if (!Number.isInteger(visits) || visits<1 || visits>10000) throw Error('Visits must be between 1 and 10,000.');
  const record=readSgf(source), query=kataQuery(record,id,visits);
  const started=Date.now(), rows=new Map(); let output='', diagnostic='';
  await new Promise((resolve,reject)=>{
    const child=spawn(engine,['analysis','-model',model,'-config',configPath],{stdio:['pipe','pipe','pipe']});
    let error=null; const timer=setTimeout(()=>{error=Error('Analysis timed out.');child.kill('SIGKILL');},timeoutMs);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.stderr.on('data',data=>{diagnostic=(diagnostic+data).slice(-8000);});
    child.stdin.on('error',e=>{error=e;});
    child.stdout.on('data',data=>{
      output+=data;
      if(output.length>2_000_000){error=Error('Unexpected engine output size.');child.kill('SIGKILL');return;}
      let newline; while((newline=output.indexOf('\n'))>=0){
        const line=output.slice(0,newline);output=output.slice(newline+1); if(!line.trim())continue;
        try {
          const r=JSON.parse(line); if(r.error){error=Error(r.error);continue;}
          if(r.id!==id || r.isDuringSearch || !r.rootInfo)continue;
          const n=r.turnNumber, {scoreLead,winrate,visits:actual}=r.rootInfo;
          if(!Number.isInteger(n)||n<0||n>=record.mainLine.length||!Number.isFinite(scoreLead)||!Number.isFinite(winrate)||winrate<0||winrate>1)throw Error('Invalid analysis result.');
          rows.set(n,{nodeId:record.mainLine[n],move:n,blackLead:scoreLead,blackWinrate:winrate,visits:actual,candidates:kataCandidates(r.moveInfos,query.moves[n]?.[1])});
        }catch(e){error=e;child.kill('SIGKILL');}
      }
    });
    child.on('close',code=>{clearTimeout(timer);if(error)reject(error);else if(code!==0)reject(Error('KataGo exited '+code+': '+diagnostic));else resolve();});
    child.stdin.end(JSON.stringify(query)+'\n');
  });
  if(rows.size!==record.mainLine.length)throw Error('KataGo returned an incomplete analysis.');
  const version = (await promisify(execFile)(engine,['version'],{timeout:15000})).stdout.split('\n')[0].trim();
  const modelHash=createHash('sha256').update(await readFile(model)).digest('hex');
  return {schemaVersion:2,id,sgfSha256:createHash('sha256').update(source).digest('hex'),engine:'KataGo',engineVersion:version,model:path.basename(model),modelSha256:modelHash,visits,reportPerspective:'BLACK',rules:query.rules,komi:record.komi,completedAt:new Date().toISOString(),elapsedMs:Date.now()-started,positions:[...rows.values()].sort((a,b)=>a.move-b.move)};
}
export async function runLocalJob(directory,id,options) {
  if(!validRecordId(id))throw Error('Invalid game ID.');
  const folder=path.join(directory,'games',id), metaPath=path.join(folder,'metadata.json'), lockPath=path.join(folder,'.analysis-lock');
  let lock;try{lock=await open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')return;throw e;}
  let metadata;
  const saveMeta=async()=>{const tmp=metaPath+'.tmp';await writeFile(tmp,JSON.stringify(metadata,null,2));await rename(tmp,metaPath);};
  try {
    metadata=JSON.parse(await readFile(metaPath,'utf8')); if(metadata.analysis.status==='ready' && !options.force)return;
    metadata.analysis={status:'running',startedAt:new Date().toISOString(),visits:options.visits,estimatedSeconds:estimatedAnalysisSeconds((metadata.moves || 0)+1,options.visits)};await saveMeta();
    const source=await readFile(path.join(folder,'original.sgf'),'utf8'), configPath=path.join(folder,'.analysis.cfg');
    await writeFile(configPath,'logToStderr = true\nnumAnalysisThreads = 1\nnumSearchThreadsPerAnalysisThread = 1\nmaxVisits = '+options.visits+'\nreportAnalysisWinratesAs = BLACK\nnnMaxBatchSize = 1\nnnCacheSizePowerOfTwo = 16\n');
    const analysis=await analyse(source,{...options,id,configPath});
    const tmp=path.join(folder,'analysis.json.tmp');await writeFile(tmp,JSON.stringify(analysis,null,2));await rename(tmp,path.join(folder,'analysis.json'));
    metadata.analysis={status:'ready',visits:options.visits,completedAt:analysis.completedAt};await saveMeta();
  }catch(e){if(metadata){metadata.analysis={status:'failed',message:'Analysis failed. Retry from the local worker.',failedAt:new Date().toISOString()};await saveMeta();}throw e;}
  finally{await lock.close();await unlink(lockPath);}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [directory,id]=process.argv.slice(2), model=process.env.KATAGO_MODEL;
  if(!directory||!id||!model){console.error('Usage: KATAGO_MODEL=/path/model.gz node scripts/analysis-worker.mjs /path/library game-id');process.exitCode=1;}
  else {await runLocalJob(directory,id,{model,engine:process.env.KATAGO_BIN || 'katago',visits:Number(process.env.KATAGO_VISITS || 1),force:process.env.KATAGO_FORCE === '1',timeoutMs:Number(process.env.KATAGO_TIMEOUT_MS || 120000)});console.log('Analysis saved.');}
}
