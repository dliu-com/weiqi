import './site-shell.js';import {t} from './i18n.js';import {tiers,flow,stats,callout} from './flow-diagram.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const say=v=>typeof v==='string'?v:t(...v),dash='—';
const ul=items=>{const list=el('ul','doc-list');for(const item of items)list.append(el('li','',say(item)));return list;};
const para=(zh,en)=>el('p','',t(zh,en)),line=(zh,en)=>el('p','table-note',t(zh,en));
const part=(zh,en,...nodes)=>{const s=el('section');s.append(el('h2','',t(zh,en)),...nodes);return s;};
const costFlows=[
 {href:'/game',name:['棋谱库','Game library'],path:['保存棋谱 → GPU 逐手 AI 复盘 → 报告','Save a game → GPU AI review of every move → report'],
  cost:[[['深度分析与报告','Deep analysis and report'],['US$0.50–0.75 / 局','US$0.50–0.75 / game']],[['只有快速分析','Quick analysis only'],['约 US$0.05 / 局','about US$0.05 / game']]],
  limits:[[['深度分析','Deep analysis'],['10 局 / 天','10 games / day']],[['新棋谱','New games'],['100 局 / 天','100 / day']]],
  note:['每局都有快速分析；超过深度额度的棋谱没有报告。伦敦时间零点重置。','Every game gets quick analysis; games over the deep limit get no report. Resets at midnight London time.']},
 {href:'/analysis',name:['AI 分析','AI analysis'],path:['照片 → 识别棋子 → AI 分析一个局面（CPU）','Photo → recognise stones → AI analyses one position (CPU)'],
  cost:[[['照片识别','Photo recognition'],['US$0.0004 / 次','US$0.0004 each']],[['AI 分析','AI analysis'],['US$0.00015 / 次','US$0.00015 each']]],
  limits:[[['全站','Site-wide'],['2,000 次 / 天（US$3）','2,000 / day (US$3)']],[['每个连接','Per connection'],['500 次 / 天','500 / day']]],
  note:['UTC 零点重置。','Resets at 00:00 UTC.']},
 {href:'/play',name:['对弈','Live play'],path:['每台设备每 3 秒同步 → 棋局 API → 数据库','Each device syncs every 3 s → game API → database'],
  cost:[[['3 小时、300 手、2 台设备','3 h, 300 moves, 2 devices'],['约 US$0.52 / 局','about US$0.52 / game']],[['1 小时、100 手、2 台设备','1 h, 100 moves, 2 devices'],['约 US$0.07 / 局','about US$0.07 / game']]],
  limits:[[['修改','Edits'],['全站 120 次 / 分钟；每个连接 60 次','120 / min site-wide; 60 per connection']],[['棋局','Game'],['最多 400 手','Up to 400 moves']],[['自动同步','Auto-sync'],['10 分钟没有落子后暂停','Pauses after 10 min without a move']]],
  note:['不用 AI。每次同步都保存整局棋，所以主要是数据库写入费用。','No AI. Each sync saves the whole game, so database writes are most of the cost.']},
 {name:['网站与存储','Site and storage'],path:['网页、已存棋谱和 AI 软件，随时可用','Pages, saved games and the AI software, always ready'],
  cost:[[['无人访问','No visitors'],['约 US$0.70 / 月','about US$0.70 / month']],[['网页浏览','Page views'],['约 US$0.03 / 1,000 次','about US$0.03 / 1,000']]],
  note:['存储费用随棋谱增多而缓慢增加。','Storage grows slowly as games are saved.']}
];
const pages={
 cost:{title:['网站运行成本','Site running costs'],intro:costSummary,extra:costDetails,links:[['/docs/benchmarks','基准实验','Benchmark experiments'],['https://aws.amazon.com/ec2/pricing/on-demand/','AWS EC2 价格','AWS EC2 pricing'],['https://aws.amazon.com/lambda/pricing/','AWS Lambda 价格','AWS Lambda pricing'],['https://aws.amazon.com/s3/pricing/','AWS S3 价格','AWS S3 pricing'],['https://aws.amazon.com/dynamodb/pricing/','AWS DynamoDB 价格','AWS DynamoDB pricing'],['https://aws.amazon.com/cloudfront/pricing/','AWS CloudFront 价格','AWS CloudFront pricing']]},
 security:{title:['安全审查','Security review'],intro:securityOverview,extra:securityExtra,links:[['https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html','OWASP API 安全','OWASP REST security'],['https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html','OWASP 输入验证','OWASP input validation'],['https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html','OWASP XSS 防御','OWASP XSS prevention']]},
 photo:{title:['照片识别原理','How photo recognition works'],intro:photoIntro,sections:photoSections,extra:photoResults,after:photoAfter,sourcesTitle:['源代码与许可','Source code and licences'],sourcesNote:['Moku v4 和本站的照片识别代码都采用 AGPL-3.0 许可。Moku 项目报告其测试集中约 44% 的照片完全正确；本站在其输出之上增加了上述检查。','Moku v4 and this site’s photo-recognition code are both licensed under AGPL-3.0. The Moku project reports that about 44% of its test photos are read perfectly; this site adds the checks above on top of its output.'],links:[['/analysis','照片分析','Photo analysis'],['https://github.com/kaya-go/moku','Moku 源代码','Moku source code'],['https://huggingface.co/kaya-go/moku-v4','Moku v4 模型','Moku v4 model'],['/photo-assets/photo-source.tar.gz','下载本站识别源码','Download this site’s recognition source'],['https://onnxruntime.ai/','ONNX Runtime','ONNX Runtime']]}
};
function costList(title,rows,className){const f=document.createDocumentFragment(),h=document.createElement('h3'),list=document.createElement('dl');h.textContent=t(...title);list.className='cost-list'+(className?' '+className:'');for(const [label,value]of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=t(...label);dd.textContent=t(...value);list.append(dt,dd);}f.append(h,list);return f;}
function costSummary(f){
 const grid=el('div','cost-flows');
 costFlows.forEach((c,i)=>{
  const card=el('section','cost-flow'),h=el('h2'),name=el(c.href?'a':'span','',t(...c.name));
  if(c.href)name.href=c.href;
  h.append(el('span','cost-flow-number',String(i+1)),name);
  card.append(h,el('p','cost-flow-path',t(...c.path)),costList(['费用','Cost'],c.cost,'cost-price'));
  if(c.limits)card.append(costList(['限额','Limits'],c.limits));
  card.append(el('p','cost-flow-note',t(...c.note)));grid.append(card);
 });
 f.append(el('p','cost-lead',t('这些费用由网站承担，用户免费。AWS 按用量计费，没有固定月费。金额为美元估算，未扣免费额度，未含税。','The site pays these costs; users pay nothing. AWS bills by use, with no fixed monthly fee. USD estimates, before free tiers and tax.')),grid,flow({title:t('费用保护（只暂停 AI）','Spending guard (pauses AI only)'),steps:[
  {icon:'budget',title:'AWS Budgets',text:t('每天 $15 · 每月 $50','$15 / day · $50 / month')},
  {icon:'lambda',title:t('保护程序','Guard Lambda'),text:t('超额时运行','Runs when exceeded')},
  {icon:'shield',title:t('暂停 AI','Pause AI'),text:t('停止 GPU 队列与任务','Stops GPU queue and jobs'),tone:'bad'},
  {icon:'check',title:t('仍可复盘','Replay still works'),text:t('棋谱与报告保留','Games and reports stay'),tone:'good'}
 ],note:t('须由管理员手动恢复 AI。对弈、网页和存储不受影响。','An administrator must resume AI. Live play, pages and storage keep running.')}));
}
function costDetails(f){
 f.append(
  part('1 棋谱库','1 Game library',
   table([['项目','Item'],['用时','Time'],['费用','Cost']],[
    [['快速分析（32 次访问，T4）','Quick analysis (32 visits, T4)'],['约 3.5 分钟','about 3.5 min'],['约 $0.05','about $0.05']],
    [['深度分析（3,000 次访问，T4）','Deep analysis (3,000 visits, T4)'],['约 46 分钟','about 46 min'],['约 $0.45','about $0.45']],
    [['每局预算：两次分析、启动与空闲、报告','Budget per game: both passes, start-up and idle time, report'],dash,'$0.50–0.75']]),
   line('实测一局 321 手的棋局。GPU 价格（爱尔兰按需，2026-10-06）：A10G 每小时 $1.123（首选），T4 每小时 $0.587（后备）。','Measured on one 321-move game. GPU prices (Ireland, On-Demand, 6 Oct 2026): A10G $1.123 an hour (first choice), T4 $0.587 an hour (backup).'),
   table([['用量','Usage'],['费用','Cost']],[
    [['每月 10 局深度分析','10 deep games a month'],['约 $5–7.50 / 月','about $5–7.50 / month']],
    [['每月 100 局深度分析','100 deep games a month'],['约 $50–75 / 月','about $50–75 / month']],
    [['AI 额度全部用满的一天','A day at every AI limit'],['约 $12.50–15','about $12.50–15']]]),
   line('“全部用满”= 10 局深度 + 90 局只有快速分析 + $3 照片与局面分析。每月 $50 的费用保护会先暂停 AI。','“Every AI limit” = 10 deep games + 90 quick-only games + $3 of photos and positions. The $50 monthly guard pauses AI first.')),
  part('2 AI 分析','2 AI analysis',
   table([['',''],['每次','Each'],['每 1,000 次','Per 1,000'],['内存 × 平均时间','Memory × average time']],[
    [['照片识别','Photo recognition'],'US$0.0004','US$0.42','3.5 GB × 7.3 s'],
    [['AI 分析','AI analysis'],'US$0.00015','US$0.15','3 GB × 3.0 s']]),
   line('在 AWS Lambda（爱尔兰）实测，含冷启动。额度按每次 US$0.0015 计算，高于最坏情况（约 US$0.0013）。','Measured on AWS Lambda in Ireland, including cold starts. The allowance counts US$0.0015 per request, above the worst case (about US$0.0013).')),
  part('3 对弈','3 Live play',
   para('估算一局 3 小时、300 手、两台设备都开着自动同步的对局：每台设备每 3 秒同步一次，共约 7,500 次请求。计时进行时，每次同步都保存整局棋，到第 300 手时约 160 KB，所以数据库写入是主要费用。','Estimate for a 3-hour, 300-move game on two devices with auto-sync on: each device syncs every 3 seconds, about 7,500 requests in all. While the clock runs, each sync saves the whole game, about 160 KB by move 300, so database writes are most of the cost.'),
   table([['项目','Item'],['费用','Cost']],[
    [['数据库写入（保存棋局）','Database writes (saving the game)'],'$0.43'],
    [['数据库读取','Database reads'],'$0.02'],
    [['CloudFront（传输与请求）','CloudFront (data and requests)'],'$0.06'],
    [['Lambda 与日志','Lambda and logs'],'$0.01'],
    [['合计','Total'],['约 $0.52','about $0.52']]]),
   table([['对局','Game'],['费用','Cost']],[
    [['1 小时、100 手、2 台设备','1 h, 100 moves, 2 devices'],'$0.07'],
    [['2 小时、250 手、2 台设备','2 h, 250 moves, 2 devices'],'$0.30'],
    [['3 小时、300 手、1 台设备','3 h, 300 moves, 1 device'],'$0.27'],
    [['4 小时、400 手、2 台设备','4 h, 400 moves, 2 devices'],'$0.90']]),
   line('按爱尔兰价格和实测 Lambda 用时计算。计时暂停或关闭自动同步时费用更低。','Based on Ireland prices and measured Lambda times. Lower when the clock is paused or auto-sync is off.')),
  part('4 网站与存储','4 Site and storage',
   table([['项目','Item'],['每月','Per month']],[
    [['AI 软件镜像（约 2 GB）','AI software image (about 2 GB)'],'$0.21'],
    [['网站与棋谱文件（S3，约 3.5 GB）','Website and game files (S3, about 3.5 GB)'],'$0.08'],
    [['分析队列轮询（在 AWS 免费额度内）','Analysis queue polling (within the AWS free tier)'],'$0.34'],
    [['费用保护检查（每 5 分钟）','Spending guard checks (every 5 min)'],'$0.04'],
    [['数据库、日志、CloudFront、证书','Databases, logs, CloudFront, certificate'],['约 $0','about $0']],
    [['合计（无人访问）','Total (no visitors)'],['约 $0.70','about $0.70']]]),
   line('每次网页浏览约 10–22 个请求、30–65 KB，每 1,000 次约 $0.03。现有域名和 DNS 不计入。','Each page view is about 10–22 requests and 30–65 KB: about $0.03 per 1,000 views. The existing domain and DNS are not included.')),
  part('费用风险','Spending risk',ul([
   ['费用保护只暂停 AI；对弈、网页浏览和存储不会停。','The spending guard pauses AI only; live play, page views and storage keep running.'],
   ['最坏情况：机器人按全站上限（每分钟 120 次）整天同步一局 400 手的棋，每天约 $29。','Worst case: bots syncing a 400-move game at the site-wide limit (120 a minute) all day would cost about $29 a day.'],
   ['限额按次数计算，不是美元上限；账单数据有延迟，所以费用保护也不是硬上限。','Limits count requests, not dollars, and billing data is delayed, so the guard is not a hard cap either.'],
   ['重试、后备 GPU、更大的模型或恶意流量都可能提高账单。','Retries, the backup GPU, larger models or abusive traffic can raise the bill.']])));
}
function table(headers,rows){const wrapper=document.createElement('div');wrapper.className='document-table';const table=document.createElement('table'),head=document.createElement('tr');for(const [zh,en]of headers){const th=document.createElement('th');th.textContent=t(zh,en);head.append(th);}table.append(head);for(const row of rows){const tr=document.createElement('tr');for(const cell of row){const td=document.createElement('td');td.textContent=say(cell);tr.append(td);}table.append(tr);}wrapper.append(table);return wrapper;}
function securityOverview(f){
 f.append(callout('shield',t('2026 年 11 月 3 日完成威胁建模、代码审查和线上渗透测试（首次审查：10 月 8 日）；这不是安全认证。这是公开网站：在设定限额内被滥用，是可接受的设计选择。','Threat model, code review and live penetration test done on 3 November 2026 (first review: 8 October); this is not a certification. This is a public site: abuse within the set limits is an accepted design choice.')));
 f.append(tiers({title:t('信任边界','Trust boundaries'),rows:[
  {badge:t('不可信','Untrusted'),label:t('互联网','Internet'),tone:'untrusted',nodes:[{icon:'user',title:t('访客','Visitors'),text:t('无须登录','No sign-in')},{icon:'bot',title:t('机器人 / 攻击者','Bots / attackers'),text:t('同样的公开权限','Same public access')}]},
  {link:'HTTPS',badge:t('边缘','Edge'),label:'CloudFront',tone:'edge',nodes:[{icon:'cloudfront',title:'CloudFront',text:t('仅 HTTPS · HSTS · CSP','HTTPS only · HSTS · CSP')},{icon:'filter',title:'ApiViewer',text:t('标记连接网络，不保存 IP','Tags the network; IP not stored')},{icon:'lock',title:'OAC',text:t('签名访问源站','Signs requests to origins')}]},
  {link:t('只有 CloudFront 能调用','Only CloudFront can call'),badge:'API',label:t('检查与限额','Checks and limits'),tone:'app',nodes:[{icon:'lambda',title:'Lambda API',text:t('来源 · JSON · 大小 · SGF','Origin · JSON · size · SGF')},{icon:'gauge',title:t('限额','Limits'),text:t('每个连接 + 全站','Per connection + site-wide')},{icon:'budget',title:t('费用保护','Spending guard'),text:t('每天 $15 · 每月 $50','$15 / day · $50 / month')}]},
  {link:'IAM',badge:t('私有','Private'),label:t('数据与计算','Data and compute'),tone:'private',nodes:[{icon:'dynamodb',title:'DynamoDB',text:t('条件写入 · 时间点恢复','Conditional writes · PITR')},{icon:'s3',title:'S3',text:t('禁止公开访问 · 版本','No public access · versions')},{icon:'gpu',title:'Batch GPU',text:t('没有入站端口','No inbound ports')},{icon:'report',title:t('报告渲染','Report renderer'),text:t('阻止外部网络请求','Blocks outside requests')}]}
 ],note:t('公开源码不含 AWS 密钥；所有 AWS 权限来自服务器 IAM 角色。','Public code holds no AWS keys; all AWS access comes from server IAM roles.')}));
 const h=document.createElement('h2');h.textContent=t('公开限额','Public limits');f.append(h);
 f.append(stats([[t('60 次 / 分钟','60 / min'),t('每个连接的修改','edits per connection'),'gauge'],[t('120 次 / 分钟','120 / min'),t('每个连接的棋谱库读取','library reads per connection'),'library'],[t('500 次 / 天','500 / day'),t('每个连接的 AI 分析','AI analyses per connection'),'katago'],[t('10 局 / 天','10 / day'),t('每个连接保存的棋谱','saved games per connection'),'library'],[t('3 局 / 天','3 / day'),t('每个连接的深度 AI 棋局','deep AI games per connection'),'gpu'],[t('120 次 / 分钟','120 / min'),t('全站修改','edits, site-wide'),'gauge'],[t('2,000 次 / 天','2,000 / day'),t('全站 AI 分析','AI analyses, site-wide'),'katago'],[t('10 局 / 天','10 / day'),t('全站深度 AI 棋局','deep AI games, site-wide'),'gpu'],[t('100 局 / 天','100 / day'),t('全站新棋谱','new records, site-wide'),'library']]));
 const p=document.createElement('p');p.className='dg-note';p.textContent=t('“连接”指一个 IPv4 地址或一个 IPv6 /64 网络；只保存哈希桶编号，不保存 IP。','A “connection” is one IPv4 address or one IPv6 /64 network. Only a hashed bucket number is stored, never the IP.');f.append(p);
}
function securityExtra(f){
 const heading=(zh,en)=>{const h=document.createElement('h2');h.textContent=t(zh,en);f.append(h);};
 const para=(zh,en)=>{const p=document.createElement('p');p.textContent=t(zh,en);f.append(p);};
 const list=items=>{const l=document.createElement('ul');for(const [zh,en]of items){const li=document.createElement('li');li.textContent=t(zh,en);l.append(li);}f.append(l);};
 const pass=['✓ 通过','✓ Pass'],fixed=['✓ 已修复','✓ Fixed'],accepted=['接受','Accepted'],decide=['待你决定','Your decision'];
 heading('威胁模型','Threat model');
 para('需要保护的资产：','Assets to protect:');
 list([['AWS 账单：GPU、Lambda、DynamoDB、CloudFront 和 S3 都按用量收费。','The AWS bill: GPU, Lambda, DynamoDB, CloudFront and S3 all charge by use.'],['公开棋谱库和 AI 报告：已保存后不能被公开改写或删除。','The public library and AI reports: once saved, they cannot be overwritten or deleted by the public.'],['现场棋局和记谱草稿：公开共享，任何人都可以修改（设计如此）。','The live game and the record draft: shared in public, and anyone can change them (by design).'],['AWS 资源和权限：私有存储桶、IAM 角色、费用保护设置。','AWS resources and access: private buckets, IAM roles and the spending-guard settings.'],['网站可用性和信誉：页面不能被注入脚本或跳转到其他网站。','Availability and trust: pages must not run injected script or redirect elsewhere.']]);
 para('攻击者类型：本站没有登录，所以“已登录的其他用户”“所有者”和“被盗令牌”都不存在：所有人（包括机器人）的权限相同。','Actors: the site has no sign-in, so there is no “signed-in non-owner”, “owner” or “stolen token”: everyone, bots included, has the same public access.');
 list([['匿名访客或机器人：可以读取、对弈、编辑草稿和保存棋谱，受限额约束。','Anonymous visitor or bot: can read, play, edit the draft and save games, within the limits.'],['多 IP 机器人：可以绕过每个连接的限额，但不能绕过全站上限。','Bots on many IPs: can get around per-connection limits, but not the site-wide caps.'],['被篡改的依赖或 AI 模型：通过锁文件、固定版本和 SHA-256 检查防护。','A compromised dependency or AI model: guarded by lockfiles, pinned versions and SHA-256 checks.'],['拿到 AWS 账户的人：不在本站范围内，由 AWS 账户的多重验证保护。','Someone with AWS account access: outside this site’s scope; protected by the AWS account’s MFA.']]);
 heading('各组件的 STRIDE 分析','STRIDE per component');
 para('S 冒充 · T 篡改 · R 抵赖 · I 信息泄露 · D 拒绝服务 · E 权限提升。','S spoofing · T tampering · R repudiation · I information disclosure · D denial of service · E elevation of privilege.');
 f.append(table([['组件','Component'],['主要威胁','Main threats'],['防护','Controls']],[
  [['CloudFront 与网页存储桶','CloudFront and the site bucket'],['S 绕过网站直接访问 · T 缓存投毒 · I 隐藏文件 · D 请求洪水','S bypass to the origin · T cache poisoning · I hidden files · D request floods'],['只有 HTTPS、TLS 1.2+、OAC 签名、私有存储桶；缓存键只有路径；/api/* 不缓存；没有 WAF（见下文）','HTTPS only, TLS 1.2+, OAC signing, private bucket; the cache key is the path only; /api/* is never cached; no WAF (see below)']],
  [['ApiViewer 边缘函数','ApiViewer edge function'],['S 伪造客户端 IP 来绕过限额','S faking the client IP to dodge limits'],['用 CloudFront 看到的真实 IP 覆盖 x-weiqi-viewer','Overwrites x-weiqi-viewer with the IP CloudFront sees']],
  [['API Lambda（对弈、草稿、棋谱库）','API Lambda (game, draft, library)'],['S 跨站请求 · T 坏输入、并发覆盖 · R 匿名修改 · D 刷请求 · E 越权写入','S cross-site requests · T bad input, concurrent overwrites · R anonymous edits · D request floods · E writing beyond its role'],['检查来源和 JSON、大小上限、SGF 校验、条件写入；每个连接和全站限额；最多同时运行 20 个；只能新建棋谱文件','Origin and JSON checks, size limits, SGF validation, conditional writes; per-connection and site-wide limits; at most 20 at once; can only create game files']],
  [['DynamoDB（现场棋局、草稿、计数器）','DynamoDB (live game, draft, counters)'],['T 覆盖 · D 写入费用','T overwrites · D write charges'],['条件写入、时间点恢复、删除保护；写入次数受 API 并发上限约束','Conditional writes, point-in-time recovery, deletion protection; writes bounded by the API concurrency cap']],
  [['棋谱库存储桶','Library bucket'],['T 改写已保存棋谱 · I 读取控制文件','T rewriting saved games · I reading control files'],['禁止公开访问；只能经 API 读取指定路径；If-None-Match 防止覆盖；版本保留 30 天','No public access; read only through fixed API paths; If-None-Match blocks overwrites; versions kept 30 days']],
  [['照片识别和 AI 局面 Lambda','Photo-recognition and AI position Lambdas'],['T 命令注入 · D 刷 AI 费用','T command injection · D running up AI costs'],['先校验输入再计数；请求 ID 不能重用；最多同时 2 个；每天全站 2,000 次（约 $3）','Input is validated before anything is counted; request IDs cannot be reused; at most 2 at once; 2,000 a day site-wide (about $3)']],
  [['Batch GPU 分析','Batch GPU analysis'],['D GPU 费用 · T 被篡改的模型','D GPU cost · T a tampered model'],['没有入站端口；每天全站 100 局快速、10 局深度；配额最多 2 台 GPU；模型固定 SHA-256','No inbound ports; 100 quick and 10 deep games a day site-wide; the quota allows at most 2 GPUs; the model is pinned by SHA-256']],
  [['报告渲染（无头 Chromium）','Report renderer (headless Chromium)'],['I 服务器端请求伪造 · T 棋谱文字注入','I server-side request forgery · T script injection from game text'],['拦截所有非本站请求；只渲染本地文件；文字作为文本节点插入','Blocks every request outside the site; renders local files only; game text is inserted as text nodes']],
  [['费用保护','Spending guard'],['D 账单失控','D a runaway bill'],['每 5 分钟检查；超过每天 $15 或每月 $50 就暂停 AI','Checks every 5 minutes; pauses AI above $15 a day or $50 a month']],
  [['源代码与依赖','Source code and dependencies'],['T 被篡改的依赖 · I 泄露密钥','T a compromised dependency · I leaked secrets'],['锁文件、npm audit、gitleaks；代码中没有 AWS 密钥，权限来自 IAM 角色','Lockfiles, npm audit, gitleaks; no AWS keys in the code; access comes from IAM roles']]
 ]));
 heading('最坏情况的每小时费用（拒绝钱包攻击）','Worst-case cost per hour (denial of wallet)');
 f.append(table([['资源','Resource'],['每小时最多','Most per hour'],['上限来自','What caps it']],[
  [['GPU 分析','GPU analysis'],['约 $2.3','about $2.3'],['EC2 GPU 配额 8 个 vCPU = 最多 2 台；每天 100 局快速、10 局深度','EC2 GPU quota of 8 vCPUs = at most 2 machines; 100 quick and 10 deep games a day']],
  [['AI 局面分析','AI position analysis'],['约 $0.4（每天最多约 $3）','about $0.4 (at most about $3 a day)'],['最多同时 2 个；每天 2,000 次','At most 2 at once; 2,000 a day']],
  [['API Lambda 与 DynamoDB','API Lambda and DynamoDB'],['约 $6','about $6'],['最多同时 20 个；被拒绝的请求约 20 ms，所以每秒最多约 1,000 次','At most 20 at once; a refused request takes about 20 ms, so at most about 1,000 a second']],
  [['CloudFront 与 S3','CloudFront and S3'],['没有上限：每秒 10,000 次请求约 $60','No cap: about $60 at 10,000 requests a second'],['只有 WAF 速率规则能限制（需付费，待你决定）','Only WAF rate rules could cap it (costs money; your decision)']]
 ]));
 para('费用保护只暂停 AI，而且 AWS 账单数据有几小时延迟，所以它不是硬上限。','The spending guard pauses AI only, and AWS billing data lags by hours, so it is not a hard cap.');
 heading('线上渗透测试（2026 年 11 月 3 日）','Live penetration test (3 November 2026)');
 para('用 node scripts/security/pentest.mjs --rate-limits 对正式网站运行，44 项全部通过；结果保存在 cloud/security-pentest.json，可随时重跑。','Run against the live site with node scripts/security/pentest.mjs --rate-limits: all 44 checks passed. The results are in cloud/security-pentest.json, and the script can be rerun at any time.');
 f.append(table([['测试','Test'],['预期','Expected'],['实际','Actual'],['状态','Status']],[
  [['T1–T4 TLS','T1–T4 TLS'],['拒绝 TLS 1.0/1.1；HTTP 跳转 HTTPS','TLS 1.0/1.1 refused; HTTP redirects to HTTPS'],['拒绝；1.2/1.3 接受；301','Refused; 1.2/1.3 accepted; 301'],pass],
  [['T5–T7 安全头','T5–T7 Security headers'],['HSTS、CSP、nosniff、禁止嵌入、Permissions-Policy；API no-store；HTTP/3','HSTS, CSP, nosniff, no framing, Permissions-Policy; API no-store; HTTP/3'],['全部存在','All present'],pass],
  [['F1–F2 隐藏文件','F1–F2 Hidden files'],['.git、.env、源码映射、配置 → 404；没有目录列表','.git, .env, source maps, configs → 404; no listing'],['20 个路径全部 404','All 20 paths 404'],pass],
  [['M1 HTTP 方法','M1 HTTP methods'],['不支持的方法 → 4xx','Unsupported methods → 4xx'],['400/404/405','400/404/405'],pass],
  [['A1–A2 伪造凭证','A1–A2 Forged credentials'],['alg=none JWT 和管理员 cookie 被忽略；未签名请求被拒绝','alg=none JWT and admin cookie ignored; unsigned body rejected'],['相同的公开响应；404','Same public response; 404'],pass],
  [['C1–C3 跨站请求','C1–C3 Cross-site requests'],['其他来源或 null → 403；表单类型 → 415','Foreign or null Origin → 403; form types → 415'],['403（显示为 404 页面）；415','403 (shown as the 404 page); 415'],pass],
  [['C4 CORS','C4 CORS'],['没有 Access-Control-Allow 头','No Access-Control-Allow headers'],['没有','None'],pass],
  [['I1–I5 坏输入','I1–I5 Bad input'],['坏 JSON、原型污染、未知操作 → 400；过大 → 413；状态不变','Broken JSON, prototype pollution, unknown action → 400; too large → 413; no change'],['400/413；版本号不变','400/413; revisions unchanged'],pass],
  [['I6–I7 NoSQL / 翻页参数注入','I6–I7 NoSQL / cursor injection'],['400，不会 500','400, never 500'],['400','400'],pass],
  [['I8–I9 路径穿越','I8–I9 Path traversal'],['400 或 404，不泄露文件','400 or 404, no file contents'],['400/404','400/404'],pass],
  [['I10 AI 接口注入','I10 AI API injection'],['命令字符、600 手、SVG/HTML、1.6 MB → 400，不计费','Shell characters, 600 moves, SVG/HTML, 1.6 MB → 400, nothing charged'],['400','400'],pass],
  [['R1–R2 CRLF 与开放跳转','R1–R2 CRLF and open redirect'],['不注入响应头；只跳转到本站路径','No injected header; redirects stay on this site'],['没有注入；只有本站路径','No injection; site paths only'],pass],
  [['X1–X3 XSS','X1–X3 XSS'],['不回显脚本；预览页没有脚本','Script not echoed; preview page has no script'],['没有回显','Not echoed'],pass],
  [['K1–K2 缓存欺骗与投毒','K1–K2 Cache deception and poisoning'],['API 数据不缓存；转发头不影响页面','API data never cached; forwarded headers ignored'],['没有缓存命中；页面不变','No cache hit; page unchanged'],pass],
  [['B1–B3 绕过 CloudFront','B1–B3 Bypassing CloudFront'],['Lambda URL、S3 直连 → 403；cloudfront.net 同样受保护','Lambda URL and S3 directly → 403; cloudfront.net equally protected'],['403；同样的头和检查','403; same headers and checks'],pass],
  [['L1–L4 限额与重放','L1–L4 Limits and replay'],['超过 120 次读取、60 次修改 → 429；伪造 IP 头无效；重用请求 ID → 429','Over 120 reads or 60 edits → 429; spoofed IP header ignored; reused request ID → 429'],['429','429'],pass],
  [['G1–G4 AWS 设置','G1–G4 AWS settings'],['存储桶私有加密且只允许 TLS；并发 20；日志有保留期；GPU 配额 8','Buckets private, encrypted, TLS only; concurrency 20; logs expire; GPU quota 8'],['3 个日志组没有保留期，已修复后通过','3 log groups had no retention; fixed, then passed'],fixed]
 ]));
 para('不适用：没有登录，所以没有 OAuth/OIDC、JWT、会话或 IDOR 需要测试；也没有公开上传接口（保存由服务器完成）。','Not applicable: there is no sign-in, so there is no OAuth/OIDC, JWT, session or IDOR to test, and there is no public upload endpoint (the server does the saving).');
 heading('代码审查','Code review');
 list([['逐个阅读了所有处理程序：handler.cjs、library-handler.cjs、client-limit.cjs、draft-service.js、library-service.js、position-handler.cjs、analyze.py、share-preview.cjs、报告渲染和所有 CDK 堆栈。','Read every handler: handler.cjs, library-handler.cjs, client-limit.cjs, draft-service.js, library-service.js, position-handler.cjs, analyze.py, share-preview.cjs, the report renderer and every CDK stack.'],['每个写入接口都先检查来源、JSON 类型和大小，再计数和写入；错误信息不含堆栈或 AWS 名称。','Every write checks the Origin, JSON type and size before counting or writing; error messages contain no stack traces or AWS names.'],['npm audit：网站和 API 0 个问题。CDK 工具（只在部署时运行）修复后剩 2 个中等（aws-cdk-lib 内置的 minimatch，暂无修复）；开发依赖剩 1 个高（Jest 的 js-yaml，只在测试时运行）。','npm audit: 0 issues for the site and API. The CDK tool (run only when deploying) has 2 moderate left after fixes (minimatch bundled in aws-cdk-lib; no fix yet); dev dependencies have 1 high left (js-yaml in Jest, run only in tests).'],['报告渲染器：puppeteer-core 25.11.0 依赖的 zod 有 3 个高级别公告。它们影响 WebDriver BiDi，而渲染器使用 CDP 并拦截所有外部请求，所以接受；升级会让所有报告重新生成。','Report renderer: zod under puppeteer-core 25.11.0 has 3 high advisories. They affect WebDriver BiDi, but the renderer uses CDP and blocks every outside request, so this is accepted; upgrading would regenerate every report.'],['gitleaks 扫描了全部 205 个提交：没有密钥。当前代码没有 AWS 账户 ID，但较早的提交里有。','gitleaks scanned all 205 commits: no secrets. The current code has no AWS account ID, but older commits do.'],['IAM：每个角色只给需要的操作和资源。只有不支持资源级权限的操作（Batch 列出任务、开启费用标签）使用 *。','IAM: each role gets only the actions and resources it needs. * is used only where the action has no resource-level permission (listing Batch jobs, turning on a cost tag).'],['存储：存储桶禁止公开访问、加密、只允许 TLS、有版本；DynamoDB 加密、时间点恢复、删除保护；日志保留 1 天到 3 个月，日志中不记录 IP，也不开启 CloudFront 访问日志。','Storage: buckets block public access, are encrypted, TLS only and versioned; DynamoDB is encrypted, with point-in-time recovery and deletion protection; logs are kept 1 day to 3 months, never record IPs, and CloudFront access logging is off.'],['测试：新增回归测试，覆盖来源、内容类型、大小、坏 JSON、原型污染、HTTP 方法和翻页参数注入；限额、重放、上传拒绝和路径穿越已有测试。','Tests: a new regression test covers Origin, content type, size, broken JSON, prototype pollution, HTTP methods and cursor injection; limits, replay, refused uploads and path traversal were already tested.']]);
 heading('发现的问题','Findings');
 const lo=['低','Low'],me=['中','Medium'],info=['信息','Info'];
 f.append(table([['编号','ID'],['级别','Severity'],['问题','Finding'],['状态','Status']],[
  ['W-1',me,['CloudFront 和 S3 的请求与流量费用没有硬上限','CloudFront and S3 request and transfer charges have no hard cap'],decide],
  ['W-2',lo,['公开 git 历史中有 AWS 账户 ID（不是密钥）','The AWS account ID is in public git history (it is not a secret key)'],decide],
  ['W-3',lo,['3 个 Lambda 日志组没有保留期','3 Lambda log groups had no retention'],fixed],
  ['W-4',lo,['CDK 开发依赖有严重级别公告（Jest 的 Handlebars）','CDK dev dependencies had a critical advisory (Handlebars in Jest)'],fixed],
  ['W-5',lo,['报告渲染器的 zod 公告','zod advisory in the report renderer'],accepted],
  ['W-6',lo,['数据库出错时，每个连接的读取和保存限额放行；全站上限仍有效','If the database errors, per-connection read and save limits let requests through; site-wide caps still apply'],accepted],
  ['W-7',lo,['CSP 允许内联样式；HSTS 不含子域名','CSP allows inline styles; HSTS does not cover subdomains'],accepted],
  ['W-8',lo,['后台分析角色可以删除棋谱文件（存储桶有版本）','Background analysis roles can delete game files (the bucket is versioned)'],accepted],
  ['W-9',info,['少数 IAM 操作必须使用 *','A few IAM actions must use *'],accepted],
  ['W-10',info,['现场棋局和草稿任何人都能修改','Anyone can change the live game and the draft'],['设计如此','By design']],
  ['W-11',lo,['没有 Permissions-Policy 头（独立复查发现）','No Permissions-Policy header (found by the independent review)'],fixed],
  ['W-12',lo,['未启用的 Fargate 分派器会提交超出每日上限的深度分析（独立复查发现）','The disabled Fargate dispatcher would submit deep analysis over the daily cap (found by the independent review)'],fixed]
 ]));
 heading('接受的剩余风险','Accepted residual risks');
 list([['多 IP 分布式滥用仍可用完全站额度；AI 会暂停到第二天。','Distributed abuse from many IPs can still use up the site-wide limits; AI then pauses until the next day.'],['任何人都可以修改或清空现场棋局和草稿。棋局链接不保密，棋谱库公开。请不要上传私人信息。','Anyone can change or clear the live game and draft. Game links are not secret, and the library is public. Do not upload private information.'],['CloudFront 和 S3 的请求费用没有硬上限，也没有 WAF 或验证码；AWS Shield Standard 只防网络层攻击。','CloudFront and S3 request charges have no hard cap, and there is no WAF or CAPTCHA; AWS Shield Standard only stops network-level attacks.'],['大范围分享前，应考虑增加登录或邀请，以及 WAF 或验证码。','Before sharing widely, consider sign-in or invitations, and WAF or CAPTCHA.']]);
 heading('之前修复的问题（2026 年 10 月 8 日）','Fixed earlier (8 October 2026)');
 list([['一个客户端突发 70 次修改会暂停全站修改；现在只限制该连接。','70 edits from one client paused edits for everyone; now only that connection is limited.'],['并行修改误报“网站繁忙”；现在使用原子计数。','Parallel edits caused false “busy” errors; now an atomic counter is used.'],['错误的棋谱库翻页参数返回 500；现在返回 400。','A bad library page cursor returned 500; now it returns 400.'],['伪造保存请求可抢先占用现场棋局的保存 ID；现在没有公开上传接口，ID 由服务器生成。','A forged save request could take the live game’s save ID first; now there is no public upload, and the server picks IDs.'],['API 不能再删除棋谱文件；AI 模型固定官方版本和 SHA-256。','The API can no longer delete game files; the AI model is pinned to the official version and SHA-256.']]);
}
function photoSections(f){f.append(
 part('工作原理','How it works',ul([
  ['Moku v4 是开源的棋盘照片识别模型（基于 RT-DETR），找出棋盘四个角和每颗棋子；在 Lambda 中用 CPU 运行，不需要 GPU。','Moku v4, an open-source model for Go board photos (based on RT-DETR), finds the board’s corners and each stone. It runs on CPU in Lambda; no GPU is needed.'],
  ['Moku 每次最多返回 300 个对象，而接近终局的棋盘可能有近 300 颗棋子，所以除了整盘，还在四个重叠的局部上各运行一次。','Moku returns at most 300 objects per run, and a board near the end of a game can hold almost that many stones, so it runs on the whole board and on four overlapping quarters.'],
  ['棋子有厚度，斜拍时看起来偏离交叉点。网格按棋子中心重新对齐，再与棋盘线核对；无法确认时会告诉你，而不是返回错误的棋盘。','Stones have height, so in an angled photo they look off their points. The grid is refitted to the stone centres and checked against the printed lines; if it cannot be confirmed, you are told, rather than given a wrong board.'],
  ['每个候选再检查大小、颜色（与同一照片中附近的棋子和空点比较）、重复和重影。','Each candidate is then checked for size, colour (against nearby stones and empty points in the same photo), duplicates and echoes.'],
  ['照片和结果都不保存。','Neither the photo nor the result is saved.']])),
 part('需要检查的点','Points to check',ul([
  ['琥珀色虚线框（编辑模式）：识别不太确定的点，例如颜色检查推翻了模型、置信度低或删除了重复。点击修改后标记消失。','Amber dashed outline (in edit mode): a point the recognition is unsure about, for example where the colour check overruled the model, confidence was low, or a duplicate was removed. It disappears when you tap the point.'],
  ['红色实线框：没有气的棋子。实战中不可能出现，通常说明识别有误。','Solid red outline: stones without liberties. This cannot happen in a real game and usually means a recognition error.'],
  ['照片无法还原之前的棋步、提子或劫争。','A photo cannot reveal earlier moves, captures or ko.']])));}
function photoIntro(f){const notice=document.createElement('p');notice.className='notice-box';notice.textContent=t('照片识别仍在试验中。它把一张 19 × 19 棋盘照片转成可编辑的局面，只是起点；分析前请对照原照片检查每一颗棋子。','Photo recognition is experimental. It turns a photo of a 19 × 19 board into an editable position as a starting point; check every stone against the photo before analysing.');f.append(notice);const figure=document.createElement('figure');figure.className='architecture-diagram';const caption=document.createElement('figcaption');caption.textContent=t('从照片到局面','From photo to position');figure.append(caption);const rows=[[[t('浏览器','Browser'),t('缩小并压缩照片：最长边不超过 3,072 像素，约 1 MB 以内','Shrinks and compresses the photo: longest edge up to 3,072 pixels, about 1 MB or less')],[t('找到棋盘','Find the board'),t('Moku v4 找出四个角；不确定时用镜像照片和局部放大重试','Moku v4 finds the four corners; if unsure, it retries with a mirrored copy and zoomed crops')],[t('摆正棋盘','Square up the board'),t('透视校正为 800 × 800 像素的正方形','Perspective-corrects the board to an 800 × 800-pixel square')]],[[t('寻找棋子','Find the stones'),t('整盘运行一次，再在四个重叠局部各运行一次','One run on the whole board, plus one on each of four overlapping quarters')],[t('检查候选','Check candidates'),t('对齐网格并核对棋盘线，再检查大小、颜色和重影','Refit the grid and check the printed lines, then check size, colour and echoes')],[t('返回局面','Return the position'),t('返回棋盘和需要检查的点；照片不保存','Returns the board and points to check; the photo is not saved')]]];for(let i=0;i<rows.length;i++){const row=document.createElement('div');row.className='architecture-flow';for(const [title,body]of rows[i]){const box=document.createElement('div');box.className='architecture-node';const h=document.createElement('strong'),p=document.createElement('p');h.textContent=title;p.textContent=body;box.append(h,p);row.append(box);}figure.append(row);if(i<rows.length-1){const down=document.createElement('div');down.className='architecture-down';down.setAttribute('aria-hidden','true');down.textContent='↓';figure.append(down);}}const note=document.createElement('p');note.className='architecture-note';note.textContent=t('除浏览器压缩外，全部步骤在爱尔兰的一个 Lambda 函数中用 CPU 完成，普通照片约 6 秒返回，难读的照片约 10 秒。','Apart from compression in the browser, every step runs on CPU in one Lambda function in Ireland; a normal photo returns in about 6 seconds, a hard one in about 10.');figure.append(note);f.append(figure);}
function photoResults(f){f.append(part('测试结果','Test results',
 para('16 张照片：6 张用户的真实棋盘照片和 10 张网上照片。每张另做 11 种变化（变暗、模糊、旋转等），共 192 个样本。参考局面只用于评分。','16 photos: 6 real board photos from the user and 10 from the web. Each was also changed in 11 ways (darker, blurred, rotated and so on): 192 samples in all. Reference boards were used only for scoring.'),
 table([['照片','Photos'],['完全正确','Exact boards']],[
  [['用户照片：原照片','User photos, unchanged'],'5 / 6'],
  [['用户照片：全部样本','User photos, all samples'],'53 / 72'],
  [['网上照片：原照片','Web photos, unchanged'],'9 / 10'],
  [['网上照片：全部样本','Web photos, all samples'],'99 / 120']]),
 line('线上网站（2026-10-08）结果相同：用户照片中只有照片 5 有错，在反光处多出 2 颗白子。照片 6 的参考局面有 12 个点按照片目视改正。','Same on the live site (8 Oct 2026): among user photos only photo 5 had errors, 2 extra white stones on glare. Twelve reference points in photo 6 were corrected by eye.')));}
function photoAfter(f){f.append(
 part('局限','Limits',ul([
  ['阈值是看着这些照片调出来的，所以不是独立测试；16 张照片也不能代表所有棋盘、棋子和光线。','The thresholds were tuned on these photos, so this is not an independent test, and 16 photos cannot cover every board, stone set or light.'],
  ['反光几乎是纯白，容易被当成白子；剩下的错误大多是这种。','Glare is almost pure white and can be taken for a white stone; most remaining errors are this.'],
  ['角度很低时，高高的棋子会挡住后面的点。','At very low angles, tall stones hide the points behind them.'],
  ['解决这两个问题需要新的模型，目前不打算继续做。','Fixing either needs a new model; no more work is planned.']]),
  callout('camera',t('请尽量从正上方拍摄。分析前请始终对照照片检查。','Take the photo from above if you can. Always check the board against the photo before analysing.'))));}
function render(){const kind=document.body.dataset.document,page=pages[kind],title=t(...page.title);document.title=title+' · DL Weiqi';document.getElementById('document-title').textContent=title;const f=document.createDocumentFragment();page.intro?.(f);page.sections?.(f);page.extra?.(f);page.after?.(f);const h=document.createElement('h2');h.textContent=t(...(page.sourcesTitle??['参考与实测','Sources and measurements']));f.append(h);if(page.sourcesNote)f.append(para(...page.sourcesNote));const nav=document.createElement('nav');nav.className='page-links';for(const [href,zh,en]of page.links){const a=document.createElement('a');a.href=href;a.textContent=t(zh,en);nav.append(a);}f.append(nav);document.getElementById('document-content').replaceChildren(f);}
window.addEventListener('site-language-change',render);render();
