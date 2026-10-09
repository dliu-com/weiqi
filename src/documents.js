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
 cost:{title:['网站运行成本','Site running costs'],intro:costSummary,extra:costDetails,links:[['/benchmarks','基准实验','Benchmark experiments'],['https://aws.amazon.com/ec2/pricing/on-demand/','AWS EC2 价格','AWS EC2 pricing'],['https://aws.amazon.com/lambda/pricing/','AWS Lambda 价格','AWS Lambda pricing'],['https://aws.amazon.com/s3/pricing/','AWS S3 价格','AWS S3 pricing'],['https://aws.amazon.com/dynamodb/pricing/','AWS DynamoDB 价格','AWS DynamoDB pricing'],['https://aws.amazon.com/cloudfront/pricing/','AWS CloudFront 价格','AWS CloudFront pricing']]},
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
 f.append(callout('shield',t('2026 年 10 月 8 日审查，并测试了线上网站；这不是安全认证。这是公开网站：在设定限额内被滥用，是可接受的设计选择。','Reviewed and tested on the live site on 8 October 2026; this is not a certification. This is a public site: abuse within the set limits is an accepted design choice.')));
 f.append(tiers({title:t('信任边界','Trust boundaries'),rows:[
  {badge:t('不可信','Untrusted'),label:t('互联网','Internet'),tone:'untrusted',nodes:[{icon:'user',title:t('访客','Visitors'),text:t('无须登录','No sign-in')},{icon:'bot',title:t('机器人 / 攻击者','Bots / attackers'),text:t('同样的公开权限','Same public access')}]},
  {link:'HTTPS',badge:t('边缘','Edge'),label:'CloudFront',tone:'edge',nodes:[{icon:'cloudfront',title:'CloudFront',text:t('仅 HTTPS · HSTS · CSP','HTTPS only · HSTS · CSP')},{icon:'filter',title:'ApiViewer',text:t('标记连接网络，不保存 IP','Tags the network; IP not stored')},{icon:'lock',title:'OAC',text:t('签名访问源站','Signs requests to origins')}]},
  {link:t('只有 CloudFront 能调用','Only CloudFront can call'),badge:'API',label:t('检查与限额','Checks and limits'),tone:'app',nodes:[{icon:'lambda',title:'Lambda API',text:t('来源 · JSON · 大小 · SGF','Origin · JSON · size · SGF')},{icon:'gauge',title:t('限额','Limits'),text:t('每个连接 + 全站','Per connection + site-wide')},{icon:'budget',title:t('费用保护','Spending guard'),text:t('每天 $15 · 每月 $50','$15 / day · $50 / month')}]},
  {link:'IAM',badge:t('私有','Private'),label:t('数据与计算','Data and compute'),tone:'private',nodes:[{icon:'dynamodb',title:'DynamoDB',text:t('条件写入 · 时间点恢复','Conditional writes · PITR')},{icon:'s3',title:'S3',text:t('禁止公开访问 · 版本','No public access · versions')},{icon:'gpu',title:'Batch GPU',text:t('没有入站端口','No inbound ports')},{icon:'report',title:t('报告渲染','Report renderer'),text:t('阻止外部网络请求','Blocks outside requests')}]}
 ],note:t('公开源码不含 AWS 密钥；所有 AWS 权限来自服务器 IAM 角色。','Public code holds no AWS keys; all AWS access comes from server IAM roles.')}));
 const h=document.createElement('h2');h.textContent=t('公开限额','Public limits');f.append(h);
 f.append(stats([[t('60 次 / 分钟','60 / min'),t('每个连接的修改','edits per connection'),'gauge'],[t('120 次 / 分钟','120 / min'),t('全站修改','edits, site-wide'),'gauge'],[t('500 次 / 天','500 / day'),t('每个连接的 AI 分析','AI analyses per connection'),'katago'],[t('2,000 次 / 天','2,000 / day'),t('全站 AI 分析','AI analyses, site-wide'),'katago'],[t('10 局 / 天','10 / day'),t('深度 AI 棋局','deep AI games'),'gpu'],[t('100 局 / 天','100 / day'),t('新棋谱','new records'),'library']]));
 const p=document.createElement('p');p.className='dg-note';p.textContent=t('“连接”指一个 IPv4 地址或一个 IPv6 /64 网络；只保存哈希桶编号，不保存 IP。','A “connection” is one IPv4 address or one IPv6 /64 network. Only a hashed bucket number is stored, never the IP.');f.append(p);
}
function securityExtra(f){
 const heading=(zh,en)=>{const h=document.createElement('h2');h.textContent=t(zh,en);f.append(h);};
 const pass=['✓ 通过','✓ Pass'],fixed=['✓ 已修复','✓ Fixed'];
 heading('线上渗透测试','Live penetration test');
 f.append(table([['测试','Test'],['结果','Result'],['状态','Status']],[
  [['HTTPS 与 TLS','HTTPS and TLS'],['HTTP → HTTPS 301；拒绝 TLS 1.1；HSTS 1 年','HTTP → HTTPS 301; TLS 1.1 refused; HSTS 1 year'],pass],
  [['安全头','Security headers'],['CSP 禁止内联脚本、禁止嵌入、nosniff、来源策略','CSP blocks inline script; framing denied; nosniff; referrer policy'],pass],
  [['隐藏文件','Hidden files'],['/.git、/.env、源码映射、目录列表 → 404','/.git, /.env, source maps, directory listing → 404'],pass],
  [['HTTP 方法','HTTP methods'],['PUT / DELETE / PATCH / TRACE → 405','PUT / DELETE / PATCH / TRACE → 405'],pass],
  [['跨站修改','Cross-site writes'],['其他来源 → 403；text/plain → 415','Foreign origin → 403; text/plain → 415'],pass],
  [['错误输入','Bad input'],['坏 JSON、原型污染、非法局面 → 400，不占用额度','Broken JSON, prototype pollution, bad positions → 400, no quota used'],pass],
  [['路径技巧','Path tricks'],['路径穿越 → 404；空字节 → 400','Path traversal → 404; null byte → 400'],pass],
  [['绕过 CloudFront','Bypass CloudFront'],['直接访问 Lambda URL 和 S3 → 403','Lambda URL and S3 directly → 403'],pass],
  [['伪造客户端头','Spoofed client header'],['CloudFront 覆盖 x-weiqi-viewer','CloudFront overwrites x-weiqi-viewer'],pass],
  [['重放局面请求','Replayed position request'],['→ 429','→ 429'],pass],
  [['一个客户端突发 70 次修改','One client sends 70 edits'],['之前：全站修改暂停。现在：60 次后只限制该连接','Before: paused edits for everyone. Now: only that connection is limited after 60'],fixed],
  [['并行修改','Parallel edits'],['之前：误报“网站繁忙”。现在：原子计数','Before: false “busy” errors. Now: atomic counter'],fixed],
  [['错误的棋谱库翻页参数','Bad library page cursor'],['之前：500。现在：400','Before: 500. Now: 400'],fixed],
  [['依赖','Dependencies'],['线上运行 0 个告警；CDK 构建工具 1 个（不在线上运行）','0 runtime advisories; 1 in the CDK build tool (not run live)'],pass]
 ]));
 heading('威胁模型','Threat model');
 f.append(table([['场景','Scenario'],['剩余风险','Residual risk'],['防护 / 限制','Controls / limits']],[
  [['访客清空共享草稿','Visitor clears shared draft'],['高 · 设计允许','High · allowed by design'],['公开协作、版本冲突检查、S3 版本；没有个人所有权','Public collaboration, revision checks, S3 versions; no ownership']],
  [['多 IP 机器人用完公开额度','Many-IP bot uses up public limits'],['高 · 接受','High · accepted'],['全站每日上限、费用保护；读取与流量费用仍可能增加','Site-wide daily caps, spending guard; read and transfer charges remain']],
  [['一个客户端刷修改或 AI','One client floods edits or AI'],['低 · 本次已修复','Low · fixed in this review'],['每个连接：修改 60 次 / 分钟，AI 分析 500 次 / 天','Per connection: 60 edits / min, 500 AI analyses / day']],
  [['SGF 名称或注释注入脚本','SGF name/comment script injection'],['较低 · 已测试','Lower · tested'],['文本节点、输入限额、CSP 禁止内联脚本','Text nodes, bounded input, CSP blocks inline script']],
  [['绕过网站访问私有资源','Bypass site to reach private AWS'],['较低 · 测试中被拒绝','Lower · denied in tests'],['私有 S3、IAM Lambda URL、OAC、GPU 无入站','Private S3, IAM function URL, OAC, no GPU inbound']],
  [['报告渲染访问外部网址','Report renderer fetches outside URLs'],['较低 · 已测试','Lower · tested'],['拦截所有外部请求，只读取本地文件','All outside requests blocked; local files only']],
  [['并发覆盖 / 重复保存','Concurrent overwrite / duplicate save'],['较低 · 已测试','Lower · tested'],['条件写入、上传 UUID 幂等、已保存棋谱不可公开覆盖','Conditional writes, UUID idempotency, immutable saved records']]
 ]));
 heading('接受的剩余风险','Accepted residual risks');
 const list=document.createElement('ul');
 for(const [zh,en]of [['多 IP 分布式滥用仍可用完全站额度；AI 暂停到第二天。','Distributed abuse from many IPs can still use up site-wide limits; AI then pauses until the next day.'],['任何人都可以修改或清空现场棋局和草稿。棋局链接不保密，棋谱库公开。请不要上传私人信息。','Anyone can change or clear the live game and draft. Game links are not secret, and the library is public. Do not upload private information.'],['对弈同步、读取和流量费用没有硬上限（见网站运行成本）；没有 WAF 或验证码。','No hard cap on live-play, read or transfer charges (see Site running costs); no WAF or CAPTCHA.'],['大范围分享前，应考虑增加登录或邀请，以及 WAF 或验证码。','Before sharing widely, consider sign-in or invitations, and WAF or CAPTCHA.']]){const li=document.createElement('li');li.textContent=t(zh,en);list.append(li);}
 f.append(list);
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
