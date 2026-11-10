import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PAGE_BUDGETS,CPU_BUDGETS,LIVE_TARGETS,LIVE_SAMPLES,RATE_LIMITED_READS,SERVER_BUDGETS} from '../src/performance-spec.js';
import {pageWeight,timeWorkload,WORKLOADS,largestSgf,playGame} from '../scripts/performance/workloads.mjs';
import {MAX_SGF_BYTES,readSgf} from '../src/sgf.js';
import {sgf} from '../src/engine.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const data=JSON.parse(read('src/performance-data.json'));

test('every page stays within its download budget (HTML, local CSS and all statically imported modules, gzipped)',()=>{
 for(const budget of PAGE_BUDGETS){
  const {gzip,files}=pageWeight(budget.file);
  assert.ok(files.length>0,budget.file);
  assert.ok(gzip<=budget.kb*1024,`${budget.path} (${budget.file}) is ${(gzip/1024).toFixed(1)} KB gzipped; the budget is ${budget.kb} KB.`);
 }
});

test('page budgets cover every page the site serves, at its public address',()=>{
 const c={};vm.runInNewContext(read('src/routes.cjs'),c);
 const served=uri=>c.handler({request:{uri,querystring:{}}}).uri;
 for(const budget of PAGE_BUDGETS.filter(b=>!b.path.includes('<id>')))assert.equal(served(budget.path),budget.path==='/'?'/':'/'+budget.file,budget.path);
 assert.equal(served('/game/2026110903'),'/record.html');assert.equal(served('/game/2026110903/report'),'/report.html');
 const pages=['index.html','play.html','library.html','record.html','report.html','editor.html','photo.html','how-to-use.html','about.html'];
 assert.deepEqual(PAGE_BUDGETS.map(b=>b.file).sort(),pages.sort());
});

test('code speed stays within budget (median of 5 runs)',()=>{
 for(const budget of CPU_BUDGETS){
  assert.ok(WORKLOADS[budget.id],budget.id);
  const {medianMs}=timeWorkload(budget.id);
  assert.ok(medianMs<=budget.ms,`${budget.id} took ${medianMs.toFixed(1)} ms; the budget is ${budget.ms} ms.`);
 }
});

test('the code-speed workloads are real: a 300-move game with captures, and an SGF at the upload limit',()=>{
 const game=playGame(300);assert.equal(game.history.length,300);assert.ok(game.captures.black+game.captures.white>0);
 const text=sgf(game),big=largestSgf(text);
 assert.ok(Buffer.byteLength(big)<=MAX_SGF_BYTES&&Buffer.byteLength(big)>MAX_SGF_BYTES*0.95);
 assert.equal(readSgf(big).mainLine.length,301);assert.equal(readSgf(text).mainLine.length,301);
});

test('the last measurement is complete, answered 200 everywhere and kept every budget',()=>{
 assert.ok(Number.isFinite(Date.parse(data.measuredAt)));
 assert.equal(data.samples,LIVE_SAMPLES);assert.ok(data.requests>LIVE_TARGETS.length*LIVE_SAMPLES&&data.requests<200);
 assert.deepEqual(data.live.map(r=>r.path),LIVE_TARGETS.map(t=>t.path));
 for(const r of data.live){assert.equal(r.status,200,r.path);assert.ok(r.cold.total>0&&r.warm.ttfb>0,r.path);}
 for(const budget of PAGE_BUDGETS){const page=data.pages.find(p=>p.path===budget.path);assert.ok(page,budget.path);assert.ok(page.servedBytes<=budget.kb*1024,`${budget.path} served ${page.servedBytes} bytes`);}
 assert.deepEqual(data.cpu.map(c=>c.id),CPU_BUDGETS.map(c=>c.id));
 assert.ok(Number.isFinite(Date.parse(data.server.measuredAt)));
 for(const budget of SERVER_BUDGETS){
  const fn=data.server.functions.find(f=>f.id===budget.id);assert.ok(fn,budget.id);
  if(fn.invocations)assert.ok(fn.p95Ms<=budget.p95,`${budget.id} p95 ${fn.p95Ms} ms; the budget is ${budget.p95} ms.`);
 }
});

test('the measuring script stays a guest: GET only, no cookies or tokens, and far below the read limit',()=>{
 const script=read('scripts/performance/measure.mjs');
 for(const target of LIVE_TARGETS)assert.doesNotMatch(target.path,/^\/(api\/owner|auth|api\/v\d)/,target.path);
 assert.doesNotMatch(script,/['"](-X|--request|-d|--data[\w-]*|-b|--cookie|-F|--form|-u|--user|-H)['"]|method\s*:|authorization|cookie:/i);
 assert.match(script,/'--proto','=https'/);
 const reads=1+LIVE_TARGETS.filter(t=>RATE_LIMITED_READS(t.path)).length*LIVE_SAMPLES;
 assert.ok(reads<=30,`${reads} rate-limited reads; the limit is 120 a minute.`);
 assert.match(read('backend/handler.cjs'),/CLIENT_READS_PER_MINUTE\|\|120\)/);
});

test('the Performance tab is wired into /docs and published',()=>{
 assert.match(read('src/site-shell.js'),/\['performance','性能','Performance'\]/);
 const about=read('src/about.js');
 assert.match(about,/import \{renderPerformance\} from '\.\/performance\.js';/);
 assert.match(about,/if\(tab==='performance'\)\{renderPerformance\(/);
 assert.match(about,/\['\/docs#performance','gauge',/);
 const publish=read('scripts/publish-site.sh');
 for(const file of ['performance.js','performance-spec.js','performance-data.json'])assert.ok(publish.includes(' '+file+' '),file);
 const view=read('src/performance.js');
 assert.match(view,/fetch\('\/performance-data\.json'/);
 assert.match(view,/from '\.\/performance-spec\.js'/);
 assert.doesNotMatch(read('src/performance-spec.js'),/^import /m,'the spec loads in the browser, so it must not import Node modules');
});
