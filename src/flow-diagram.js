// Small DOM/SVG diagram kit for the About, User guide and Security pages. Callers pass already translated text.
const NS='http://www.w3.org/2000/svg';
const ICONS={
 browser:['#4b6575',[['rect',{x:3,y:4.5,width:18,height:15,rx:2}],['path',{d:'M3 9h18'}],['circle',{cx:6,cy:6.8,r:.6,fill:'#fff'}],['circle',{cx:8.3,cy:6.8,r:.6,fill:'#fff'}]]],
 phone:['#4b6575',[['rect',{x:7,y:2.5,width:10,height:19,rx:2}],['path',{d:'M10.5 18.5h3'}]]],
 cloudfront:['#8c4fff',[['circle',{cx:12,cy:12,r:8.5}],['ellipse',{cx:12,cy:12,rx:3.6,ry:8.5}],['path',{d:'M3.5 12h17M5 7.5h14M5 16.5h14'}]]],
 lambda:['#ed7100',[['path',{d:'M6.5 4h3.5l8 16'}],['path',{d:'M12.3 10.6 6.5 20'}]]],
 s3:['#7aa116',[['ellipse',{cx:12,cy:6,rx:8,ry:2.6}],['path',{d:'M4 6l1.9 12.6c.3 1.6 2.9 2.6 6.1 2.6s5.8-1 6.1-2.6L20 6'}]]],
 dynamodb:['#3b48cc',[['ellipse',{cx:12,cy:5.8,rx:7,ry:2.5}],['path',{d:'M5 5.8v12.4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5.8M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5'}]]],
 sqs:['#e7157b',[['rect',{x:2.5,y:7,width:5,height:10,rx:1}],['rect',{x:9.5,y:7,width:5,height:10,rx:1}],['path',{d:'M16.5 12h5M19 9.5l2.5 2.5-2.5 2.5'}]]],
 gpu:['#d45b07',[['rect',{x:6,y:6,width:12,height:12,rx:1.5}],['rect',{x:9.3,y:9.3,width:5.4,height:5.4}],['path',{d:'M9 2.5V6M12 2.5V6M15 2.5V6M9 18v3.5M12 18v3.5M15 18v3.5M2.5 9H6M2.5 12H6M2.5 15H6M18 9h3.5M18 12h3.5M18 15h3.5'}]]],
 katago:['#24292e',[['path',{d:'M4 7h16M4 12h16M4 17h16M7 4v16M12 4v16M17 4v16'}],['circle',{cx:12,cy:12,r:3.3,fill:'#fff',stroke:'none'}],['circle',{cx:7,cy:7,r:2.4,fill:'#24292e',stroke:'#fff'}]]],
 camera:['#01a88d',[['rect',{x:2.5,y:7,width:19,height:13,rx:2}],['path',{d:'M8 7l1.6-3h4.8L16 7'}],['circle',{cx:12,cy:13.5,r:3.6}]]],
 report:['#b3462e',[['path',{d:'M6 2.5h8.5l4 4V21.5H6z'}],['path',{d:'M14.5 2.5v4h4M9 11h6.5M9 14.5h6.5M9 18h4'}]]],
 shield:['#dd344c',[['path',{d:'M12 2.8l7.5 3v5.4c0 4.8-3.2 8.7-7.5 10.1-4.3-1.4-7.5-5.3-7.5-10.1V5.8z'}],['path',{d:'M8.8 12.2l2.2 2.2 4.3-4.6'}]]],
 lock:['#dd344c',[['rect',{x:4.5,y:10.5,width:15,height:10.5,rx:2}],['path',{d:'M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.5v3'}]]],
 user:['#4b6575',[['circle',{cx:12,cy:8,r:3.8}],['path',{d:'M4.5 20.5c.9-4.2 4-6.6 7.5-6.6s6.6 2.4 7.5 6.6'}]]],
 bot:['#7b2d2d',[['rect',{x:4.5,y:8,width:15,height:11.5,rx:3}],['path',{d:'M12 8V4.5M9.5 16h5'}],['circle',{cx:9.2,cy:12.3,r:1.2,fill:'#fff'}],['circle',{cx:14.8,cy:12.3,r:1.2,fill:'#fff'}]]],
 record:['#805719',[['path',{d:'M4 20l1.2-4.6L15.8 4.8l3.4 3.4L8.6 18.8z'}],['path',{d:'M13.6 7l3.4 3.4'}]]],
 play:['#805719',[['circle',{cx:8.8,cy:12,r:5.6,fill:'#fff',stroke:'none'}],['circle',{cx:15.4,cy:12,r:5.6}]]],
 library:['#805719',[['path',{d:'M4 4h4v16H4zM10 4h4v16h-4zM15.6 5.4l3.8-1 3.1 14.5-3.8 1z'}]]],
 chart:['#147cab',[['path',{d:'M4 4v16h16'}],['path',{d:'M7 15l4-5 3 3 5.5-7'}]]],
 check:['#2e8540',[['circle',{cx:12,cy:12,r:8.5}],['path',{d:'M8 12.3l2.7 2.7L16 9.6'}]]],
 flag:['#b07d12',[['path',{d:'M6 21V3.5M6 4.5h11l-2.5 4 2.5 4H6'}]]],
 clock:['#147cab',[['circle',{cx:12,cy:12,r:8.5}],['path',{d:'M12 7.5V12l3.2 2'}]]],
 retry:['#147cab',[['path',{d:'M19.5 12a7.5 7.5 0 1 1-2.2-5.3'}],['path',{d:'M19.8 3.8v4.6h-4.6'}]]],
 power:['#2e8540',[['path',{d:'M12 3v8.5'}],['path',{d:'M7.2 6.6a7.5 7.5 0 1 0 9.6 0'}]]],
 budget:['#2e8540',[['circle',{cx:12,cy:12,r:8.5}],['path',{d:'M14.8 8.6c-.5-1.1-1.6-1.7-2.9-1.7-1.6 0-2.8.9-2.8 2.1 0 2.9 5.9 1.6 5.9 4.7 0 1.3-1.3 2.3-3 2.3-1.4 0-2.6-.6-3.1-1.8M12 5v1.9M12 16v2.9'}]]],
 stack:['#e7157b',[['path',{d:'M12 3.5l8.5 4.5-8.5 4.5L3.5 8z'}],['path',{d:'M3.5 12.3l8.5 4.5 8.5-4.5M3.5 16.3l8.5 4.5 8.5-4.5'}]]],
 filter:['#8c4fff',[['path',{d:'M3.5 5h17l-6.5 8v6l-4 2v-8z'}]]],
 gauge:['#dd344c',[['path',{d:'M3.8 17a8.5 8.5 0 1 1 16.4 0'}],['path',{d:'M12 15.5l4.2-5'}],['circle',{cx:12,cy:15.5,r:1.3,fill:'#fff'}]]],
 eye:['#147cab',[['path',{d:'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'}],['circle',{cx:12,cy:12,r:3}]]],
 sgf:['#4b6575',[['path',{d:'M6 2.5h8.5l4 4V21.5H6z'}],['path',{d:'M14.5 2.5v4h4'}],['circle',{cx:10,cy:13,r:1.8,fill:'#fff',stroke:'none'}],['circle',{cx:14,cy:17,r:1.8}]]],
 users:['#805719',[['circle',{cx:9,cy:8.5,r:3.2}],['path',{d:'M2.8 19.5c.6-3.5 3.2-5.5 6.2-5.5s5.6 2 6.2 5.5'}],['circle',{cx:16.6,cy:9,r:2.6}],['path',{d:'M16.4 14.2c2.5.1 4.3 1.9 4.9 4.8'}]]],
 branch:['#147cab',[['path',{d:'M6 6.2v11.6M6 9.5c0 5.5 11 1.5 11 8.3'}],['circle',{cx:6,cy:4.3,r:1.9}],['circle',{cx:6,cy:19.7,r:1.9}],['circle',{cx:17,cy:19.7,r:1.9}]]],
 setup:['#4b6575',[['path',{d:'M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16'}],['circle',{cx:9.3,cy:9.3,r:2,fill:'#fff',stroke:'none'}]]]
};
const svgNode=(tag,attrs)=>{const node=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;};
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};

export function icon(name,size=''){
 const [colour,parts]=ICONS[name]??ICONS.browser,box=el('span','dg-icon'+(size?' dg-icon-'+size:''));
 box.style.setProperty('--dg',colour);box.setAttribute('aria-hidden','true');
 const svg=svgNode('svg',{viewBox:'0 0 24 24',focusable:'false'});for(const [tag,attrs]of parts)svg.append(svgNode(tag,attrs));
 box.append(svg);return box;
}
function arrow(){const span=el('span','dg-arrow'),svg=svgNode('svg',{viewBox:'0 0 24 24','aria-hidden':'true'});svg.append(svgNode('path',{d:'M4 12h15M13 6l6 6-6 6'}));span.append(svg);return span;}
function card(step,className,number){
 const node=el(step.href?'a':'div',className);if(step.href)node.href=step.href;
 if(number!=null)node.append(el('span','dg-num',String(number)));
 if(step.icon)node.append(icon(step.icon));
 const text=el('span','dg-text');text.append(el('strong','',step.title));if(step.text)text.append(el('small','',step.text));node.append(text);return node;
}
function frame(title,className){const figure=el('figure','dg'+(className?' '+className:''));if(title)figure.append(el('figcaption','',title));return figure;}
function note(figure,text){if(text)figure.append(el('p','dg-note',text));return figure;}

export function flow({title,steps,note:noteText,numbered=false,className=''}){
 const figure=frame(title,className),list=el('div','dg-flow');list.setAttribute('role','list');
 steps.forEach((step,index)=>{if(index)list.append(arrow());const item=card(step,'dg-step'+(step.tone?' dg-'+step.tone:''),numbered?index+1:null);item.setAttribute('role','listitem');list.append(item);});
 figure.append(list);return note(figure,noteText);
}

export function tiers({title,rows,note:noteText,className=''}){
 const figure=frame(title,'dg-tiers'+(className?' '+className:''));
 rows.forEach((row,index)=>{
  if(index&&row.link!==null){const link=el('div','dg-link');link.append(arrow());if(row.link)link.append(el('span','',row.link));figure.append(link);}
  const tier=el('div','dg-tier'+(row.tone?' dg-'+row.tone:'')),label=el('div','dg-tier-label');
  if(row.badge)label.append(el('span','dg-badge',row.badge));label.append(el('strong','',row.label));tier.append(label);
  const nodes=el('div','dg-tier-nodes');for(const node of row.nodes)nodes.append(card(node,'dg-node'));tier.append(nodes);figure.append(tier);
 });
 return note(figure,noteText);
}

export function lanes({title,lanes:items,note:noteText}){
 const figure=frame(title,'dg-lanes-frame'),grid=el('div','dg-lanes');
 for(const lane of items){
  const column=el('div','dg-lane'),head=el(lane.href?'a':'div','dg-lane-head');if(lane.href)head.href=lane.href;head.append(icon(lane.icon,'large'),el('strong','',lane.title));column.append(head);
  lane.steps.forEach((step,index)=>{if(index)column.append(el('span','dg-down','↓'));column.append(card(typeof step==='string'?{title:step}:step,'dg-lane-step'+(step.tone?' dg-'+step.tone:''),index+1));});
  grid.append(column);
 }
 figure.append(grid);return note(figure,noteText);
}

export function stats(items){const grid=el('div','dg-stats');for(const [value,label,name]of items){const box=el('div','dg-stat');if(name)box.append(icon(name));const text=el('span','dg-text');text.append(el('strong','',value),el('small','',label));box.append(text);grid.append(box);}return grid;}

export function callout(name,text){const box=el('p','dg-callout');box.append(icon(name),el('span','',text));return box;}

export function more(summary,content){const details=el('details','dg-more'),title=el('summary','',summary);details.append(title,content);return details;}

export function svg(attrs,children){const root=svgNode('svg',attrs);for(const [tag,a,text]of children){const node=svgNode(tag,a);if(text!=null)node.textContent=text;root.append(node);}return root;}
