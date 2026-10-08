import {readFile,mkdir,open,readdir} from 'node:fs/promises';
import path from 'node:path';
import {uploadRecord,validRecordId,gamePrefix} from '../backend/library-service.js';
import {buildAiReport} from '../src/report-data.js';
import {runLocalJob} from './analysis-worker.mjs';
export function localLibrary(directory,options={}) {
  const store={
    async get(key){return readFile(path.join(directory,key),'utf8');},
    async create(key,body){const filename=path.join(directory,key);await mkdir(path.dirname(filename),{recursive:true});let file;try{file=await open(filename,'wx');await file.writeFile(body);return true;}catch(e){if(e.code==='EEXIST')return false;throw e;}finally{await file?.close();}}
  };
  const pending=new Set();let running=false;
  async function drain(){if(running||!options.model)return;running=true;try{while(pending.size){const id=pending.values().next().value;pending.delete(id);try{await runLocalJob(directory,id,options);}catch(e){console.error('Local analysis failed:',e.message);}}}finally{running=false;}}
  const handle=async function(request,send,pathname) {
    const id=pathname.slice('/api/library/'.length);
    try {
      if(request.method==='GET'&&pathname==='/api/library'){
        let entries=[];try{entries=await readdir(path.join(directory,'games'));}catch(e){if(e.code!=='ENOENT')throw e;}
        const ids=entries.filter(validRecordId);for(const day of entries.filter(name=>/^[0-9]{8}$/.test(name))){for(const sequence of await readdir(path.join(directory,'games',day)))if(validRecordId(day+sequence))ids.push(day+sequence);}
        const games=[];for(const id of ids){try{games.push(JSON.parse(await store.get(gamePrefix(id)+'/metadata.json')));}catch(e){if(e.code!=='ENOENT')throw e;}}
        games.sort((a,b)=>b.uploadedAt.localeCompare(a.uploadedAt)||b.id.localeCompare(a.id));
        const cursor=new URL(request.url,'http://localhost').searchParams.get('cursor')||'0';if(!/^[0-9]+$/.test(cursor))return send(400,{message:'Invalid page cursor.'});const offset=Number(cursor);
        return send(200,{games:games.slice(offset,offset+5),cursor:games.length>offset+5?String(offset+5):null});
      }
      const reportId=pathname.match(/^\/api\/library\/([^/]+)\/report$/)?.[1];
      if(request.method==='GET'&&validRecordId(reportId||'')){
        const prefix=gamePrefix(reportId)+'/',metadata=JSON.parse(await store.get(prefix+'metadata.json'));
        if(metadata.analysis.status!=='ready'||metadata.analysis.available==='quick')return send(409,{message:'The report will be available when deep analysis finishes.'});
        const source=await store.get(prefix+'original.sgf'),analysis=JSON.parse(await store.get(prefix+'analysis.json'));
        return send(200,buildAiReport(source,analysis,metadata));
      }
      if(request.method==='GET'&&validRecordId(id)){
        const prefix=gamePrefix(id)+'/',metadata=JSON.parse(await store.get(prefix+'metadata.json')),sgf=await store.get(prefix+'original.sgf');
        const analysis=metadata.analysis.status==='ready'||metadata.analysis.available?JSON.parse(await store.get(prefix+(metadata.analysis.available==='quick'?'analysis-quick.json':'analysis.json'))):null;
        return send(200,{metadata,sgf,analysis});
      }
      if(request.method!=='POST'||pathname!=='/api/library')return send(404,{message:'Record not found.'});
      // Local uploads must originate from this preview; block cross-site form requests.
      if(!request.headers['content-type']?.startsWith('application/json'))return send(415,{message:'Use JSON.'});
      if(request.headers.origin && request.headers.origin!=='http://'+request.headers.host)return send(403,{message:'Invalid request origin.'});
      let body='';for await(const chunk of request){body+=chunk;if(Buffer.byteLength(body)>1600000)return send(413,{message:'Upload too large.'});}
      let data;try{data=JSON.parse(body);}catch{return send(400,{message:'Invalid upload request.'});}
      const metadata=await handle.save(data.sgf,data.filename,data.id);
      if(metadata.analysis.status==='queued'&&options.model){pending.add(metadata.id);void drain();}
      return send(200,{id:metadata.id});
    }catch(e){return send(e.code==='ENOENT'?404:e.statusCode||500,{message:e.statusCode?e.message:'The library is unavailable. Please retry.'});}
  };
  handle.save=async(source,filename,id)=>{const metadata=await uploadRecord(store,source,filename,id);if(metadata.analysis.status==='queued'&&options.model){pending.add(metadata.id);void drain();}return metadata;};
  return handle;
}
