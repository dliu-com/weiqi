// Browser mini-analysis; AGPL-3.0-only integration, upstream MIT engine.
import {KataGoEngineClient} from '../vendor/web-katrain/src/engine/katago/client';
import {situationalKey} from '../vendor/web-katrain/src/utils/superko';
import {sources} from './models.js';
export class LocalPositionAI{
 constructor(){this.client=null;this.url=null;this.disposed=false;}
 dispose(){this.disposed=true;this.client?.dispose();this.client=null;if(this.url)URL.revokeObjectURL(this.url);this.url=null;}
 async analyze({frames,cursor,side,komi,rules}){
  const start=performance.now();if(!this.client){const {url,sha256}=sources.analysisModel;let cache;try{cache=await caches.open('weiqi-photo-models-v1');}catch{}let cached=cache?await cache.match(url):null;let bytes=cached?await cached.arrayBuffer():null;const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');if(bytes&&await digest(bytes)!==sha256)bytes=null;if(!bytes){const response=await fetch(url);if(!response.ok)throw Error('Model download failed');bytes=await response.arrayBuffer();if(await digest(bytes)!==sha256)throw Error('Model checksum mismatch');try{await cache?.put(url,new Response(bytes));}catch{}}
   if(this.disposed)throw Error('Analysis cancelled');this.url=URL.createObjectURL(new Blob([bytes]));this.client=new KataGoEngineClient();await this.client.init(this.url,'wasm');
  }
  if(this.disposed)throw Error('Analysis cancelled');const rows=b=>Array.from({length:19},(_,y)=>b.slice(y*19,y*19+19));const result=await this.client.analyze({board:rows(frames[cursor].board),previousBoard:cursor>0?rows(frames[cursor-1].board):undefined,previousPreviousBoard:cursor>1?rows(frames[cursor-2].board):undefined,currentPlayer:side,komi,rules,modelUrl:this.url,backend:'wasm',moveHistory:frames.slice(1,cursor+1).filter(f=>f.move).map(f=>({player:f.move.side,x:f.move.index===null?-1:f.move.index%19,y:f.move.index===null?-1:Math.floor(f.move.index/19)})),repetitionHistory:frames.slice(0,cursor+1).map(f=>situationalKey(rows(f.board),f.turn)),visits:32,maxTimeMs:5000,topK:3,analysisPvLen:5,nnRandomize:false,batchSize:1,ownershipMode:'root',reuseTree:false});return {...result,elapsedMs:performance.now()-start};
 }
}
