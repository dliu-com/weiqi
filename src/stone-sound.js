import {t} from './i18n.js';
const key='weiqi.stone-volume',defaultVolume=5,controls=[];
let context=null,volume=defaultVolume;
try{const saved=localStorage.getItem(key);if(saved!==null&&Number.isFinite(Number(saved)))volume=Math.max(0,Math.min(100,Number(saved)));}catch{}

// A short recorded stone click, shared by Record, Play and game replay. See the adjacent
// stone-placement-LICENSE.txt for the original sample and MIT attribution.
const sampleBytes=fetch(new URL('./stone-placement.mp3',import.meta.url)).then(response=>response.ok?response.arrayBuffer():null).catch(()=>null);
let decodedSample=null;
function audio(){
 try{const Audio=window.AudioContext||window.webkitAudioContext;if(Audio)context??=new Audio();}catch{}
 return context;
}
export function prepareStoneSound(){
 if(!volume)return;
 // iOS only speaks after speech has started inside a tap, so speech is primed on each tap until sound is on.
 if(!soundOn()&&window.speechSynthesis&&typeof SpeechSynthesisUtterance==='function'){try{const u=new SpeechSynthesisUtterance('');u.volume=0;speechSynthesis.speak(u);}catch{}}
 if(!audio())return;
 try{
  if(context.state==='suspended')void context.resume().catch(()=>{});
  decodedSample??=sampleBytes.then(bytes=>bytes?context.decodeAudioData(bytes):null).catch(()=>null);
 }catch{}
}
// Browsers keep a newly loaded page silent until it is tapped (a refresh counts as newly loaded).
const soundOn=()=>context?.state==='running';
export const soundBlocked=()=>!!volume&&!!audio()&&!soundOn();
export function unlockSoundOnTap(){
 const events=['pointerdown','pointerup','touchend','click','keydown'],unlock=()=>{prepareStoneSound();if(soundOn())for(const e of events)window.removeEventListener(e,unlock,true);};
 for(const e of events)window.addEventListener(e,unlock,true);
}
export function playStoneSound(){
 if(!volume||!context||!decodedSample)return;
 // Decode once; each placement starts one non-looping click at the selected
 // volume. A failed audio load must never prevent a move being recorded.
 void decodedSample.then(async buffer=>{
  if(!volume||!buffer)return;
  if(context.state==='suspended')await context.resume();
  if(!volume||context.state!=='running')return;
  const source=context.createBufferSource(),gain=context.createGain();
  source.buffer=buffer;source.loop=false;gain.gain.value=volume/100;
  source.connect(gain);gain.connect(context.destination);
  source.onended=()=>{source.disconnect();gain.disconnect();};source.start();
 }).catch(()=>{});
}
// Byo-yomi speech uses the same volume setting; speech is quieter than the click, so low settings are raised.
// Each utterance measures how long speech takes to start, so the countdown can start that much early.
let speechDelay=150;
export const speechLead=()=>speechDelay;
export function speakText(text){
 const speech=window.speechSynthesis;if(!volume||!speech||typeof SpeechSynthesisUtterance!=='function')return;
 try{
  speech.cancel();const u=new SpeechSynthesisUtterance(text),at=performance.now();
  u.lang=t('zh-CN','en-GB');u.rate=1.2;u.volume=Math.sqrt(volume/100);
  u.onstart=()=>{const delay=performance.now()-at;if(delay>=0&&delay<2000)speechDelay=Math.round(Math.max(100,Math.min(600,speechDelay*0.7+delay*0.3)));};
  speech.speak(u);
 }catch{}
}
export const speakSecond=n=>speakText(String(n));
// One solid beep when a player runs out of time.
export function playTimeoutBeep(){
 if(!volume||!audio())return;
 try{
  if(context.state==='suspended')void context.resume().catch(()=>{});
  const tone=context.createOscillator(),gain=context.createGain(),start=context.currentTime+0.02,level=0.5*Math.sqrt(volume/100);
  tone.type='sine';tone.frequency.value=880;
  gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(level,start+0.01);gain.gain.setValueAtTime(level,start+0.79);gain.gain.linearRampToValueAtTime(0,start+0.8);
  tone.connect(gain);gain.connect(context.destination);tone.onended=()=>{tone.disconnect();gain.disconnect();};
  tone.start(start);tone.stop(start+0.8);
 }catch{}
}
export function mountStoneSound(container){
 const label=document.createElement('label'),text=document.createElement('span'),slider=document.createElement('input'),value=document.createElement('output');
 label.className='stone-sound-control';slider.type='range';slider.min='0';slider.max='100';slider.step='1';
 slider.oninput=()=>{volume=Number(slider.value);try{localStorage.setItem(key,String(volume));}catch{}refresh();prepareStoneSound();};
 slider.onchange=()=>playStoneSound();label.append(text,slider,value);container.append(label);controls.push({text,slider,value});refresh();
}
function refresh(){for(const {text,slider,value}of controls){text.textContent=t('落子音量','Stone sound volume');text.title=text.textContent;slider.setAttribute('aria-label',text.textContent);slider.value=String(volume);value.textContent=volume?volume+'%':t('静音','Muted');}}
window.addEventListener('site-language-change',refresh);
window.addEventListener('storage',event=>{if(event.key===key){volume=event.newValue===null?defaultVolume:Math.max(0,Math.min(100,Number(event.newValue)||0));refresh();}});
