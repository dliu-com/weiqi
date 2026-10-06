import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as status from '../src/analysis-status.js';
import {localTimestamp} from '../src/site-time.js';
const source=readFileSync(new URL('../src/record.js',import.meta.url),'utf8');
const now=Date.parse('2026-10-06T12:00:07Z');
class Clock extends Date{static now(){return now;}}
function context(analysis,zh=false){const c={...status,analysisWait:(a,m)=>status.analysisWait(a,m,now),analysisCompletion:(a,m)=>status.analysisCompletion(a,m,now),queueWait:a=>status.queueWait(a,now),pollTimer:null,Date:Clock,localTimestamp,document:{documentElement:{lang:zh?'zh-CN':'en'},hidden:false},t:(a,b)=>zh?a:b,data:{metadata:{moves:100,analysis}},analysisTotal:()=>'',record:{},clearTimeout(){},setTimeout(fn,ms){c.delay=ms;},load(){}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function pendingMessage(){'),source.indexOf('function scheduleStatusTicker()')),c);vm.runInContext(source.slice(source.indexOf('function schedulePoll(){'),source.indexOf('async function load()')),c);return c;}
test('queue interface uses one conservative minute timestamp for start and finish in both languages',()=>{
 const latest=now+103000,analysis={status:'queued',estimatedSeconds:94,queueStatus:{state:'queued',startsAt:{earliest:now+30000,latest}}};
 for(const zh of [false,true]){const c=context(analysis,zh),message=c.pendingMessage();assert.ok(message.includes(localTimestamp(status.conservativeMinute(latest),zh?'zh':'en',{seconds:false})));assert.ok(message.includes(localTimestamp(status.conservativeMinute(latest+94000),zh?'zh':'en',{seconds:false})));assert.doesNotMatch(message,/ – |\d+–\d+|\d{2}:\d{2}:\d{2}/);assert.match(message,/UTC[+−]/);}
});
test('deep wait keeps its estimate and removes the refresh notice; only quick jobs poll once per minute',()=>{
 const quick=context({status:'queued'});quick.schedulePoll();assert.equal(quick.delay,60000);
 const deep=context({status:'running',available:'quick',quick:{status:'ready'},deep:{status:'running',startedAt:'2026-10-06T11:58:35Z',estimatedSeconds:600,phase:'deep'}});
 deep.data.analysis={phase:'quick'};const text=deep.pendingMessage();assert.match(text,/Estimated finish:/);assert.doesNotMatch(text,/Refresh|\d{2}:\d{2}:\d{2}/);deep.schedulePoll();assert.equal(deep.delay,undefined);
});
