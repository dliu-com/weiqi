const finite=value=>Number.isFinite(value)&&value>=0;
export function comparisonLayout(rows,fixedMaximum){
 const values=rows.flatMap(row=>row.values).filter(finite),maximum=Math.max(0,...values);
 const power=10**Math.floor(Math.log10(maximum||1)),unit=maximum/power;
 const extent=fixedMaximum??(maximum?(unit<=1?1:unit<=2?2:unit<=5?5:10)*power:1);
 if(!Number.isFinite(extent)||extent<=0)throw Error('Chart maximum must be positive.');
 return {extent,rows:rows.map(row=>({...row,values:row.values.map(value=>finite(value)?value:null),fractions:row.values.map(value=>finite(value)?Math.min(1,value/extent):null)}))};
}
export function compositionLayout(groups,keys){
 return groups.map(group=>{
  const total=keys.reduce((sum,key)=>sum+(finite(group.counts[key])?group.counts[key]:0),0);let offset=0;
  return {...group,total,segments:keys.map(key=>{const count=finite(group.counts[key])?group.counts[key]:0,fraction=total?count/total:0,result={key,count,fraction,offset};offset+=fraction;return result;})};
 });
}
const ns='http://www.w3.org/2000/svg';
const element=(tag,attrs={},text)=>{const e=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);if(text!==undefined)e.textContent=text;return e;};
export const reportChartColours={black:'#28323a',white:'#f9fafb',grid:'#a0adb5',axis:'#687984',ink:'#23343d',line:'#435466'};
function canvas(label,height){const svg=element('svg',{viewBox:'0 0 640 '+height,role:'img','aria-label':label,'data-stat-graph':'true',class:'report-plot'});svg.append(element('title',{},label));return svg;}
const colours={B:reportChartColours.black,W:reportChartColours.white},qualityColours={best:'#176b5b',good:'#9bc7ac',inaccuracy:'#d5ae4c',mistake:'#d17836',blunder:'#a83d34'};
const formatted=(value,digits,suffix)=>Number.isFinite(value)?value.toFixed(digits)+suffix:'—';
export function comparisonChart(label,rows,{names,digits=1,suffix='',maximum,axisLabel=''}={}){
 const layout=comparisonLayout(rows,maximum),top=64,step=80,left=205,right=554,height=top+rows.length*step+62,svg=canvas(label,height);
 for(const [i,side] of ['B','W'].entries()){svg.append(element('rect',{x:190+i*150,y:9,width:16,height:16,fill:colours[side],stroke:reportChartColours.line,'stroke-width':1,rx:2}),element('text',{x:214+i*150,y:23,'font-size':19,fill:reportChartColours.ink},names[side]));}
 for(const tick of [0,layout.extent/2,layout.extent]){const x=left+tick/layout.extent*(right-left);svg.append(element('line',{x1:x,x2:x,y1:top-8,y2:height-60,stroke:tick===0?reportChartColours.axis:reportChartColours.grid,'stroke-width':1}),element('text',{x,y:height-37,'text-anchor':'middle','font-size':18,fill:reportChartColours.ink},formatted(tick,digits,suffix)));}
 layout.rows.forEach((row,index)=>{
  const y=top+index*step;svg.append(element('text',{x:4,y:y+19,'font-size':17,fill:'#26343d'},row.label));
  row.values.forEach((value,column)=>{const side=column===0?'B':'W',barY=y+column*25,width=(row.fractions[column]??0)*(right-left);
   if(value!==null){const bar=element('rect',{x:left,y:barY,width,height:17,rx:2,fill:colours[side],stroke:reportChartColours.line,'stroke-width':.8,'data-side':side,'data-value':value,'data-key':row.key??row.label});bar.append(element('title',{},names[side]+' · '+row.label+': '+formatted(value,digits,suffix)));svg.append(bar);}
   svg.append(element('text',{x:value===null?left+8:Math.min(left+width+8,576),y:barY+14,'font-size':18,fill:'#26343d'},formatted(value,digits,suffix)));
  });
 });
 if(axisLabel)svg.append(element('text',{x:(left+right)/2,y:height-10,'text-anchor':'middle','font-size':17,fill:reportChartColours.ink},axisLabel));
 return svg;
}
export function compositionChart(label,groups,{keys,names,emptyLabel}={}){
 const layout=compositionLayout(groups,keys),top=52,step=78,left=170,width=430,height=top+groups.length*step+34,svg=canvas(label,height);
 for(const tick of [0,25,50,75,100]){const x=left+tick/100*width;svg.append(element('line',{x1:x,x2:x,y1:top-12,y2:height-60,stroke:tick===0?reportChartColours.axis:reportChartColours.grid}),element('text',{x,y:height-8,'text-anchor':'middle','font-size':18,fill:reportChartColours.ink},tick+'%'));}
 layout.forEach((group,index)=>{const y=top+index*step;svg.append(element('text',{x:4,y:y+14,'font-size':19,fill:'#26343d'},group.label),element('text',{x:4,y:y+36,'font-size':15,fill:reportChartColours.ink},'N = '+group.total));
  if(!group.total){svg.append(element('text',{x:left,y:y+22,'font-size':18,fill:'#56626a'},emptyLabel));return;}
  for(const segment of group.segments){if(!segment.count)continue;const rect=element('rect',{x:left+segment.offset*width,y,width:segment.fraction*width,height:32,fill:qualityColours[segment.key],'data-quality':segment.key,'data-count':segment.count});rect.append(element('title',{},group.label+' · '+names[segment.key]+': '+segment.count+' ('+(segment.fraction*100).toFixed(1)+'%)'));svg.append(rect);
   if(segment.fraction>=.12)svg.append(element('text',{x:left+(segment.offset+segment.fraction/2)*width,y:y+22,'text-anchor':'middle','font-size':18,fill:['best','blunder'].includes(segment.key)?'white':'#202629'},Math.round(segment.fraction*100)+'%'));
  }
 });
 return svg;
}
export function qualityLegend(names,thresholds={}){const legend=document.createElement('div');legend.className='report-quality-legend';for(const [key,name] of Object.entries(names)){const item=document.createElement('span'),swatch=document.createElement('i');swatch.style.backgroundColor=qualityColours[key];swatch.setAttribute('aria-hidden','true');item.append(swatch,document.createTextNode(name+(thresholds[key]?' · '+thresholds[key]:'')));legend.append(item);}return legend;}
