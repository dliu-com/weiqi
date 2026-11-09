import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Runs the real src/stone-sound.js with a fake Web Audio context and records the gain each stone click is played at.
function load(saved={}){
 const store=new Map(Object.entries(saved)),contexts=[];
 class FakeAudioContext{
  constructor(){this.state='running';this.destination={};this.gains=[];contexts.push(this);}
  resume(){this.state='running';return Promise.resolve();}
  decodeAudioData(){return Promise.resolve({duration:0.2});}
  createBufferSource(){return {connect(){},disconnect(){},start(){}};}
  createGain(){const node={gain:{value:null},connect(){},disconnect(){}};this.gains.push(node);return node;}
 }
 const element=()=>({children:[],append(...nodes){this.children.push(...nodes);},setAttribute(){}});
 const context=vm.createContext({
  window:{AudioContext:FakeAudioContext,addEventListener(){}},
  localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))},
  fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)}),
  document:{createElement:element},URL,performance,Promise,Math,Number,String
 });
 const source=readFileSync(new URL('../src/stone-sound.js',import.meta.url),'utf8')
  .replace("import {t} from './i18n.js';",'const t=(zh,en)=>en;').replace('import.meta.url',"'https://weiqi.dliu.com/stone-sound.js'").replace(/^export /gm,'');
 vm.runInContext(source,context);
 const run=code=>vm.runInContext(code,context),container=element();
 run('mountStoneSound')(container);
 const slider=container.children[0].children[1];
 return {run,store,slider,
  async click(volume){
   if(volume!==undefined){slider.value=String(volume);slider.oninput();}
   run('prepareStoneSound()');run('playStoneSound()');
   for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,0));
   return contexts[0]?.gains.at(-1)?.gain.value??null;
  }};
}
const dB=gain=>20*Math.log10(gain);

test('low stone-sound settings are really quiet: the click follows loudness, not amplitude (bug 2026-11-09)',async()=>{
 const page=load(),played={};
 for(const v of [100,50,30,20,10,5,1])played[v]=await page.click(v);
 assert.equal(played[100],1,'100% plays the sample at full level');
 for(const [v,gain]of Object.entries(played))assert.ok(Math.abs(gain-(v/100)**3)<1e-12,v+'% → '+gain);
 // With the old linear gain, 10% was only 20 dB below 100% and still sounded loud.
 assert.ok(dB(played[10])<=-50,'10% is at least 50 dB down: '+dB(played[10]).toFixed(1)+' dB');
 assert.ok(dB(played[30])<=-25,'30% is at least 25 dB down: '+dB(played[30]).toFixed(1)+' dB');
 const order=[1,5,10,20,30,50,100].map(v=>played[v]);
 assert.deepEqual([...order].sort((a,b)=>a-b),order,'louder settings are never quieter');
 assert.equal(page.store.get('weiqi.stone-volume-v2'),'1','the setting is remembered');
});

test('the default is quiet, muted plays nothing, and an old linear setting keeps its loudness',async()=>{
 const fresh=load();assert.equal(fresh.slider.value,'20','the default is 20%');
 assert.ok(dB(await fresh.click())<=-40,'the default click is at least 40 dB down');
 const muted=load();assert.equal(await muted.click(0),null,'0% creates no sound');
 const old=load({'weiqi.stone-volume':'5'});
 assert.equal(old.slider.value,'37');assert.equal(old.store.get('weiqi.stone-volume-v2'),'37');
 assert.ok(Math.abs(dB(await old.click())-dB(0.05))<0.5,'an old 5% stays about as loud as before');
 assert.equal(load({'weiqi.stone-volume':'0'}).slider.value,'0','an old muted setting stays muted');
 assert.equal(load({'weiqi.stone-volume':'5','weiqi.stone-volume-v2':'12'}).slider.value,'12','the new setting wins');
});
