// Shared by tests/performance.test.js and scripts/performance/measure.mjs.
import {readFileSync,existsSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {createState,transition} from '../../backend/game-service.js';
import {sgf} from '../../src/engine.js';
import {readSgf,MAX_SGF_BYTES} from '../../src/sgf.js';
import {recordingTree,recordingSgf} from '../../src/recording-tree.js';

export const SRC=fileURLToPath(new URL('../../src/',import.meta.url));

// The local files a page loads before it can run: its CSS and scripts, then every static import, recursively.
// Remote files (the shared dl.css) and dynamic import() are left out.
export function pageFiles(htmlFile){
 const html=readFileSync(path.join(SRC,htmlFile),'utf8'),files=[],seen=new Set(),queue=[];
 for(const m of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="(\/?[\w./-]+\.(?:js|css))"/g))queue.push(m[1].replace(/^\//,''));
 while(queue.length){
  const file=path.normalize(queue.shift());if(seen.has(file))continue;seen.add(file);
  if(!existsSync(path.join(SRC,file)))throw Error(`${htmlFile} loads ${file}, which is missing.`);
  files.push(file);if(!file.endsWith('.js'))continue;
  const text=readFileSync(path.join(SRC,file),'utf8');
  for(const m of text.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?['"]((?:\.{1,2})?\/[^'"]+)['"]/g))
   queue.push(m[1].startsWith('/')?m[1].slice(1):path.join(path.dirname(file),m[1]));
 }
 return files;
}
export function pageWeight(htmlFile){
 const files=pageFiles(htmlFile);let raw=0,gzip=0;
 for(const file of [htmlFile,...files]){const bytes=readFileSync(path.join(SRC,file));raw+=bytes.length;gzip+=gzipSync(bytes).length;}
 return {files,raw,gzip};
}

// Every run plays the same game: a fixed seed picks moves, and illegal ones are skipped. It includes captures.
export function playGame(moves=300){
 let state=createState(),seed=7;
 for(let tries=0;state.history.length<moves&&tries<20000;tries++){
  seed=(seed*1103515245+12345)%2147483648;const index=seed%361;if(state.board[index]!=='.')continue;
  try{state=transition(state,{expectedRevision:state.revision,action:{type:'move',index}});}catch{}
 }
 if(state.history.length<moves)throw Error('Could not play the test game.');
 return state;
}
// The same game with a comment on every move, padded to just under the 256 KB upload limit.
export function largestSgf(source){
 const moves=(source.match(/;[BW]\[/g)||[]).length,room=MAX_SGF_BYTES-Buffer.byteLength(source)-moves*4-64;
 const comment='x'.repeat(Math.floor(room/moves));
 const text=source.replace(/;([BW])\[/g,`;C[${comment}]$1[`);
 if(Buffer.byteLength(text)>MAX_SGF_BYTES)throw Error('The largest test SGF is over the limit.');
 return text;
}

// [setup, run] for each CPU budget id. Only run is timed.
export const WORKLOADS={
 'play-game':[()=>null,()=>playGame(300)],
 'read-sgf':[()=>sgf(playGame(300)),text=>readSgf(text)],
 'largest-sgf':[()=>largestSgf(sgf(playGame(300))),text=>readSgf(text)],
 'recording-tree':[()=>sgf(playGame(300)),text=>recordingSgf(recordingTree(text))]
};
export function timeWorkload(id,runs=5){
 const [setup,run]=WORKLOADS[id],input=setup(),times=[];
 run(input);// warm-up: the first run also compiles the code
 for(let i=0;i<runs;i++){const start=performance.now();run(input);times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);return {medianMs:times[Math.floor(runs/2)],runs};
}
