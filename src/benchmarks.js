import './site-shell.js';
import {t} from './i18n.js';
// Only the runs that justify the production settings are shown; all runs stay in benchmarks-data.json.
const KEEP=[
 'a5590997-a435-4733-abdc-0c712bd32094', // CPU · 128 visits
 '9dc792e6-2b66-4425-bb77-4c8b2b4da395', // T4 · 128
 '15aac951-6001-472e-a7b0-00cdd93867dc', // A10G · 128
 '573ab4a1-5fa9-45fa-8478-d7f2ef493fdc', // A10G · 1,000
 '346fb502-fbaf-47bd-9696-6d2fb86bdff7', // T4 · 1,000 (fastest)
 '084f515a-7681-43dc-bbd8-b795dd2d22bd-deep', // T4 · 1,000 (slowest)
 'a6bbaa61-3e2d-4f0a-8fd7-bd6a51150fbe-quick', // T4 · 32
 'a6bbaa61-3e2d-4f0a-8fd7-bd6a51150fbe-deep', // T4 · 3,000
 '08f5cea6-45d6-4861-b557-54b6a45684e5-deep' // T4 · 5,000
];
const HOUR=3600;
let data=null,failed=false,scrolled=false;
const $=id=>document.getElementById(id);
const num=n=>n.toLocaleString('en-US');
const usd=x=>Number.isFinite(x)?'US$'+x.toFixed(2):'—';
const exact=s=>{if(!Number.isFinite(s))return '—';if(s<10)return s.toFixed(1)+t(' 秒',' s');const n=Math.round(s),m=Math.floor(n/60);return (m?m+t(' 分 ',' min '):'')+n%60+t(' 秒',' s');};
// Under 10 minutes round to the nearest half minute, otherwise to the nearest minute.
const roundMin=s=>{const m=s/60;return m<10?Math.round(m*2)/2:Math.round(m);};
const mins=(...seconds)=>{const v=[...new Set(seconds.map(roundMin))].sort((a,b)=>a-b);return (v.length>1?v[0]+'–'+v.at(-1):v[0])+t(' 分钟',' min');};
const kind=r=>r.backend==='fargate-cpu'?'CPU':r.gpu;
const hardware=r=>r.backend==='fargate-cpu'?t(`CPU · Fargate ${r.cpu} vCPU · ${r.memoryGB} GB`,`CPU · Fargate ${r.cpu} vCPUs · ${r.memoryGB} GB`):`${r.gpu} · ${r.instanceType}`;
const startup=r=>(r.instanceStartupSeconds||0)+(r.startupSeconds||0)+(r.setupSeconds||0);
// A deep pass with a quick sibling ran on the same GPU after it, so its time and cost include the quick pass.
const shared=r=>r.id.endsWith('-deep')&&data.experiments.some(o=>o.id===r.id.replace(/-deep$/,'-quick'));
const sharedNote=rows=>rows.some(shared)?note(t('* 与一次 32 次访问的快速分析共用同一台 GPU；时间和费用包含该快速分析。','* Shared one GPU with a 32-visit quick pass; time and cost include that pass.')):null;
function el(tag,text,className){const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;}
const note=text=>el('p',text,'bench-note');
function section(id,title,...nodes){const s=el('section');s.id=id;s.append(el('h2',title),...nodes.filter(Boolean));return s;}
function table(head,rows,className){
 const wrap=el('div',null,'document-table'),tbl=el('table',null,className),thead=el('thead'),top=el('tr'),tbody=el('tbody');
 for(const h of head)top.append(el('th',h));thead.append(top);
 for(const row of rows){
  const tr=el('tr');if(row.id)tr.id=row.id;
  for(const c of row.cells){const v=c&&typeof c==='object'?c:{text:c},td=el('td',v.href?null:v.text,v.num?'num':null);if(v.href){const a=el('a',v.text);a.href=v.href;td.append(a);}if(v.span)td.colSpan=v.span;tr.append(td);}
  tbody.append(tr);
 }
 tbl.append(thead,tbody);wrap.append(tbl);return wrap;
}
function render(){
 document.title=t('基准实验 · DL','Benchmarks · DL');$('benchmark-title').textContent=t('分析基准实验','Analysis benchmarks');
 if(!data){$('benchmark-intro').textContent=failed?t('无法加载基准数据。','Unable to load benchmarks.'):t('正在加载…','Loading…');return;}
 const runs=KEEP.map(id=>data.experiments.find(r=>r.id===id));
 if(runs.some(r=>!r)){$('benchmark-intro').textContent=t('部分基准数据缺失。','Some benchmark runs are missing.');$('benchmark-results').replaceChildren();return;}
 const pick=(k,visits)=>runs.filter(r=>kind(r)===k&&r.visits===visits).sort((a,b)=>a.totalSeconds-b.totalSeconds);
 const [cpu]=pick('CPU',128),[t4]=pick('T4',128),[a10]=pick('A10G',128),[a10k]=pick('A10G',1000),t4k=pick('T4',1000),[quick]=pick('T4',32),[deep]=pick('T4',3000),[deep5k]=pick('T4',5000);
 const q=data.quality,[first]=runs,points=q.meanAbsolutePointDifference.toFixed(2),winrate=q.meanAbsoluteWinratePercentagePointDifference.toFixed(2);
 const model=first.model.replace(/-s\d+M-d\d+M\.bin\.gz$/,''),engine=(runs.find(r=>r.engineVersion)?.engineVersion||'').replace(' v',' ');
 const run=(r,text=hardware(r))=>({text:text+(shared(r)?' *':''),href:'#run-'+r.id});
 const time=r=>({text:exact(r.totalSeconds),num:true}),cost=r=>({text:usd(r.costUSD),num:true});
 $('benchmark-intro').textContent=t(`以下测试都分析同一盘 ${first.moves} 手棋谱（${first.positions} 个局面），在 AWS 爱尔兰区域运行。时间包含启动和保存，不含排队。`,`Every run below analyses the same ${first.moves}-move game (${first.positions} positions) in AWS Ireland. Times include start-up and saving, not queue waiting.`);
 const settings=table([t('设置','Setting'),t('选择','Choice'),t('依据','Evidence')],[
  {cells:[{text:t('硬件','Hardware'),href:'#bench-hardware'},'GPU',t(`${num(cpu.visits)} 次访问时：CPU（Fargate）${mins(cpu.totalSeconds)}，${usd(cpu.costUSD)}；T4 ${mins(t4.totalSeconds)}，${usd(t4.costUSD)}。`,`CPU (Fargate) at ${num(cpu.visits)} visits: ${mins(cpu.totalSeconds)}, ${usd(cpu.costUSD)}. T4: ${mins(t4.totalSeconds)}, ${usd(t4.costUSD)}.`)]},
  {cells:[{text:t('GPU 顺序','GPU order'),href:'#bench-gpu'},t('深度：先 A10G，再 T4；快速：T4','Deep: A10G first, then T4. Quick: T4'),t(`${num(a10k.visits)} 次访问时：A10G ${mins(a10k.totalSeconds)}，T4 ${mins(...t4k.map(r=>r.totalSeconds))}。爱尔兰的 A10G 经常没有空闲。`,`At ${num(a10k.visits)} visits: A10G ${mins(a10k.totalSeconds)} vs T4 ${mins(...t4k.map(r=>r.totalSeconds))}. A10G is often unavailable in Ireland.`)]},
  {cells:[{text:t('快速分析','Quick'),href:'#bench-quality'},t(`${num(quick.visits)} 次访问`,`${num(quick.visits)} visits`),t(`T4 上 ${exact(quick.totalSeconds)}（目标 ≤ 5 分钟）。与 ${num(q.referenceVisits)} 次访问平均相差 ${points} 目。`,`${exact(quick.totalSeconds)} on T4 (target ≤ 5 min). Average difference from ${num(q.referenceVisits)} visits: ${points} points.`)]},
  {cells:[{text:t('深度分析','Deep'),href:'#bench-deep'},t(`${num(deep.visits)} 次访问`,`${num(deep.visits)} visits`),t(`T4 上 ${mins(deep.totalSeconds)}（目标 ≤ 1 小时，最多 2 小时）。${num(deep5k.visits)} 次访问用了 ${mins(deep5k.totalSeconds)}，超过 1 小时目标。结果与 12,000 次访问接近。`,`${mins(deep.totalSeconds)} on T4 (target ≤ 1 hour, 2 hours at most). ${num(deep5k.visits)} visits took ${mins(deep5k.totalSeconds)}, over the 1-hour target. Close to 12,000 visits.`)]},
  {cells:[t('模型','Model'),`${model} · ${engine}`,t('评分可靠的最强官方模型；以下测试都使用它。','Strongest confidently-rated official model; used in every run below.')]}
 ],'bench-settings');
 const gpuRows=[a10k,...t4k],deepRows=[deep,deep5k],ordered=[...runs].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.visits-b.visits);
 const fragment=document.createDocumentFragment();
 fragment.append(
  section('bench-settings',t('选定配置','Chosen settings'),settings),
  section('bench-hardware',t(`GPU 与 CPU · ${num(cpu.visits)} 次访问`,`GPU vs CPU · ${num(cpu.visits)} visits`),table([t('硬件','Hardware'),t('总时间','Total time'),t('费用','Cost')],[cpu,t4,a10].map(r=>({cells:[run(r),time(r),cost(r)]})))),
  section('bench-gpu',t(`A10G 与 T4 · ${num(a10k.visits)} 次访问`,`A10G vs T4 · ${num(a10k.visits)} visits`),table([t('硬件','Hardware'),t('机器','Machine'),t('总时间','Total time'),t('费用','Cost')],gpuRows.map(r=>({cells:[run(r),r.coldStart?t('冷启动','Cold start'):t('已在运行','Already running'),time(r),cost(r)]}))),sharedNote(gpuRows),note(t('2026-10-08 AWS 对爱尔兰 A10G 空闲容量的评分为 1 / 10（T4 为 8 / 10）。目前 3 次 A10G 请求中，1 次在 3 分钟内启动，另 2 次等了 15–18 分钟。','On 2026-10-08, AWS rated spare A10G capacity in Ireland 1 out of 10 (T4: 8 out of 10). Of our three A10G requests so far, one started within three minutes; the other two waited 15–18 minutes.'))),
  section('bench-deep',t('T4 深度分析访问次数','Deep visits on T4'),table([t('访问次数','Visits'),t('总时间','Total time'),t('1 小时目标','1-hour target'),t('费用','Cost')],deepRows.map(r=>({cells:[run(r,num(r.visits)),time(r),r.totalSeconds<=HOUR?t('达标','Within'):t(`超出 ${mins(r.totalSeconds-HOUR)}`,`Over by ${mins(r.totalSeconds-HOUR)}`),cost(r)]}))),sharedNote(deepRows)),
  section('bench-quality',t('分析质量','Quality'),
   table([t('比较','Comparison'),t('棋谱','Game'),t('结果','Result')],[
    {cells:[t(`快速 ${num(q.quickVisits)} 与 ${num(q.referenceVisits)} 次访问`,`Quick ${num(q.quickVisits)} vs ${num(q.referenceVisits)} visits`),t(`${first.moves} 手 · ${q.positions} 个局面`,`${first.moves} moves · ${q.positions} positions`),t(`平均相差 ${points} 目；胜率平均相差 ${winrate} 个百分点`,`Average difference ${points} points; win rate ${winrate} percentage points`)]},
    {cells:[t('3,000 与 12,000 次访问','3,000 vs 12,000 visits'),t('一盘 304 手棋谱','One 304-move game'),t('AI 首选相同 79%；领先目数平均相差 0.16 目；胜率相差 0.8%','Same top move 79%; average lead difference 0.16 points; win-rate difference 0.8%')]}
   ]),
   el('h3',t('与 30,000 次访问参考结果比较（两盘棋，80 个局面）','Against a 30,000-visit reference (80 positions from two games)')),
   table([t('指标','Measure'),'2,500','5,000','10,000'],[
    {cells:[t('着法评级相同','Same move grade'),...['76%','78%','86%'].map(text=>({text,num:true}))]},
    {cells:[t('AI 首选相同','Same top move'),...['79%','80%','85%'].map(text=>({text,num:true}))]},
    {cells:[t('损失目数误差','Point-loss error'),...['0.25','0.18','0.12'].map(text=>({text,num:true}))]},
    {cells:[t('失误标记一致','Mistake flags agree'),{text:t('三档均为 96–97%','96–97% at all three'),span:3}]}
   ]),
   note(t('这是结果一致性比较，不是独立的准确度验证。','This measures agreement, not independently verified accuracy.'))),
  section('bench-runs',t('测试记录','Test runs'),table([t('日期','Date'),t('硬件','Hardware'),t('访问次数','Visits'),t('启动','Start-up'),t('引擎','Engine'),t('总计','Total'),t('费用','Cost')],ordered.map(r=>({id:'run-'+r.id,cells:[r.createdAt.slice(0,10),hardware(r)+(shared(r)?' *':''),{text:num(r.visits),num:true},{text:exact(startup(r)),num:true},{text:exact(r.engineSeconds),num:true},time(r),cost(r)]})),'bench-runs'),sharedNote(ordered),note(t('启动包括机器启动、容器启动和准备。','Start-up covers machine start, container start and setup.')))
 );
 $('benchmark-results').replaceChildren(fragment);
 if(!scrolled&&location.hash){scrolled=true;document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();}
}
window.addEventListener('site-language-change',render);render();
try{const response=await fetch('benchmarks-data.json',{cache:'no-cache'});if(!response.ok)throw Error('Unable to load benchmarks.');data=await response.json();}catch{failed=true;}
render();
