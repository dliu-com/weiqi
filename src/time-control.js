export function timeControlFields(value) {
 if(!value)return {type:'',minutes:30,periods:5,seconds:30,increment:10};
 const minutes=value.mainSeconds/60,ot=value.overtime||'';
 if(!ot)return {type:'absolute',minutes};
 const byo=ot.match(/^(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:byo[- ]?yomi|byoyomi)$/i);
 if(byo)return {type:'byoyomi',minutes,periods:Number(byo[1]),seconds:Number(byo[2])};
 const fischer=ot.match(/^(?:Fischer\s*[:+]?\s*)(\d+(?:\.\d+)?)(?:\s*(?:s|sec|seconds)(?:\s*increment)?)?$/i);
 if(fischer)return {type:'fischer',minutes,increment:Number(fischer[1])};
 return {type:'imported',minutes,overtime:ot};
}
export function timeControlValue(fields) {
 if(!fields.type)return null;
 const mainSeconds=Math.round(Number(fields.minutes)*60000)/1000;
 if(!Number.isFinite(mainSeconds)||mainSeconds<0||mainSeconds>864000)throw Error('Enter a valid main time.');
 if(fields.type==='absolute')return {mainSeconds,overtime:''};
 if(fields.type==='imported')return {mainSeconds,overtime:fields.overtime};
 if(fields.type==='byoyomi'){
  const periods=Number(fields.periods),seconds=Number(fields.seconds);
  if(!Number.isInteger(periods)||periods<1||periods>100||!Number.isFinite(seconds)||seconds<=0||seconds>3600)throw Error('Enter valid byo-yomi periods and seconds.');
  return {mainSeconds,overtime:periods+'x'+seconds+' byo-yomi'};
 }
 if(fields.type==='fischer'){
  const increment=Number(fields.increment);
  if(!Number.isFinite(increment)||increment<=0||increment>3600)throw Error('Enter a valid Fischer increment.');
  return {mainSeconds,overtime:'Fischer: '+increment+' seconds increment'};
 }
 throw Error('Choose a time control.');
}
export function timeControlSummary(value,t=(zh,en)=>en) {
 if(!value)return '';
 const f=timeControlFields(value),minutes=String(Number(f.minutes.toFixed(3)));
 if(f.type==='absolute')return t('绝对用时：'+minutes+' 分钟','Absolute time: '+minutes+' min');
 if(f.type==='byoyomi')return t('日式读秒：'+minutes+' 分钟 + '+f.periods+' 次 × '+f.seconds+' 秒','Japanese byo-yomi: '+minutes+' min + '+f.periods+' × '+f.seconds+' sec');
 if(f.type==='fischer')return t('费舍尔加秒：'+minutes+' 分钟 + 每手 '+f.increment+' 秒','Fischer: '+minutes+' min + '+f.increment+' sec per move');
 return minutes+t(' 分钟 · ',' min · ')+f.overtime;
}
export function mountTimeControl(form,t) {
 const box=document.createElement('fieldset');box.className='time-control-fields';
 const legend=document.createElement('legend');box.append(legend);
 const grid=document.createElement('div');grid.className='time-control-grid';box.append(grid);
 const labels={},inputs={};
 function field(name,input){const label=document.createElement('label'),title=document.createElement('span');label.append(title,input);grid.append(label);labels[name]=title;inputs[name]=input;return label;}
 const select=document.createElement('select');select.name='timeType';field('type',select);
 for(const value of ['','absolute','byoyomi','fischer']){const option=document.createElement('option');option.value=value;select.append(option);}
 const containers={};
 for(const [name,min,max,step,defaultValue]of [['minutes',0,14400,'any',30],['periods',1,100,1,5],['seconds',0.001,3600,'any',30],['increment',0.001,3600,'any',10]]){
  const input=document.createElement('input');input.type='number';input.name='time'+name;input.min=min;input.max=max;input.step=step;input.value=defaultValue;containers[name]=field(name,input);
 }
 const preview=document.createElement('p');preview.className='time-control-preview';box.append(preview);form.insertBefore(box,form.querySelector('#edit-error'));
 let imported=null,disabled=false;
 const value=()=>timeControlValue({type:select.value,minutes:inputs.minutes.value,periods:inputs.periods.value,seconds:inputs.seconds.value,increment:inputs.increment.value,overtime:imported?.overtime});
 function render(){
  legend.textContent=t('用时设置','Time control');
  const words={type:['用时方式','Format'],minutes:['每方基本用时（分钟）','Main time per player (min)'],periods:['读秒次数','Byo-yomi periods'],seconds:['每次读秒（秒）','Seconds per period'],increment:['每手增加（秒）','Seconds added per move']};
  for(const [name,[zh,en]]of Object.entries(words)){labels[name].textContent=t(zh,en);inputs[name].setAttribute('aria-label',t(zh,en));}
  const options=[['未设置','Not specified'],['绝对用时','Absolute time'],['日式读秒','Japanese byo-yomi'],['费舍尔加秒','Fischer']];
  [...select.options].slice(0,4).forEach((option,i)=>option.textContent=t(...options[i]));
  const custom=select.querySelector('[value="imported"]');if(custom)custom.textContent=imported.overtime;
  select.disabled=disabled;
  for(const name of Object.keys(containers)){
   const shown=name==='minutes'?Boolean(select.value):name==='increment'?select.value==='fischer':select.value==='byoyomi';
   containers[name].hidden=!shown;inputs[name].disabled=!shown||disabled;inputs[name].required=shown;
  }
  try{preview.textContent=timeControlSummary(value(),t);}catch{preview.textContent='';}preview.hidden=!preview.textContent;
 }
 grid.addEventListener('change',render);
 return {value,render,disable(value){disabled=value;render();},fill(value){
  const f=timeControlFields(value);imported=f.type==='imported'?value:null;
  select.querySelector('[value="imported"]')?.remove();
  if(imported){const option=document.createElement('option');option.value='imported';select.append(option);}
  select.value=f.type;for(const name of Object.keys(containers))if(f[name]!==undefined)inputs[name].value=f[name];render();
 }};
}
