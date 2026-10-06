import {readFile,mkdir,open,readdir} from 'node:fs/promises';
import path from 'node:path';
import {uploadRecord,validRecordId} from '../backend/library-service.js';
import {runLocalJob} from './analysis-worker.mjs';
export function localLibrary(directory,options={}) {
  const store={
    async get(key){return readFile(path.join(directory,key),'utf8');},
    async create(key,body){const filename=path.join(directory,key);await mkdir(path.dirname(filename),{recursive:true});let file;try{file=await open(filename,'wx');await file.writeFile(body);return true;}catch(e){if(e.code==='EEXIST')return false;throw e;}finally{await file?.close();}}
  };
  const pending=new Set();let running=false;
  async function drain(){if(running||!options.model)return;running=true;try{while(pending.size){const id=pending.values().next().value;pending.delete(id);try{await runLocalJob(directory,id,options);}catch(e){console.error('Local analysis failed:',e.message);}}}finally{running=false;}}
  return async function handle(request,send,pathname) {
    const id=pathname.slice('/api/library/'.length);
    try {
      if(request.method==='GET'&&pathname==='/api/library'){
        let entries=[];try{entries=await readdir(path.join(directory,'games'));}catch(e){if(e.code!=='ENOENT')throw e;}
        const games=[];for(const id of entries.filter(validRecordId)){try{games.push(JSON.parse(await store.get('games/'+id+'/metadata.json')));}catch(e){if(e.code!=='ENOENT')throw e;}}
        games.sort((a,b)=>b.uploadedAt.localeCompare(a.uploadedAt)||b.id.localeCompare(a.id));
        const cursor=new URL(request.url,'http://localhost').searchParams.get('cursor')||'0';if(!/^[0-9]+$/.test(cursor))return send(400,{message:'Invalid page cursor.'});const offset=Number(cursor);
        return send(200,{games:games.slice(offset,offset+10),cursor:games.length>offset+10?String(offset+10):null});
      }
      if(request.method==='GET'&&validRecordId(id)){
        const prefix='games/'+id+'/',metadata=JSON.parse(await store.get(prefix+'metadata.json')),sgf=await store.get(prefix+'original.sgf');
        const analysis=metadata.analysis.status==='ready'||metadata.analysis.available?JSON.parse(await store.get(prefix+(metadata.analysis.available==='quick'?'analysis-quick.json':'analysis.json'))):null;
        return send(200,{metadata,sgf,analysis});
      }
      if(request.method!=='POST'||pathname!=='/api/library')return send(404,{message:'Record not found.'});
      // Local uploads must originate from this preview; block cross-site form requests.
      if(!request.headers['content-type']?.startsWith('application/json'))return send(415,{message:'Use JSON.'});
      if(request.headers.origin && request.headers.origin!=='http://'+request.headers.host)return send(403,{message:'Invalid request origin.'});
      let body='';for await(const chunk of request){body+=chunk;if(Buffer.byteLength(body)>1600000)return send(413,{message:'Upload too large.'});}
      let data;try{data=JSON.parse(body);}catch{return send(400,{message:'Invalid upload request.'});}
      const metadata=await uploadRecord(store,data.sgf,data.filename,data.id);
      if(metadata.analysis.status==='queued'&&options.model){pending.add(metadata.id);void drain();}
      return send(200,{id:metadata.id});
    }catch(e){return send(e.code==='ENOENT'?404:e.statusCode||500,{message:e.statusCode?e.message:'The library is unavailable. Please retry.'});}
  };
}
