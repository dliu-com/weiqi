import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, transition, GameError } from '../backend/game-service.js';
import {localLibrary} from './local-library.mjs';
const library=localLibrary(process.env.LIBRARY_DIR || '/private/tmp/weiqi-record-library',{model:process.env.KATAGO_MODEL,engine:process.env.KATAGO_BIN || 'katago',visits:Number(process.env.KATAGO_VISITS || 1)});
const root = path.resolve(fileURLToPath(new URL('../src/', import.meta.url)));
let state = createState();
const archives = new Map();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
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
      else { if(data.action?.type === 'new') archives.set(selected.revision+'-'+Date.now(),structuredClone(selected)); state=next; }
      return send(200, { state: next });
    } catch (error) { return send(error.statusCode || 500, { message: error.message, ...(error.statusCode === 409 ? { state } : {}) }); }
  }
  try {
    const filename = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : /^\/record\/(?:[0-9]{10,14}|[a-f0-9-]{36})\/report\/?$/.test(pathname)?'/report.html':/^\/(?:record|game)\/(?:[0-9]{10,14}|[a-f0-9-]{36})\/?$/.test(pathname)?'/record.html':pathname));
    if (!filename.startsWith(root + path.sep) && filename !== root) throw new Error('Invalid path');
    const data = await readFile(filename);
    response.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
});
const port = Number(process.env.PORT || 4174);
server.listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/ (preview game is stored in memory)'));
