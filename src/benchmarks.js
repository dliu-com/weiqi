import {t,setLanguage} from './i18n.js';
let data=null,filter='all';
const $=id=>document.getElementById(id);
const duration=n=>Number.isFinite(n)?(n<10?n.toFixed(1)+' s':Math.floor(Math.round(n)/60)+'m '+String(Math.round(n)%60).padStart(2,'0')+'s'):'—';
function status(r){const s=(r.status||'').toUpperCase();return s==='SUCCEEDED'||s==='COMPLETE'?'complete':s==='FAILED'?'failed':'running';}
function render(){
 document.title=t('基准实验 · DL','Benchmarks · DL');$('benchmark-title').textContent=t('分析基准实验','Analysis benchmarks');
 $('benchmark-intro').textContent=t('显示已完成及进行中的实验，包括较早的 CPU 测试。请比较相同棋谱、模型及访问次数；样本测试不能代表整盘棋。','Completed and ongoing experiments, including earlier CPU tests. Compare the same game, model and visit count; short samples do not represent a full game.');
 $('benchmark-method').textContent=t('总时间包含排队与等待容量、调用、实例启动（冷启动时）、容器启动、准备、分析和保存。处理时间不含排队。单项基准实验从提交作业计时；正式棋局从分析进入 SQS 计时。下载镜像属于容器启动时间，不重复相加。费用为美元估算，CPU 包含计算和公共 IP；GPU 包含运行期间的计算、IP 和存储估算，空闲及关闭费用另计。未测得的数据以 — 表示。','Total time includes queue/capacity waiting, trigger, cold instance startup, container startup, setup, analysis and saving. Processing time excludes queue waiting. Individual benchmarks start at job submission; production games start when analysis is queued in SQS. Image pull is part of container startup. USD cost estimates include compute and public IP for CPU; GPU estimates also include a storage allowance. GPU idle/shutdown costs are separate. Unmeasured values appear as —.');
 $('benchmark-goals').textContent=t('目标（含排队与准备）：快速分析 ≤ 5 分钟；深度分析目标 ≤ 1 小时，最多 2 小时；每盘两次分析合计 < $1。开发及调试总预算 $30。','Targets including queue and setup: quick ≤ 5 minutes; deep target ≤ 1 hour, maximum 2 hours; combined analysis < $1 per game. Total development/debugging budget: $30.');
 for(const b of document.querySelectorAll('[data-filter]')){b.textContent=t(...({all:['全部','All'],complete:['完成','Completed'],running:['进行中','In progress'],failed:['失败 / 停止','Failed / stopped']}[b.dataset.filter]));b.setAttribute('aria-pressed',String(filter===b.dataset.filter));}
 if(!data)return;
 $('benchmark-updated').textContent=t('更新于：','Updated: ')+new Date(data.updatedAt).toLocaleString(document.documentElement.lang==='zh-CN'?'zh-CN':'en-GB',{dateStyle:'medium',timeStyle:'long'})+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone+' · '+t('区域：爱尔兰','Region: Ireland');
 const list=data.experiments.filter(r=>!['FAILED','STOPPED','CANCELLED','CANCELED','TERMINATED'].includes((r.status||'').toUpperCase())).filter(r=>filter==='all'||status(r)===filter).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
 $('benchmark-count').textContent=list.length+t(' 项实验',' experiments');const fragment=document.createDocumentFragment();
 for(const r of list){
  const article=document.createElement('article');article.className='benchmark-experiment';
  const h=document.createElement('h2');h.textContent=(r.gpu?'NVIDIA '+r.gpu+' · ':'')+(r.cpu?r.cpu+' vCPUs · ':'')+r.memoryGB.toFixed(1).replace('.0','')+' GB RAM'+(r.backend==='lambda-cpu'?' · Lambda':r.backend==='gpu'?' · '+r.instanceType:' · Fargate');
  const context=document.createElement('p');context.className='benchmark-context';const network=r.model?.match(/b(\d+)c(\d+)/);context.textContent=[r.moves+t(' 手棋谱',' game moves'),(r.positions??(r.moves+1))+t(' 个局面',' positions')+(status(r)!=='complete'?t('（计划）',' (planned)'):''),network?network.slice(1).join(' × ')+t(' 网络',' network'):r.model,r.visits+t(' 次访问 / 局面',' visits / position'),r.analysisThreads?r.analysisThreads+t(' 并行局面',' parallel positions'):'',r.maxBatchSize?'NN batch '+r.maxBatchSize:'',r.engineVersion,r.coldStart===true?t('冷启动','Cold launch'):r.coldStart===false?t('复用已启动实例','Warm instance reused'):''].filter(Boolean).join(' · ');
  const state=document.createElement('span');state.className='benchmark-status benchmark-status-'+status(r);state.textContent=t(...({complete:['完成','Completed'],running:['进行中','In progress'],failed:['失败 / 停止','Failed / stopped']}[status(r)]));
  const metrics=document.createElement('dl');metrics.className='benchmark-metrics';
  for(const [label,value] of [[t('总时间（含排队与准备）','Total including queue and setup'),duration(r.totalIncludingQueueSeconds)],[t('处理时间（不含排队）','Processing excluding queue'),duration(r.totalSeconds)],[t('KataGo 分析','KataGo analysis'),duration(r.engineSeconds)],[t('估算费用','Estimated cost'),Number.isFinite(r.costUSD)?r.costUSD>0&&r.costUSD<.0001?'< $0.0001':'$'+r.costUSD.toFixed(r.costUSD<.01?4:2):'—']]){const group=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;group.append(dt,dd);metrics.append(group);}
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=t('各阶段耗时与实验信息','Stage timings and experiment details');details.append(summary);
  const timings=document.createElement('dl');timings.className='benchmark-stages';
  for(const [label,value] of [[t('排队 / 等待容量（计入总时间）','Queue / capacity wait (included in total)'),r.queueWaitSeconds],[t('调用 / 提交','Trigger / submit'),r.triggerSeconds],[t('实例启动','Instance startup'),r.instanceStartupSeconds],[t('容器启动（含镜像下载）','Container startup (includes image pull)'),r.startupSeconds],[t('其中：镜像下载','Of which: image pull'),r.imagePullSeconds],[t('准备（含模型下载）','Setup (includes model download)'),r.setupSeconds],[t('其中：模型下载','Of which: model download'),r.modelDownloadSeconds],[t('引擎加载及分析','Engine load and analysis'),r.engineSeconds],[t('结果信息及保存','Provenance and save'),r.saveSeconds]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=duration(value);timings.append(dt,dd);}details.append(timings);
  const model=document.createElement('p');model.textContent=t('模型：','Model: ')+r.model;details.append(model);
  if(r.completedAt){const stamp=document.createElement('p');stamp.textContent=t('完成于：','Completed: ')+new Date(r.completedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'long'});details.append(stamp);}
  if(status(r)==='failed'){const reason=document.createElement('p');reason.textContent=r.statusReason||t('实验未生成完整结果。','The experiment did not produce complete results.');details.append(reason);}
  if(r.archived){const note=document.createElement('p');note.textContent=t('测试棋谱已从公开棋谱库归档，实验统计仍保留。','The test record is archived from the public library; its statistics remain here.');details.append(note);}
  if(r.recordUrl){const link=document.createElement('a');link.href=r.recordUrl;link.textContent=t('查看测试棋谱','Open test game');article.append(link);}
  article.prepend(h,context,state,metrics);article.append(details);fragment.append(article);
 }
 $('benchmark-results').replaceChildren(fragment);
}
for(const b of document.querySelectorAll('[data-filter]'))b.onclick=()=>{filter=b.dataset.filter;render();};
document.querySelectorAll('[data-language]').forEach(b=>b.onclick=()=>{setLanguage(b.dataset.language);render();});render();
try{const response=await fetch('benchmarks-data.json',{cache:'no-cache'});if(!response.ok)throw Error('Unable to load benchmarks.');data=await response.json();render();}catch(error){$('benchmark-count').textContent=error.message;}
