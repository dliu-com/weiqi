import http from 'node:http';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, transition, GameError, freshLiveGame } from '../backend/game-service.js';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {sgf,MIN_LIBRARY_MOVES} from '../src/engine.js';
import {createDraft,draftTransition,draftPublication,freshSavedDraft} from '../backend/draft-service.js';
import {mainRecordingSgf} from '../src/recording-tree.js';
import {localLibrary} from './local-library.mjs';
const library=localLibrary(process.env.LIBRARY_DIR || '/private/tmp/weiqi-record-library',{model:process.env.KATAGO_MODEL,engine:process.env.KATAGO_BIN || 'katago',visits:Number(process.env.KATAGO_VISITS || 1)});
const preparedRoot=process.env.PREPARED_REPORT_DIR?path.resolve(process.env.PREPARED_REPORT_DIR):null;
const root = path.resolve(fileURLToPath(new URL('../src/', import.meta.url)));
const directory=process.env.LIBRARY_DIR||'/private/tmp/weiqi-record-library';await mkdir(directory,{recursive:true});
let state=createState(),draft=createDraft();try{state=JSON.parse(await readFile(path.join(directory,'live.json'),'utf8'));}catch{}try{draft=JSON.parse(await readFile(path.join(directory,'draft.json'),'utf8'));}catch{}
const routeContext={};vm.runInNewContext(await readFile(path.join(root,'routes.cjs'),'utf8'),routeContext);
async function persist(){await writeFile(path.join(directory,'live.json'),JSON.stringify(state));await writeFile(path.join(directory,'draft.json'),JSON.stringify(draft));}
async function publishLive(next){if(next.phase!=='ended')return next;let libraryId=next.libraryId;if(!libraryId&&next.history.length>=MIN_LIBRARY_MOVES){const hash=createHash('sha256').update('live|'+next.createdAt+'|'+(next.generation||0)).digest('hex'),id=hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32);libraryId=(await library.save(mainRecordingSgf(sgf(next)),'live-game.sgf',id)).id;}return freshLiveGame(next,libraryId);}
const archives = new Map();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.wasm':'application/wasm', '.gz':'application/gzip', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json':'application/json', '.pdf':'application/pdf', '.mp3':'audio/mpeg', '.txt':'text/plain; charset=utf-8', '.otf':'font/otf' };
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if(pathname==='/api/draft'){
    const send=(code,value)=>{response.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(value));};
    try{if(request.method==='GET')return send(200,{draft});if(request.method!=='POST')return send(405,{message:'Method not allowed.'});if(!request.headers['content-type']?.startsWith('application/json'))return send(415,{message:'Use JSON.'});if(request.headers.origin&&request.headers.origin!=='http://'+request.headers.host)return send(403,{message:'Invalid origin.'});let body='';for await(const chunk of request){body+=chunk;if(Buffer.byteLength(body)>1600000)return send(413,{message:'Too large.'});}let data;try{data=JSON.parse(body);}catch{return send(400,{message:'Invalid JSON.'});}if(data.action==='update'){draft=draftTransition(draft,data);await persist();return send(200,{draft});}if(data.action==='save'){if(draft.publication?.id!==data.id){if(draft.publication?.status==='pending')return send(409,{message:'Save pending.'});draft=draftPublication(draft,data);await persist();}if(draft.publication.status==='ready')return send(200,{draft,id:draft.publication.gameId});const meta=await library.save(draft.sgf,'recorded-game.sgf',data.id);draft=freshSavedDraft(draft,meta.id);await persist();return send(200,{draft,id:meta.id});}return send(400,{message:'Invalid action.'});}catch(e){return send(e.statusCode||500,{message:e.message,draft});}
  }
  if (pathname === '/api/library' || pathname.startsWith('/api/library/')) {
    const send=(code,value)=>{response.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(value));};
    return library(request,send,pathname);
  }
  if (pathname === '/api/game' || pathname.startsWith('/api/games')) {
    const archiveId = pathname.startsWith('/api/games/') ? pathname.slice(11) : null;
    let selected = archiveId ? archives.get(archiveId) : state;
    const send = (code, value) => { response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (request.method === 'GET' && pathname === '/api/games') return send(200,{games:[...archives].map(([id,s])=>({id,gameName:s.gameName,createdAt:s.createdAt,updatedAt:s.updatedAt})),cursor:null});
    if (!selected) return send(404,{message:'页面不存在。'});
    if (request.method === 'GET') return send(200, { state: selected });
    if (request.method !== 'POST') return send(405, { message: '不支持此请求方法。' });
    try {
      let body = '';
      for await (const chunk of request) { body += chunk; if (body.length > 2048) throw new GameError('请求过大。', 413); }
      let data;
      try { data = JSON.parse(body); } catch { throw new GameError('请求格式无效。'); }
      if (archiveId && !['metadata','rename','players'].includes(data.action?.type)) throw new GameError('当前棋局不能执行此操作。');
      const next = transition(selected, data);
      if (archiveId) archives.set(archiveId,next);
      else { if(data.action?.type === 'new') archives.set(selected.revision+'-'+Date.now(),structuredClone(selected)); state=await publishLive(next);await persist(); }
      return send(200, { state: archiveId?next:state });
    } catch (error) { return send(error.statusCode || 500, { message: error.message, ...(error.statusCode === 409 ? { state } : {}) }); }
  }
  try {
    const selectedRoot=pathname.startsWith('/prepared-reports/')&&preparedRoot?preparedRoot:root;
    const routed=routeContext.handler({request:{uri:pathname,querystring:Object.fromEntries([...new URL(request.url,'http://localhost').searchParams].map(([k,v])=>[k,{value:v}]))}});
    if(routed.statusCode){response.writeHead(routed.statusCode,{location:routed.headers.location.value});return response.end();}
    const filename=path.resolve(selectedRoot,'.'+decodeURIComponent(pathname==='/'?'/index.html':routed.uri));
    if (!filename.startsWith(selectedRoot + path.sep) && filename !== selectedRoot) throw new Error('Invalid path');
    const data = await readFile(filename);
    response.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
});
const port = Number(process.env.PORT || 4174);
server.listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/ (preview game is stored in memory)'));
