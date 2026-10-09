import {t} from './i18n.js';
const key='weiqi.stone-volume',defaultVolume=5,controls=[];
let context=null,volume=defaultVolume;
try{const saved=localStorage.getItem(key);if(saved!==null&&Number.isFinite(Number(saved)))volume=Math.max(0,Math.min(100,Number(saved)));}catch{}

// A short recorded stone click, shared by Record, Play and game replay. See the adjacent
// stone-placement-LICENSE.txt for the original sample and MIT attribution.
const sampleBytes=fetch(new URL('./stone-placement.mp3',import.meta.url)).then(response=>response.ok?response.arrayBuffer():null).catch(()=>null);
let decodedSample=null;
let speechReady=false;
export function prepareStoneSound(){
 if(!volume)return;
 // iOS only speaks after speech has started inside a tap.
 if(!speechReady&&window.speechSynthesis&&typeof SpeechSynthesisUtterance==='function'){speechReady=true;try{const u=new SpeechSynthesisUtterance('');u.volume=0;speechSynthesis.speak(u);}catch{}}
 try{
  const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
  context??=new Audio();
  if(context.state==='suspended')void context.resume().catch(()=>{});
  decodedSample??=sampleBytes.then(bytes=>bytes?context.decodeAudioData(bytes):null).catch(()=>null);
 }catch{}
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
// Byo-yomi seconds are read aloud at the same volume setting; speech is quieter than the click, so low settings are raised.
export function speakSecond(n){
 const speech=window.speechSynthesis;if(!volume||!speech||typeof SpeechSynthesisUtterance!=='function')return;
 try{speech.cancel();const u=new SpeechSynthesisUtterance(String(n));u.lang=t('zh-CN','en-GB');u.rate=1.2;u.volume=Math.sqrt(volume/100);speech.speak(u);}catch{}
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
