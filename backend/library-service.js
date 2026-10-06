import { readSgf } from '../src/sgf.js';
export const validRecordId = id => /^(?:[0-9]{10,14}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(id);
export function gamePrefix(id) {
  if (!validRecordId(id)) throw Object.assign(new Error('Invalid game ID.'),{statusCode:400});
  return 'games/' + (/^[0-9]{10,14}$/.test(id) ? id.slice(0,8)+'/'+id.slice(8) : id);
}
export function recordMetadata(source, filename, id) {
  if (!validRecordId(id) || typeof filename !== 'string' || filename.length > 255) throw Object.assign(new Error('Invalid upload request.'),{statusCode:400});
  const record = readSgf(source);
  return {schemaVersion:1,id,originalFilename:filename,name:record.name || filename.replace(/\.sgf$/i,'').slice(0,200) || 'Uploaded game',players:record.players,size:record.size,komi:record.komi,rules:record.rules,date:record.date,venue:record.venue||'',result:record.result,moves:record.mainLine.length-1,uploadedAt:new Date().toISOString(),analysis:{status:'queued'}};
}
export const DAILY_ANALYSIS_CAP=Number(typeof process!=='undefined'?process.env.DAILY_ANALYSIS_CAP||10:10);
export async function saveRecord(store, source, filename, id, analysisAllowed=true, analysisPaused=false) {
  const metadata = recordMetadata(source,filename,id);
  if(!analysisAllowed)metadata.analysis={status:'limited',dailyLimit:DAILY_ANALYSIS_CAP};
  if(analysisPaused)metadata.analysis={status:'paused',reason:'monthly_budget'};
  const prefix = gamePrefix(id) + '/';
  // A retried upload reuses its ID; never overwrite an existing game.
  const created = await store.create(prefix+'original.sgf',source,'application/x-go-sgf; charset=utf-8');
  if (!created && await store.get(prefix+'original.sgf') !== source) throw Object.assign(new Error('Upload ID already exists.'),{statusCode:409});
  await store.create(prefix+'metadata.json',JSON.stringify(metadata),'application/json');
  const saved=JSON.parse(await store.get(prefix+'metadata.json'));
  await store.create(recordIndexKey(saved),JSON.stringify({id:saved.id,uploadedAt:saved.uploadedAt}),'application/json');
  return saved;
}

export async function uploadRecord(store,source,filename,uploadId,now=new Date(),options={}) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(uploadId)) throw Object.assign(new Error('Invalid upload request.'),{statusCode:400});
  recordMetadata(source,filename,uploadId);
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const date=['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('');
  const mapping='uploads/'+uploadId+'.json';
  let existing;try{existing=JSON.parse(await store.get(mapping));}catch(e){if(e.code!=='ENOENT'&&e.name!=='NoSuchKey')throw e;}
  if(existing)return saveRecord(store,source,filename,existing.id,existing.analysisAllowed!==false,existing.analysisPaused===true);
  const analysisPaused=store.analysisPaused?await store.analysisPaused():false;
  for(let n=1;n<=100;n++) {
    const id=date+String(n).padStart(2,'0'),key='reservations/'+id+'.json';
    if(await store.create(key,JSON.stringify({uploadId}),'application/json') || JSON.parse(await store.get(key)).uploadId===uploadId) {
      const analysisAllowed=analysisPaused||options.analysis===false?false:await reserveAnalysis(store,date,uploadId);
      await store.create(mapping,JSON.stringify({id,analysisAllowed,analysisPaused}),'application/json');
      const saved=JSON.parse(await store.get(mapping));
      return saveRecord(store,source,filename,saved.id,saved.analysisAllowed!==false,saved.analysisPaused===true);
    }
  }
  throw Object.assign(new Error('Daily upload limit reached.'),{statusCode:429});
}

async function reserveAnalysis(store,date,uploadId){
  for(let n=1;n<=DAILY_ANALYSIS_CAP;n++){
    const key='daily-analysis/'+date+'/'+String(n).padStart(2,'0')+'.json';
    if(await store.create(key,JSON.stringify({uploadId}),'application/json')||JSON.parse(await store.get(key)).uploadId===uploadId)return true;
  }
  return false;
}

export function recordIndexKey(metadata){
  const reverse=value=>value.replace(/[0-9]/g,d=>String(9-Number(d)));
  const timestamp=String(Date.parse(metadata.uploadedAt)).padStart(13,'0');
  const tie=/^[0-9]{10,14}$/.test(metadata.id)?reverse(metadata.id.slice(0,8)+metadata.id.slice(8).padStart(6,'0')):metadata.id;
  return 'library-index/'+reverse(timestamp)+'-'+tie+'.json';
}
