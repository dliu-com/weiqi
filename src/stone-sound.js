import {t} from './i18n.js';
const key='weiqi.stone-volume',controls=[];
let context=null,volume=35;
try{const saved=localStorage.getItem(key);if(saved!==null&&Number.isFinite(Number(saved)))volume=Math.max(0,Math.min(100,Number(saved)));}catch{}

// Unlock audio during the board's user gesture, before a live game's network
// request. No downloaded audio, cloud calls or autoplay on page load.
export function prepareStoneSound(){
 if(!volume)return;
 try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;context??=new Audio();if(context.state==='suspended')void context.resume().catch(()=>{});}catch{}
}
export function playStoneSound(){
 if(!volume||!context)return;
 try{
  const sound=()=>{
   if(!volume||context.state!=='running')return;
   const now=context.currentTime,gain=context.createGain(),tone=context.createOscillator(),noise=context.createBufferSource(),filter=context.createBiquadFilter();
   // A short ceramic click with a lower wooden-board resonance.
   gain.gain.setValueAtTime(volume/100*.28,now);gain.gain.exponentialRampToValueAtTime(.0001,now+.13);gain.connect(context.destination);
   tone.type='sine';tone.frequency.setValueAtTime(760,now);tone.frequency.exponentialRampToValueAtTime(240,now+.09);tone.connect(gain);tone.start(now);tone.stop(now+.14);
   const buffer=context.createBuffer(1,Math.ceil(context.sampleRate*.045),context.sampleRate),samples=buffer.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=(Math.random()*2-1)*Math.exp(-i/(context.sampleRate*.006))*.7;
   noise.buffer=buffer;filter.type='lowpass';filter.frequency.value=2600;noise.connect(filter);filter.connect(gain);noise.start(now);noise.stop(now+.05);
   tone.onended=()=>{tone.disconnect();noise.disconnect();filter.disconnect();gain.disconnect();};
  };
  if(context.state==='suspended')void context.resume().then(sound).catch(()=>{});else sound();
 }catch{} // Sound must never prevent a move from being recorded.
}
export function mountStoneSound(container){
 const label=document.createElement('label'),text=document.createElement('span'),slider=document.createElement('input'),value=document.createElement('output');
 label.className='stone-sound-control';slider.type='range';slider.min='0';slider.max='100';slider.step='1';
 slider.oninput=()=>{volume=Number(slider.value);try{localStorage.setItem(key,String(volume));}catch{}refresh();prepareStoneSound();};
 slider.onchange=()=>playStoneSound();label.append(text,slider,value);container.append(label);controls.push({text,slider,value});refresh();
}
function refresh(){for(const {text,slider,value}of controls){text.textContent=t('落子音量','Stone sound volume');slider.setAttribute('aria-label',text.textContent);slider.value=String(volume);value.textContent=volume?volume+'%':t('静音','Muted');}}
window.addEventListener('site-language-change',refresh);
window.addEventListener('storage',event=>{if(event.key===key){volume=event.newValue===null?35:Math.max(0,Math.min(100,Number(event.newValue)||0));refresh();}});
