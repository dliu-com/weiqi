import {t} from './i18n.js';
import {technicalTimestamp} from './site-time.js';
import {stats} from './flow-diagram.js';
import {PAGE_BUDGETS,CPU_BUDGETS,LIVE_TARGETS,LIVE_SAMPLES,SERVER_BUDGETS} from './performance-spec.js';
// The Performance tab of /docs (about.js). Budgets come from performance-spec.js, the same file the tests use;
// measurements come from performance-data.json, written by scripts/performance/measure.mjs.
let data=null,failed=false,loading=null,scrolled=false;
const text=pair=>t(pair[0],pair[1]);
const kb=bytes=>Number.isFinite(bytes)?(bytes/1024).toFixed(1)+' KB':'—';
const time=value=>{if(value==null||!Number.isFinite(value))return '—';if(value>=10000)return (value/1000).toFixed(1)+t(' 秒',' s');return (value<10?value.toFixed(1):Math.round(value).toLocaleString('en-US'))+' ms';};
const num=value=>({text:value,num:true});
const pass=ok=>ok==null?'—':ok?t('✓ 达标','✓ Within'):t('✗ 超出','✗ Over');
function el(tag,content,className){const node=document.createElement(tag);if(content!=null)node.textContent=content;if(className)node.className=className;return node;}
const note=content=>el('p',content,'bench-note');
function section(id,title,...nodes){const s=el('section');s.id=id;s.append(el('h2',title),...nodes.filter(Boolean));return s;}
function link(href,label){const a=el('a',label);a.href=href.startsWith('#')?location.pathname+href:href;return a;}
function table(head,rows){
 const wrap=el('div',null,'document-table'),tbl=el('table'),thead=el('thead'),top=el('tr'),tbody=el('tbody');
 for(const h of head)top.append(el('th',h));thead.append(top);
 for(const row of rows){const tr=el('tr');for(const cell of row){const v=cell&&typeof cell==='object'?cell:{text:cell};tr.append(el('td',v.text??'—',v.num?'num':null));}tbody.append(tr);}
 tbl.append(thead,tbody);wrap.append(tbl);return wrap;
}
function list(items){const ul=el('ul',null,'doc-list');for(const item of items){const li=el('li');li.append(...[].concat(item));ul.append(li);}return ul;}
function load(refresh){loading??=fetch('/performance-data.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Unable to load performance data.');return r.json();}).then(d=>{data=d;},()=>{failed=true;}).then(()=>refresh?.());}

export function renderPerformance(titleNode,contentNode,refresh){
 document.title=t('性能测试 · DL','Performance · DL');titleNode.textContent=t('性能测试','Performance tests');
 const intro=el('p'),results=el('div');intro.id='performance-intro';results.id='performance-results';contentNode.replaceChildren(intro,results);
 if(!data){if(!failed)load(refresh);intro.textContent=failed?t('无法加载性能数据。','Unable to load performance data.'):t('正在加载…','Loading…');return;}
 const page=path=>data.pages.find(p=>p.path===path),liveRow=path=>data.live.find(r=>r.path===path),fn=id=>data.server?.functions.find(f=>f.id===id);
 const pageRows=PAGE_BUDGETS.map(b=>({b,m:page(b.path)})),cpuRows=CPU_BUDGETS.map(b=>({b,m:data.cpu.find(c=>c.id===b.id)})),serverRows=SERVER_BUDGETS.map(b=>({b,m:fn(b.id)}));
 const pageOk=r=>r.m?Math.max(r.m.sourceGzip,r.m.servedBytes)<=r.b.kb*1024:null,cpuOk=r=>r.m?r.m.medianMs<=r.b.ms:null,serverOk=r=>r.m?.invocations?r.m.p95Ms<=r.b.p95:null;
 const checks=[...pageRows.map(pageOk),...cpuRows.map(cpuOk),...serverRows.map(serverOk),...data.live.map(r=>r.status===200)].filter(v=>v!=null);
 const largest=pageRows.reduce((top,r)=>r.m&&r.m.servedBytes>(top?.m.servedBytes||0)?r:top,null),game=fn('game');
 intro.textContent=t(`测量于 ${technicalTimestamp(data.measuredAt)}。页面大小和代码速度在每次运行测试时检查，超出预算就不会部署；线上时间和服务器时间来自这次测量。`,`Measured ${technicalTimestamp(data.measuredAt)}. Page size and code speed are checked on every test run, and a deploy stops if one is over budget. Live and server times come from this measurement.`);
 const fragment=document.createDocumentFragment();
 fragment.append(stats([
  [`${checks.filter(Boolean).length} / ${checks.length}`,t('项检查达标','checks within budget'),'check'],
  [largest?kb(largest.m.servedBytes):'—',largest?t(`最大的首次访问：${text(largest.b.name)}（压缩后）`,`Largest first visit: ${text(largest.b.name)} (compressed)`):'','browser'],
  [time(game?.p50Ms),t('公共 API 服务器时间中位数','Public API median server time'),'lambda']
 ]));
 fragment.append(section('perf-pages',t('页面大小','Page size'),
  table([t('页面','Page'),t('地址','Address'),t('文件','Files'),t('源文件（gzip）','Source (gzip)'),t('线上传输','Served'),t('预算','Budget'),t('结果','Result')],
   pageRows.map(r=>[text(r.b.name),r.b.path,num(r.m?.files??'—'),num(kb(r.m?.sourceGzip)),num(kb(r.m?.servedBytes)),num(r.b.kb+' KB'),pass(pageOk(r))])),
  note(t('首次访问要下载的内容：HTML、本站 CSS，以及页面静态导入的全部 JavaScript 模块。不含共享的 dl.css、字体、图片和之后加载的数据。“线上传输”是网站实际发送的压缩大小。','What a first visit downloads: the HTML, this site\'s CSS and every JavaScript module the page imports. The shared dl.css, fonts, images and data loaded later are not counted. "Served" is the compressed size the site actually sent.'))));
 fragment.append(section('perf-code',t('代码速度','Code speed'),
  table([t('检查','Check'),t('为什么重要','Why it matters'),t('中位数','Median'),t('预算','Budget'),t('结果','Result')],
   cpuRows.map(r=>[text(r.b.name),text(r.b.why),num(time(r.m?.medianMs)),num(time(r.b.ms)),pass(cpuOk(r))])),
  note(t(`在 ${data.client.machine}（Node ${data.client.node}）上运行 5 次取中位数。预算约为当前时间的 5–10 倍，只有真正变慢才会失败。`,`Median of 5 runs on ${data.client.machine} (Node ${data.client.node}). Budgets are about 5–10 times today's time, so only a real slowdown fails.`))));
 if(data.server)fragment.append(section('perf-server',t('服务器时间','Server time'),
  table([t('函数','Function'),t('作用','What it does'),t('调用','Calls'),t('中位数','Median'),t('p95','p95'),t('p95 预算','p95 budget'),t('冷启动','Cold starts'),t('内存','Memory'),t('结果','Result')],
   serverRows.map(r=>[text(r.b.name),text(r.b.role),num(r.m?r.m.invocations.toLocaleString('en-US'):'—'),num(time(r.m?.p50Ms)),num(time(r.m?.p95Ms)),num(time(r.b.p95)),num(r.m?.invocations?`${r.m.coldStarts.toLocaleString('en-US')} · ${time(r.m.initP50Ms)}`:'—'),num(r.m?.maxMemoryMB?`${Math.round(r.m.maxMemoryMB)} / ${r.m.memoryMB} MB`:'—'),r.m?.invocations?pass(serverOk(r)):t('无调用','No calls')])),
  note(t(`Lambda 在爱尔兰运行的时间，来自 CloudWatch 日志最近 ${data.server.days} 天（截至 ${technicalTimestamp(data.server.measuredAt)}）的全部真实请求，与测试地点无关。冷启动一栏是次数和启动时间中位数。`,`Time each Lambda function ran in Ireland, from CloudWatch Logs for every real request in the ${data.server.days} days to ${technicalTimestamp(data.server.measuredAt)}. It does not depend on where the test ran. Cold starts shows how many and their median start-up time.`))));
 const viaProxy=data.client.proxy?t(`经过 ${data.client.proxy} 代理（它会解密并重新加密流量，时间包含代理）`,`through a ${data.client.proxy} proxy, which decrypts and re-encrypts traffic, so times include the proxy`):t('没有经过代理','with no proxy');
 fragment.append(section('perf-live',t('线上响应时间','Live response times'),
  table([t('请求','Request'),t('地址','Address'),t('状态','Status'),t('首次请求','First request'),t(`后续 ${LIVE_SAMPLES-1} 次（中位数）`,`Next ${LIVE_SAMPLES-1} (median)`),t('大小','Size'),t('CloudFront 缓存','CloudFront cache')],
   LIVE_TARGETS.map(target=>{const r=liveRow(target.path);return [text(target.name),target.path,String(r?.status??'—'),num(time(r?.cold.total)),num(time(r?.warm.ttfb)),num(kb(r?.bytes)),r?[r.cold.cache,r.warm.cache].filter(Boolean).join(' → '):'—'];})),
  note(t(`从一台电脑测量，HTTP/${data.client.http}，${viaProxy}。首次请求包含新建连接；后续请求复用连接，只计到收到第一个字节。时间取决于测量地点：本站在爱尔兰（eu-west-1）。`,`Measured from one computer over HTTP/${data.client.http}, ${viaProxy}. The first request opens a new connection; the others reuse it and are timed to the first byte. Times depend on where they are measured from: the site runs in Ireland (eu-west-1).`))));
 const one=liveRow('/api/library/<id>'),health=liveRow('/health');
 fragment.append(section('perf-findings',t('结果说明','What the numbers show'),list([
  t('脚本和样式在 CloudFront 边缘缓存一天；页面本身每次访问都会向爱尔兰的 S3 确认（RefreshHit），这样发布后立刻显示新版本。离欧洲越远，这一步占页面时间越多。','Scripts and styles stay at the CloudFront edge for a day. Each page is checked with S3 in Ireland on every visit (RefreshHit), so a new release shows at once. Far from Europe, that check is most of a page\'s time.'),
  game?.invocations?t(`公共 API 每次调用都在爱尔兰运行；${Math.round(game.coldStarts/game.invocations*100)}% 的调用是冷启动，多花约 ${time(game.initP50Ms)}。`,`Every public API call runs in Ireland. ${Math.round(game.coldStarts/game.invocations*100)}% of calls are cold starts, which add about ${time(game.initP50Ms)}.`):null,
  one?t(`最慢的公共读取是一盘棋谱（${kb(one.bytes)} 压缩后）：它连同完整的 AI 分析一起返回。`,`The slowest public read is one game (${kb(one.bytes)} compressed): it returns the record with its full AI analysis.`):null,
  health?t('健康检查结果在边缘缓存 60 秒，所以后续请求很快。','Health results are cached at the edge for 60 seconds, so repeat requests are fast.'):null
 ].filter(Boolean))));
 fragment.append(section('perf-method',t('测试方法','How it is tested'),list([
  t('npm test 运行 tests/performance.test.js：检查每个页面的大小和代码速度，并检查最近一次测量中每个地址都返回 200、每个函数的 p95 都在预算内。make deploy 先运行测试。','npm test runs tests/performance.test.js. It checks every page\'s size and the code speed, and that in the last measurement every address answered 200 and every function\'s p95 was within budget. make deploy runs the tests first.'),
  t('发布后，node scripts/performance/measure.mjs --server 测量线上网站并更新本页；再运行一次 make publish 即可显示。','After a release, node scripts/performance/measure.mjs --server measures the live site and updates this page; run make publish again to show it.'),
  t(`只用访客请求：GET，不带 Cookie，不登录，不调用管理员接口或 Weiqi API。这次共 ${data.requests} 个请求，其中受限读取远低于每分钟 120 次的上限。`,`Guest requests only: GET, no cookies, no sign-in, never the admin endpoints or the Weiqi API. ${data.requests} requests in this run, with rate-limited reads far below the 120 a minute limit.`),
  [link('/performance-data.json',t('原始数据','Raw data')),' · ',link('https://github.com/dliu-com/weiqi/blob/main/scripts/performance/measure.mjs',t('测量脚本','Measuring script')),' · ',link('#benchmarks',t('AI 分析基准实验','AI analysis benchmarks')),' · ',link('#health',t('网站健康','Site health'))]
 ])));
 results.replaceChildren(fragment);
 if(!scrolled&&/^#perf-/.test(location.hash)){scrolled=true;document.getElementById(location.hash.slice(1))?.scrollIntoView();}
}
