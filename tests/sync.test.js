import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createState, transition, freshLiveGame } from '../backend/game-service.js';
import { play, opposite, score, gameTree, reviewPosition, gameClock, byoyomiSettings, timeLeft, sgf, standardKomi, MIN_LIBRARY_MOVES, MAX_GAME_MOVES } from '../src/engine.js';

// Exercise the actual client with an isolated DOM/network/clock, never the live game.
async function client({publish=false}={}) {
  const elements = new Map(), intervals = [], timers = [], calls = [], spoken = [];
  class Element {
    parentElement = {append(){},querySelectorAll(){return [];}}; style = {}; dataset = {}; children = []; attrs = {}; hidden = false; checked = true;
    classes = new Set(); classList = { toggle:(c,on=!this.classes.has(c))=>{on?this.classes.add(c):this.classes.delete(c);return on;}, contains:c=>this.classes.has(c) };
    setAttribute(k,v) { this.attrs[k]=v; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children=nodes; }
    addEventListener() {} focus() {} showModal() {this.open=true;} close() {this.open=false;}
    setCustomValidity(message) { this.validity=message; } reportValidity() { this.reported=this.validity; return !this.validity; }
  }
  const radios=['score-black','score-white','resign-black','resign-white','draw','unfinished'].map(value=>({value,on:false,get checked(){return this.on;},set checked(v){if(v)for(const r of radios)r.on=false;this.on=v;}})), selected=new Map();
  const get = id => { if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id); };
  let remote = createState(), failAfterSave = false, failGet = false, now = Date.now();
  const context = vm.createContext({
    mountTimeControl(){let current=null;return {render(){},fill(value){current=value;},value(){return current;}};},mountStoneSound(){},prepareStoneSound(){},playStoneSound(){},speakSecond(n){spoken.push(n);},localTimestamp:()=> 'test · UTC+1', play, opposite, score, gameTree, reviewPosition, gameClock, byoyomiSettings, timeLeft, sgf, standardKomi, MIN_LIBRARY_MOVES, MAX_GAME_MOVES, language:'en', t: (zh,en)=>en, translateError:s=>s, setLanguage(){},
    location:{search:'',assign(url){calls.push('NAVIGATE '+url);}},URLSearchParams,
    document: {querySelector:s=>{const m=s.match(/input\[value="([^"]+)"\]/);if(m)return radios.find(r=>r.value===m[1]);if(s.includes(':checked'))return radios.find(r=>r.checked)||null;if(!selected.has(s))selected.set(s,new Element());return selected.get(s);},getElementById:get,createElement:()=>new Element(),createElementNS:()=>new Element(),
      createDocumentFragment:()=>new Element(),querySelectorAll:s=>s.includes('name="result"')?radios:[],addEventListener(){},visibilityState:'visible',body:new Element()},
    window:{addEventListener(){}},setInterval(fn,ms){intervals.push({fn,ms});},setTimeout(fn,ms){timers.push({fn,ms});},clearTimeout(){},
    Date:class extends Date { static now(){return now;} },AbortSignal,TextEncoder,crypto:webcrypto,
    fetch:async (url,options)=>{
      calls.push(options.method === 'POST' && JSON.parse(options.body).action.type === 'heartbeat' ? 'HEARTBEAT' : options.method);
      if(options.method==='GET') {if(failGet)throw new Error('Offline');return {ok:true,json:async()=>({state:structuredClone(remote)})};}
      const request=JSON.parse(options.body);
      remote=transition(remote,request);
      if(publish&&remote.phase==='ended')remote=freshLiveGame(remote,remote.history.length>=MIN_LIBRARY_MOVES?'2026100601':undefined);
      if(failAfterSave)throw new Error('Response lost');
      return {ok:true,json:async()=>({state:structuredClone(remote)})};
    }
  });
  vm.runInContext(readFileSync(new URL('../src/board-geometry.js',import.meta.url),'utf8').replace(/^export /gm,''),context);
  vm.runInContext(readFileSync(new URL('../src/board-view.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),context);
  vm.runInContext(readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
  const run = code=>vm.runInContext(code,context);
  while(run('polling')) await new Promise(resolve=>setImmediate(resolve));
  const move=i=>{remote=transition(remote,{expectedRevision:remote.revision,action:{type:'move',index:i}});};
  const pass=()=>{remote=transition(remote,{expectedRevision:remote.revision,action:{type:'pass'}});};
  const endRemote=action=>{remote=transition(remote,{expectedRevision:remote.revision,action});remote=freshLiveGame(remote,remote.history.length>=MIN_LIBRARY_MOVES?'2026100601':undefined);};
  return {run,get,calls,spoken,intervals,timers,remote:()=>remote,move,pass,endRemote,
    // Stones on rows 0, 2 and 4 keep a liberty below, so nothing is captured.
    seed:n=>{for(let k=0;k<n;k++)move(38*Math.floor(k/19)+k%19);},
    choose:value=>{radios.find(r=>r.value===value).checked=true;},checked:()=>radios.find(r=>r.checked)?.value,
    submitResult:()=>get('end-game-form').onsubmit({preventDefault(){}}),
    loseResponse:()=>{failAfterSave=true;},offline:()=>{failGet=true;},online:()=>{failGet=false;failAfterSave=false;},advance:ms=>{now+=ms;}};
}
test('visible idle page polls every 3 seconds without a focus event',async()=>{
 const c=await client();assert.equal(c.intervals.find(i=>i.ms===3000).ms,3000);c.move(180);
 c.intervals.find(i=>i.ms===3000).fn();while(c.run('polling'))await new Promise(r=>setImmediate(r));
 assert.equal(c.run('state.board[180]'),'B');assert.match(c.get('turn').textContent,/White/);
});
test('player boxes show names, captures and time, and highlight the side to play',async()=>{
 const c=await client();
 assert.ok(c.get('black-box').classList.contains('active'));assert.ok(!c.get('white-box').classList.contains('active'));
 assert.match(c.get('turn').className,/sr-only/);assert.equal(c.get('black-box-label').textContent,'Black');assert.equal(c.get('black-time').textContent,'00:00:00');
 await c.run("action({type:'metadata',name:'Box test',players:{black:'Dewei Liu',white:''},playerRanks:{black:'5d',white:''}})");
 await c.run("action({type:'move',index:180})");
 assert.ok(c.get('white-box').classList.contains('active'));assert.ok(!c.get('black-box').classList.contains('active'));
 assert.equal(c.get('black-box-label').textContent,'Dewei Liu');assert.equal(c.get('black-box-rank').textContent,'5d');assert.equal(c.get('white-box-label').textContent,'White');
 assert.equal(c.get('black-captures').textContent,'0');assert.equal(c.get('black-captures-label').textContent,'Captures');
});
test('the edit dialog sets handicap before the first move and only states komi',async()=>{
 const c=await client();c.run("$('edit-game').onclick()");
 assert.equal(c.get('live-komi').textContent,'White komi: 7.5 points');assert.equal(c.get('live-handicap').disabled,false);
 c.get('live-handicap').value='3';c.get('live-handicap').onchange();assert.equal(c.get('live-komi').textContent,'White komi: 0.5 points');
 await c.get('edit-form').onsubmit({preventDefault(){}});
 assert.equal(c.remote().handicap,3);assert.equal(c.remote().komi,0.5);assert.equal(c.remote().turn,'white');
 assert.ok(c.get('white-box').classList.contains('active'));assert.match(c.get('game-terms').textContent,/Handicap 3 · White komi: 0.5 points/);
 await c.run("action({type:'move',index:180})");c.run("$('edit-game').onclick()");assert.equal(c.get('live-handicap').disabled,true);
});
test('byo-yomi is set before the first move, counts down, and a timeout only stops the clock',async()=>{
 const c=await client();c.run("$('edit-game').onclick()");
 assert.equal(c.get('live-time').value,'count');assert.equal(c.get('live-byoyomi').hidden,true);assert.match(c.get('live-time-hint').textContent,/No time limit/);
 assert.equal(c.get('black-periods').hidden,true);assert.match(c.get('game-terms').textContent,/^Chinese rules · White komi: 7.5 points · Count-up$/);assert.equal(c.get('detail').hidden,true);
 c.run("setLiveTime('byoyomi')");assert.equal(c.get('live-byoyomi').hidden,false);assert.equal(c.get('live-main').disabled,false);
 c.get('live-main').value='1';c.get('live-periods').value='3';c.get('live-period').value='30';
 await c.get('edit-form').onsubmit({preventDefault(){}});
 assert.deepEqual(c.remote().timeControl,{mainSeconds:60,overtime:'3x30 byo-yomi'});assert.equal(c.get('edit-dialog').open,false);
 c.intervals.find(i=>i.ms===1000).fn();
 assert.equal(c.get('black-time').textContent,'00:01:00');assert.equal(c.get('black-periods').hidden,false);assert.equal(c.get('black-periods').textContent,'Byo-yomi 3×30s');
 assert.match(c.get('game-terms').textContent,/Byo-yomi 1 min \+ 3×30s/);
 await c.run("action({type:'move',index:180})");c.run("$('edit-game').onclick()");
 assert.equal(c.get('live-time').value,'byoyomi');assert.equal(c.get('live-main').disabled,true);
 await c.get('edit-form').onsubmit({preventDefault(){}});assert.equal(c.get('edit-dialog').open,false);
 Object.assign(c.remote().clock,{timedOut:{side:'white',move:2},since:null});
 c.intervals.find(i=>i.ms===3000).fn();while(c.run('polling'))await new Promise(r=>setImmediate(r));c.intervals.find(i=>i.ms===1000).fn();
 assert.equal(c.get('white-time').textContent,'Time out');assert.ok(c.get('white-box').classList.contains('timeout'));
 assert.match(c.get('clock-note').textContent,/White ran out of time/);assert.ok(c.get('clock-note').classList.contains('timeout'));assert.equal(c.get('pause-clock').disabled,true);assert.equal(c.run('canPlay()'),true);
});
test('a clock that runs out locally shows 0 and syncs before showing the next period',async()=>{
 const c=await client(),tick=()=>c.run('renderClock()'),settle=async()=>{while(c.run('polling'))await new Promise(r=>setImmediate(r));};
 await c.run("action({type:'metadata',name:'T',players:{black:'',white:''},timeControl:{mainSeconds:60,overtime:'3x30 byo-yomi'}})");
 await c.run("action({type:'move',index:180})");
 // White has used 58.5s; 2s later the page alone thinks main time is over.
 c.remote().clock.white+=58500;c.intervals.find(i=>i.ms===3000).fn();await settle();tick();assert.equal(c.get('white-time').textContent,'00:00:02');
 c.advance(2000);const before=c.calls.length;tick();
 assert.equal(c.get('white-time').textContent,'00:00:00');assert.equal(c.get('white-periods').textContent,'Byo-yomi 3×30s');assert.ok(!c.get('white-box').classList.contains('byoyomi'));
 assert.equal(c.run('polling'),true);tick();await settle();assert.deepEqual(c.calls.slice(before),['HEARTBEAT']);
 tick();assert.equal(c.get('white-time').textContent,'00:00:30');assert.ok(c.get('white-box').classList.contains('byoyomi'));
 // The last period: White moved on another device just before it ran out here.
 // This page runs 2s ahead of the server after the advance above.
 c.remote().clock.white+=88000;c.intervals.find(i=>i.ms===3000).fn();await settle();tick();assert.equal(c.get('white-time').textContent,'00:00:02');assert.equal(c.get('white-periods').textContent,'Byo-yomi 1×30s');
 c.move(181);c.advance(2000);tick();
 assert.equal(c.get('white-time').textContent,'00:00:00');assert.equal(c.get('white-periods').textContent,'Byo-yomi 1×30s');assert.equal(c.get('clock-note').hidden,true);
 await settle();tick();
 assert.equal(c.run('state.turn'),'black');assert.equal(c.get('white-time').textContent,'00:00:30');assert.equal(c.get('white-periods').textContent,'Byo-yomi 1×30s');assert.equal(c.get('clock-note').hidden,true);
});
test('byo-yomi reads the last 10 seconds of a period aloud, once each',async()=>{
 const c=await client(),tick=()=>c.run('renderClock()');
 await c.run("action({type:'metadata',name:'T',players:{black:'',white:''},timeControl:{mainSeconds:0,overtime:'2x30 byo-yomi'}})");
 await c.run("action({type:'move',index:180})");
 tick();c.advance(15000);tick();assert.deepEqual(c.spoken,[]);
 c.advance(5500);tick();tick();assert.deepEqual(c.spoken,[10]);assert.equal(c.get('white-time').textContent,'00:00:10');
 c.advance(1000);tick();assert.deepEqual(c.spoken,[10,9]);
 c.run("state.clock.paused=true");c.advance(1000);tick();c.run("state.clock.paused=false");
 c.run("reviewing=0");tick();c.run("reviewing=null");assert.deepEqual(c.spoken,[10,9]);
});
test('sync status shows how long ago the page synced',async()=>{
 const c=await client();assert.equal(c.get('sync').textContent,'0s ago');assert.match(c.get('sync').title,/^Synced · /);
 const tick=c.intervals.find(i=>i.ms===1000).fn;c.advance(3000);tick();assert.equal(c.get('sync').textContent,'3s ago');
 c.advance(120000);tick();assert.equal(c.get('sync').textContent,'2m ago');
 await c.run("action({type:'move',index:180})");assert.equal(c.get('sync').textContent,'0s ago');assert.match(c.get('sync').title,/^Saved · /);
 c.get('auto').checked=false;c.get('auto').onchange();assert.equal(c.get('sync').textContent,'Paused');assert.ok(c.get('sync-group').classList.contains('off'));assert.match(c.get('sync').title,/^Saved · /);
 c.get('auto').checked=true;c.get('auto').onchange();assert.equal(c.get('sync').textContent,'0s ago');assert.ok(!c.get('sync-group').classList.contains('off'));
});
test('preflight rejects a stale move without submitting POST',async()=>{
 const c=await client();c.move(180);await c.run("action({type:'move',index:181})");
 assert.equal(c.remote().history.length,1);assert.ok(!c.calls.includes('POST'));assert.equal(c.run('state.revision'),1);
});
test('a lost POST response recovers state without replaying the move',async()=>{
 const c=await client();c.loseResponse();await c.run("action({type:'move',index:180})");
 assert.equal(c.remote().history.length,1);assert.equal(c.run('state.revision'),1);assert.equal(c.calls.filter(x=>x==='POST').length,1);
});
test('failed preflight never changes the board',async()=>{
 const c=await client();c.offline();await c.run("action({type:'move',index:180})");
 assert.equal(c.remote().revision,0);assert.equal(c.run('busy'),false);assert.ok(!c.calls.includes('POST'));
});
test('10 minutes idle switches polling off, and hidden tabs do not poll',async()=>{
 const c=await client();c.run("document.visibilityState='hidden'");const before=c.calls.length;
 c.intervals.find(i=>i.ms===3000).fn();assert.equal(c.calls.length,before);c.advance(600001);c.intervals.find(i=>i.ms===3000).fn();
 assert.equal(c.get('auto').checked,false);assert.equal(c.run('automatic'),false);assert.ok(c.get('sync-group').classList.contains('off'));assert.equal(c.get('sync').textContent,'Paused: no move in 10 min');
});
test('review stays selected while live moves sync and cannot submit moves',async()=>{
 const c=await client();c.move(180);await c.run('sync()');c.run('selectReview(-1)');
 const count=c.calls.length;await c.run("action({type:'move',index:181})");assert.equal(c.calls.length,count);
 c.move(182);await c.run('sync()');assert.equal(c.run('reviewing'),-1);
 assert.equal(c.get('turn').textContent,'Review · Move 0');
 c.get('review-live').onclick();assert.equal(c.run('reviewing'),null);assert.equal(c.run('state.history.length'),2);
});
test('background polling never disables otherwise available controls',async()=>{
 const c=await client();const changes=[];
 for(const id of ['pass','new','resign']) {
  let value=c.get(id).disabled;
  Object.defineProperty(c.get(id),'disabled',{get:()=>value,set:v=>{changes.push([id,v]);value=v;}});
 }
 await c.run('sync()');
 assert.ok(changes.length>0);assert.ok(changes.every(([,disabled])=>disabled===false));
});
test('syncing an unchanged game rewrites no text, so a highlight stays selected',async()=>{
 const c=await client();await c.run('sync()');const writes=[];
 for(const id of ['game-name','game-terms','turn','detail','black-box-label','white-box-label','black-captures','pass','undo','resign','count','pause-clock','clock-note']) {
  let value=c.get(id).textContent;
  Object.defineProperty(c.get(id),'textContent',{get:()=>value,set:v=>{writes.push(id);value=v;}});
 }
 await c.run('sync()');c.run('renderClock()');
 assert.deepEqual(writes,[]);
});
test('a move in flight leaves the panel unchanged; only a slow save shows submitting',async()=>{
 const c=await client();const changes=[];
 for(const id of ['pass','new','resign','edit-game','pause-clock']) {
  let value=c.get(id).disabled;
  Object.defineProperty(c.get(id),'disabled',{get:()=>value,set:v=>{if(v!==value)changes.push([id,v]);value=v;}});
 }
 const before=c.get('turn').textContent,saving=c.run("action({type:'move',index:180})");
 assert.equal(c.get('turn').textContent,before);
 c.timers.findLast(x=>x.ms===1500).fn();
 assert.equal(c.get('turn').textContent,'Black · Submitting…');await saving;
 assert.equal(c.get('turn').textContent,'To play: White');
 assert.deepEqual(changes,[]);
});
test('network errors show not sent and later sync recovers a saved move',async()=>{
 const before=await client();before.offline();await before.run("action({type:'move',index:180})");
 assert.equal(before.get('turn').textContent,'Black · Not sent');
 const after=await client();after.loseResponse();const saving=after.run("action({type:'move',index:180})");after.offline();await saving;
 assert.equal(after.get('turn').textContent,'Black · Not sent');
 assert.equal(after.remote().history.length,1);
 after.online();await after.run('sync()');assert.equal(after.get('turn').textContent,'To play: White');
});
test('background sync failure shows a persistent inline warning and successful retry clears it',async()=>{
 const c=await client();c.run("automatic=false");c.offline();await c.run('sync()');
 assert.equal(c.get('sync-warning').hidden,false);assert.match(c.get('sync-warning').textContent,/out of date/);
 c.online();await c.run('sync()');assert.equal(c.get('sync-warning').hidden,true);
});

test('one Resign button opens the result dialog with nothing selected until a winner is chosen',async()=>{
 for(const side of ['black','white']) {
  const c=await client();assert.equal(c.get('resign').textContent,'Resign');
  c.get('resign').onclick();assert.equal(c.get('end-game-dialog').open,true);assert.notEqual(c.get('confirm-dialog').open,true);
  assert.equal(c.checked(),undefined);assert.equal(c.get('end-game-confirm').disabled,true);
  c.submitResult();assert.equal(c.get('end-game-dialog').open,true);assert.equal(c.remote().phase,'play');
  c.run('selectResult("resign-'+opposite(side)+'")');assert.equal(c.get('end-game-confirm').disabled,false);
  c.submitResult();while(c.run('busy'))await new Promise(r=>setImmediate(r));
  assert.equal(c.remote().result.winner,opposite(side));assert.equal(c.remote().result.reason,'resign');
 }
});
test('a resign button opens the saved game on that page without the resigned popup',async()=>{
 const c=await client({publish:true});c.seed(MIN_LIBRARY_MOVES);await c.run('sync()');
 c.get('resign').onclick();assert.equal(c.get('end-game-confirm').textContent,'Save and view game');c.choose('resign-black');c.submitResult();
 while(c.run('busy'))await new Promise(r=>setImmediate(r));
 assert.deepEqual(c.calls.filter(x=>x.startsWith('NAVIGATE')),['NAVIGATE /game/2026100601']);assert.notEqual(c.get('resigned-dialog').open,true);
});
test('other open pages show who resigned, linking to the game only when it was saved',async()=>{
 for(const moves of [MIN_LIBRARY_MOVES,1]){
  const c=await client();c.seed(moves);await c.run('sync()');c.get('end-game-dialog').showModal();
  c.endRemote({type:'resign',side:'black'});await c.run('sync()');
  assert.equal(c.get('resigned-dialog').open,true);assert.equal(c.get('end-game-dialog').open,false);
  assert.equal(c.get('resigned-title').textContent,'Black resigned');assert.equal(c.get('resigned-open').hidden,moves<MIN_LIBRARY_MOVES);
  if(moves<MIN_LIBRARY_MOVES)assert.match(c.get('resigned-text').textContent,/not saved/);
  else {c.get('resigned-open').onclick();assert.deepEqual(c.calls.filter(x=>x.startsWith('NAVIGATE')),['NAVIGATE /game/2026100601']);}
  c.get('resigned-close').onclick();assert.equal(c.get('resigned-dialog').open,false);
 }
 const c=await client();c.seed(MIN_LIBRARY_MOVES);await c.run('sync()');
 c.endRemote({type:'result',reason:'unfinished'});await c.run('sync()');
 assert.notEqual(c.get('resigned-dialog').open,true);assert.match(c.get('notice').textContent,/saved to the library/);
});

test('preview moves are local, survive sync, undo and clear without changing saved history',async()=>{
 const c=await client();c.move(180);await c.run('sync()');c.run('selectReview(-1)');
 const calls=c.calls.length, original=JSON.stringify(c.remote());
 c.run('previewMove(0)');c.run('previewMove(1)');
 assert.equal(c.run('trialMoves.at(-1).board.slice(0,2)'), 'BW');
 assert.equal(c.calls.length,calls);assert.equal(JSON.stringify(c.remote()),original);
 await c.run('sync()');assert.equal(c.run('trialMoves.length'),2);
 c.get('trial-undo').onclick();assert.equal(c.run('trialMoves.length'),1);
 c.get('trial-reset').onclick();assert.equal(c.run('trialMoves.length'),0);
 c.run('previewMove(0)');c.run('selectReview(0)');assert.equal(c.run('trialMoves.length'),0);
 c.run('previewMove(1)');c.get('review-live').onclick();assert.equal(c.run('trialMoves.length'),0);
 assert.equal(c.run('state.history.length'),1);
});

test('live tree hides legacy abandoned variations and navigation stays on the active sequence',async()=>{
 const c=await client();c.move(180);c.move(181);await c.run('sync()');
 c.run("state.tree.nodes.push([0,'white',0,[[0,'W']]]);treeRenderKey='';renderTree();");
 assert.equal(c.get('history').children[0].children.length,3);
 c.run('selectReview(0)');c.get('review-next').onclick();assert.equal(c.run('reviewing'),1);
 c.run('selectReview(-1)');c.get('review-next').onclick();assert.equal(c.run('reviewing'),0);
});

test('End game recovers stale finished state instead of showing disabled result choices',async()=>{
 const c=await client();c.run("state.phase='ended'");c.get('new').onclick();
 while(c.run('polling'))await new Promise(r=>setImmediate(r));
 assert.equal(c.run('state.phase'),'play');assert.ok(c.calls.includes('HEARTBEAT'));
});

test('New game and Confirm dead stones open one dialog with the automatic count selected',async()=>{
 const c=await client();c.move(180);await c.run('sync()');
 assert.equal(c.get('new').textContent,'New game');assert.equal(c.get('edit-game').textContent,'Edit game info');
 c.get('new').onclick();assert.equal(c.get('end-game-dialog').open,true);
 assert.equal(c.get('result-count-label').textContent,'Automatic count result'); assert.match(c.get('result-count-summary').textContent,/^Black \d+(\.\d+)? · White \d+(\.\d+)? \+ [\d.]+ komi$/); assert.match(c.get('result-count-winner').textContent,/wins by|Draw/);
 assert.equal(c.checked(),'score-black');assert.equal(c.get('margin-black').value,353.5);assert.equal(c.get('margin-white').value,'');
 c.get('end-game-cancel').onclick();assert.equal(c.get('end-game-dialog').open,false);
 await c.run("action({type:'pass'})");await c.run("action({type:'pass'})");
 c.get('confirm-score').onclick();assert.equal(c.get('end-game-dialog').open,true);assert.equal(c.checked(),'score-black');
 c.submitResult();assert.notEqual(c.get('confirm-dialog').open,true);while(c.run('busy'))await new Promise(r=>setImmediate(r));
 assert.equal(c.remote().result.reason,'score');assert.equal(c.remote().result.black,361);assert.equal(c.remote().phase,'ended');
});

test('manual results need a valid margin and send the chosen reason',async()=>{
 const c=await client();c.move(180);await c.run('sync()');
 c.get('new').onclick();c.choose('score-white');const posts=c.calls.filter(x=>x==='POST').length;
 c.submitResult();assert.match(c.get('margin-white').reported,/valid winning margin/);assert.equal(c.calls.filter(x=>x==='POST').length,posts);
 c.get('margin-white').value='2.5';c.get('margin-white').oninput();c.submitResult();while(c.run('busy'))await new Promise(r=>setImmediate(r));
 assert.deepEqual(c.remote().result,{winner:'white',reason:'score',margin:2.5});
 const u=await client();u.move(180);await u.run('sync()');u.get('new').onclick();u.choose('unfinished');u.submitResult();
 while(u.run('busy'))await new Promise(r=>setImmediate(r));assert.deepEqual(u.remote().result,{winner:null,reason:'unfinished'});
});

test('a result chosen before the game changed is not sent',async()=>{
 const c=await client();c.move(180);await c.run('sync()');c.get('new').onclick();
 c.move(181);await c.run('sync()');const posts=c.calls.filter(x=>x==='POST').length;
 c.submitResult();assert.equal(c.get('end-game-dialog').open,false);assert.match(c.get('notice').textContent,/changed/);
 assert.equal(c.calls.filter(x=>x==='POST').length,posts);assert.equal(c.remote().phase,'play');
});

test('games under 50 moves end without saving and say so',async()=>{
 const c=await client({publish:true});c.move(180);await c.run('sync()');
 await c.run("action({type:'pass'})");await c.run("action({type:'pass'})");
 c.get('confirm-score').onclick();assert.equal(c.get('result-short').hidden,false);assert.match(c.get('result-short').textContent,/Under 50 moves/);
 assert.equal(c.get('end-game-confirm').textContent,'End game');
 c.submitResult();while(c.run('busy'))await new Promise(r=>setImmediate(r));
 assert.equal(c.run('state.history.length'),0);assert.ok(!c.calls.some(x=>x.startsWith('NAVIGATE')));
 assert.match(c.get('notice').textContent,/not saved/);
});

test('play stops at the 400-move limit and points to New game',async()=>{
 const c=await client();
 // Black alone on rows 0, 2, 4… plus row 1, with White passing, never captures or double-passes.
 for(let k=0;k<MAX_GAME_MOVES/2;k++){c.move(k<190?38*Math.floor(k/19)+k%19:19+2*(k-190));c.pass();}
 await c.run('sync()');
 assert.equal(c.run('state.history.length'),MAX_GAME_MOVES);assert.equal(c.run('canPlay()'),false);assert.equal(c.get('pass').disabled,true);assert.equal(c.get('new').disabled,false);
 assert.match(c.get('detail').textContent,/400-move limit reached\. Select New game to choose the result\./);
});

test('New game keeps the player on the fresh board after either result choice',async()=>{
 for(const choice of [null,'resign-white']){
  const c=await client({publish:true});c.seed(MIN_LIBRARY_MOVES);await c.run('sync()');
  c.get('new').onclick();assert.equal(c.get('result-short').hidden,true);assert.equal(c.get('end-game-confirm').textContent,'Save and start a new game');
  if(choice)c.choose(choice);c.submitResult();
  while(c.run('busy'))await new Promise(r=>setImmediate(r));
  assert.equal(c.run('state.history.length'),0);assert.equal(c.run('state.phase'),'play');
  assert.ok(!c.calls.some(x=>x.startsWith('NAVIGATE')));assert.match(c.get('notice').textContent,/saved to the library/);
 }
});
test('finishing through passes opens the saved game for counted or manual results',async()=>{
 for(const choice of [null,'unfinished']){
  const c=await client({publish:true});c.seed(MIN_LIBRARY_MOVES);await c.run('sync()');
  await c.run("action({type:'pass'})");await c.run("action({type:'pass'})");
  c.get('confirm-score').onclick();assert.equal(c.get('result-label').textContent,'Game result');assert.equal(c.get('end-game-confirm').textContent,'Save and view game');
  if(choice)c.choose(choice);c.submitResult();
  while(c.run('busy'))await new Promise(r=>setImmediate(r));
  assert.deepEqual(c.calls.filter(x=>x.startsWith('NAVIGATE')),['NAVIGATE /game/2026100601']);
 }
});
test('a lost completion response still opens the saved game once, without replaying the result',async()=>{
 const c=await client({publish:true});c.seed(MIN_LIBRARY_MOVES);await c.run('sync()');
 await c.run("action({type:'pass'})");await c.run("action({type:'pass'})");
 c.get('confirm-score').onclick();c.loseResponse();
 const posts=c.calls.filter(x=>x==='POST').length;c.submitResult();
 while(c.run('busy'))await new Promise(r=>setImmediate(r));
 assert.equal(c.calls.filter(x=>x==='POST').length,posts+1);
 assert.deepEqual(c.calls.filter(x=>x.startsWith('NAVIGATE')),['NAVIGATE /game/2026100601']);
});
