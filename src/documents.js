import './site-shell.js';import {t} from './i18n.js';import {tiers,flow,stats,callout,more} from './flow-diagram.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const say=v=>typeof v==='string'?v:t(...v),dash='—';
const ul=items=>{const list=el('ul','doc-list');for(const item of items)list.append(el('li','',say(item)));return list;};
const para=(zh,en)=>el('p','',t(zh,en)),line=(zh,en)=>el('p','table-note',t(zh,en));
const block=(zh,en,...nodes)=>{const s=el('section','cost-detail');s.append(el('h3','',t(zh,en)),...nodes);return s;};
const part=(zh,en,...nodes)=>{const s=el('section');s.append(el('h2','',t(zh,en)),...nodes);return s;};
const costFlows=[
 {href:'/game',name:['棋谱库','Game library'],path:['保存棋谱 → GPU 逐手 AI 复盘 → 报告','Save a game → GPU AI review of every move → report'],
  cost:[[['深度分析与报告','Deep analysis and report'],['US$0.50–0.75 / 局','US$0.50–0.75 / game']],[['只有快速分析','Quick analysis only'],['约 US$0.05 / 局','about US$0.05 / game']]],
  limits:[[['深度分析与报告','Deep analysis and report'],['10 局 / 天','10 games / day']],[['快速分析','Quick analysis'],['每局新棋谱','Every new game']],[['新棋谱','New games'],['100 局 / 天','100 / day']],[['修改','Edits'],['120 次 / 分钟；每个连接 60 次','120 / min; 60 per connection']],[['失败重试','Retries'],['最多 2 次','Up to 2']],[['任务超时','Job timeout'],['2 小时','2 hours']]],
  note:['全站共用；每日额度按伦敦时间零点重置。超过深度额度的棋谱仍有快速分析，但没有报告。','Site-wide; daily limits reset at midnight London time. Games over the deep limit still get quick analysis, but no report.']},
 {href:'/analysis',name:['AI 分析','AI analysis'],path:['照片 → 识别棋子 → AI 分析一个局面（CPU）','Photo → recognise stones → AI analyses one position (CPU)'],
  cost:[[['照片识别','Photo recognition'],['US$0.0004 / 次','US$0.0004 each']],[['AI 分析','AI analysis'],['US$0.00015 / 次','US$0.00015 each']]],
  limits:[[['每日额度','Daily allowance'],['2,000 次（US$3）','2,000 requests (US$3)']],[['每个连接','Per connection'],['500 次 / 天','500 / day']],[['照片','Photo'],['< 50 MB，≤ 7,000 万像素','< 50 MB, ≤ 70 MP']],[['时间上限','Time limit'],['识别 20 秒，AI 20 秒','Recognition 20 s, AI 20 s']]],
  note:['全站共用；每次请求按 US$0.0015 计入，UTC 零点重置。','Site-wide; each request counts as US$0.0015; resets at 00:00 UTC.']}
];
const pages={
 cost:{title:['费用估算','Cost estimate'],intro:costSummary,extra:costDetails,links:[['/benchmarks','基准实验','Benchmark experiments'],['https://aws.amazon.com/ec2/pricing/on-demand/','AWS EC2 价格','AWS EC2 pricing'],['https://aws.amazon.com/vpc/pricing/','AWS IPv4 价格','AWS IPv4 pricing'],['https://aws.amazon.com/lambda/pricing/','AWS Lambda 价格','AWS Lambda pricing'],['https://aws.amazon.com/s3/pricing/','AWS S3 价格','AWS S3 pricing'],['https://aws.amazon.com/dynamodb/pricing/','AWS DynamoDB 价格','AWS DynamoDB pricing']]},
 security:{title:['安全审查','Security review'],intro:securityOverview,extra:securityExtra,links:[['https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html','OWASP API 安全','OWASP REST security'],['https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html','OWASP 输入验证','OWASP input validation'],['https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html','OWASP XSS 防御','OWASP XSS prevention']]},
 photo:{title:['照片识别原理','How photo recognition works'],intro:photoIntro,sections:photoSections,extra:photoResults,after:photoAfter,sourcesTitle:['参考与源码','Sources and code'],links:[['/analysis','照片分析','Photo analysis'],['https://github.com/kaya-go/moku','Moku 源代码','Moku source code'],['https://huggingface.co/kaya-go/moku-v4','Moku v4 模型','Moku v4 model'],['/photo-assets/photo-source.tar.gz','下载本站识别源码','Download this site’s recognition source'],['https://onnxruntime.ai/','ONNX Runtime','ONNX Runtime']]}
};
function costList(title,rows,className){const f=document.createDocumentFragment(),h=document.createElement('h3'),list=document.createElement('dl');h.textContent=t(...title);list.className='cost-list'+(className?' '+className:'');for(const [label,value]of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=t(...label);dd.textContent=t(...value);list.append(dt,dd);}f.append(h,list);return f;}
function costSummary(f){const lead=document.createElement('p');lead.className='cost-lead';lead.textContent=t('按用量计费，没有固定月费。金额为美元估算，未扣免费额度，未含税。','Pay per use, with no fixed monthly fee. USD estimates before free tiers and tax.');const grid=document.createElement('div');grid.className='cost-flows';costFlows.forEach((flow,i)=>{const card=document.createElement('section'),h=document.createElement('h2'),number=document.createElement('span'),link=document.createElement('a'),path=document.createElement('p'),note=document.createElement('p');card.className='cost-flow';number.className='cost-flow-number';number.textContent=String(i+1);link.href=flow.href;link.textContent=t(...flow.name);h.append(number,link);path.className='cost-flow-path';path.textContent=t(...flow.path);note.className='cost-flow-note';note.textContent=t(...flow.note);card.append(h,path,costList(['费用','Cost'],flow.cost,'cost-price'),costList(['限额','Limits'],flow.limits),note);grid.append(card);});f.append(lead,grid,flow({title:t('两个流程共用的费用保护','Spending guard for both flows'),steps:[
  {icon:'budget',title:'AWS Budgets',text:t('每天 $15 · 每月 $50','$15 / day · $50 / month')},
  {icon:'lambda',title:t('保护程序','Guard Lambda'),text:t('超额时运行','Runs when exceeded')},
  {icon:'shield',title:t('暂停 AI','Pause AI'),text:t('停止 GPU 队列与任务','Stops GPU queue and jobs'),tone:'bad'},
  {icon:'check',title:t('仍可复盘','Replay still works'),text:t('棋谱与报告保留','Games and reports stay'),tone:'good'}
 ],note:t('暂停后须由管理员手动恢复 AI，不会自动恢复。','An administrator must resume AI; it does not restart automatically.')}));}
function costDetails(f){
 const groups=[
  ['1 棋谱库：细节','1 Game library: details',[
   block('实测完整棋局','Measured full game',
    para('实测一局 321 手的棋局，两个阶段使用同一模型。样本不保证未来模型或排队速度。','One measured 321-move game, same model for both passes. This sample does not guarantee future model or queue performance.'),
    table([['阶段','Pass'],['访问次数','Visits'],['用时','Time'],['费用','Cost']],[
     [['快速','Quick'],'32',['约 3 分 29 秒（入队到结果）','about 3m 29s (queue entry to results)'],['已含在深度的 $0.45 中（共用一台实例，不能相加）','Included in the deep $0.45 (same machine; do not add)']],
     [['深度','Deep'],'3,000',['约 45 分 35 秒（引擎约 42 分 3 秒）','about 45m 35s (about 42m 3s in the engine)'],['完成时累计约 $0.45（计算、IP、磁盘）','about $0.45 in total at finish (compute, IP, disk)']],
     [['现在：快速分析单独用一台 T4','Now: quick analysis on its own T4'],dash,dash,['每局约多 $0.05','about $0.05 more per game']],
     [['规划预算：加上释放前的启动 / 空闲尾段及报告','Plan: add startup/idle time until retirement, and the report'],dash,dash,['约 $0.50–$0.75 / 局','about $0.50–$0.75 / game']]])),
   block('GPU 价格与后备 GPU','GPU prices and fallback GPU',
    para('AWS 官方爱尔兰 Linux 按需报价，2026-10-06 查询。','Official AWS Ireland Linux On-Demand prices, checked on 6 October 2026.'),
    table([['项目','Item'],['实例','Instance'],['每小时','Per hour'],['用途','Role'],['250 手、深度 3,000 次访问','250 moves, 3,000 deep visits']],[
     ['A10G','g5.xlarge','$1.123',['首选','First choice'],['约 15 分钟，约 $0.29','about 15 min, about $0.29']],
     ['T4','g4dn.xlarge','$0.587',['后备','Backup'],['约 36 分钟，约 $0.37 *','about 36 min, about $0.37 *']],
     [['公共 IPv4','Public IPv4'],dash,'$0.005',dash,dash],
     [['磁盘','Disk'],dash,['$0.02（预留）','$0.02 (reserve)'],['按实例小时预留；以实际大小和保留时间结算','Per instance-hour; actual size and retention set the bill'],dash]]),
    line('* 实测：304 手的棋局在 T4 上引擎用时 40 分钟。棋局费用尚未加小额服务费。低于 $1 是正常成功流程的目标，不是每次后备或重试的承诺。','* Measured: a 304-move game used 40 minutes of T4 engine time. Game costs are before small service charges. Below $1 is a target for normal successful operation, not a promise for every fallback or retry.')),
   block('GPU 以外','Beyond GPU',
    table([['项目','Item'],['费用','Cost']],[
     [['报告 Lambda（2 GB）','Report Lambda (2 GB)'],['通常几秒至几十秒；运行 30 秒 = 60 GB·秒，约 $0.001（按约 $0.0000167 / GB·秒），再加请求','Usually seconds to tens of seconds; 30 s = 60 GB-seconds, about $0.001 (at an indicative $0.0000167/GB-second), plus requests']],
     [['大草稿自动保存','Large draft autosaves'],['每次按 DynamoDB 的 KB 写入单位收费；建议避免长时间密集修改','Each is charged in DynamoDB KB write units; avoid long, heavy editing']],
     [['API Lambda、DynamoDB 请求、SQS、S3 读写、CloudFront、日志、容器仓库、外网传输','API Lambda, DynamoDB requests, SQS, S3 operations, CloudFront, logs, container registry, outbound traffic'],['按用量计费；文件大小、浏览次数和草稿编辑次数决定费用','Usage-billed; file sizes, visits and draft edits set the cost']],
     [['浏览量很大时','Heavy viewing traffic'],['另算传输费用','Needs a separate transfer estimate']],
     [['每局保守预留','Conservative allowance per game'],['额外 $0.01–$0.05','Another $0.01–$0.05']]])),
   block('月度示例','Monthly examples',
    table([['用量','Usage'],['费用','Cost']],[
     [['每月 10 局深度分析','10 deep games a month'],['约 $5–$7.50 / 月','about $5–$7.50 / month']],
     [['每月 100 局深度分析','100 deep games a month'],['约 $50–$75 / 月','about $50–$75 / month']],
     [['每日上限用满：10 局深度 + 90 局只有快速分析','A day at every limit: 10 deep + 90 quick-only games'],['约 $9.50–$12 / 天','about $9.50–$12 / day']],
     [['再加照片与局面分析','Plus photos and positions'],['最多 $3 / 天','up to $3 / day']],
     [['合计：所有上限用满','Total at every limit'],['约 $12.50–$15 / 天','about $12.50–$15 / day']],
     [['没有分析','No analyses'],['GPU 费用为零；存储和访问仍有少量费用','GPU cost is zero; storage and visits still cost a little']]]),
    line('按每局深度分析 $0.50–$0.75 计算。每天 $15 和每月 $50 的费用保护会先暂停 AI；约 4 个上限用满的日子就用满月度额度。','At $0.50–$0.75 per deep game. The $15 daily and $50 monthly guards pause AI first; about 4 days at every limit use the monthly amount.'))]],
  ['2 AI 分析：细节','2 AI analysis: details',[
   block('实测费用','Measured cost',
    para('两个步骤都用 CPU 运行，请求之间不运行任何程序。AI 分析使用 300 次访问；普通照片约 5.5 秒。','Both steps run on CPU; nothing runs between requests. AI analysis uses 300 visits; a normal photo takes about 5.5 s.'),
    table([['',''],['每次','Each'],['每 1,000 次','Per 1,000'],['内存 × 平均时间','Memory × average time']],[
     [['照片识别','Photo recognition'],'US$0.0004','US$0.42','3.5 GB × 7.3 s'],
     [['AI 分析','AI analysis'],'US$0.00015','US$0.15','3 GB × 3.0 s'],
     [['两者各 1,000 次','1,000 of each'],dash,['约 US$0.57','about US$0.57'],dash]]),
    line('实测于 AWS Lambda（爱尔兰），含冷启动；CloudFront 和日志另有极少费用。','Measured on AWS Lambda in Ireland, including cold starts; CloudFront and logs add a tiny amount.')),
   block('每日额度如何计算','How the daily allowance works',
    stats([[t('2,000 次 / 天','2,000 / day'),t('全站，每天（UTC）US$3','site-wide, US$3 per UTC day'),'katago'],[t('500 次 / 天','500 / day'),t('每个连接','per connection'),'gauge'],['US$0.0015',t('每次识别或分析请求计入','counted per recognition or analysis request'),'budget']]),
    ul([['US$0.0015 高于单次请求的最坏情况：识别运行满 20 秒，约 US$0.0013。','US$0.0015 is above the worst case for one request: a recognition that runs the full 20 seconds, about US$0.0013.'],
     ['用完后两个步骤都暂停到下一个 UTC 日。','When it runs out, both steps pause until the next UTC day.'],
     ['云端只保存含哈希、一天后过期的请求记录和每日计数，不保存照片和局面。','The cloud keeps only a request record with a hash, which expires after one day, and the daily count; photos and positions are not stored.']]))]],
  ['两个流程共用','Both flows',[
   block('按用量计费','Usage billing',ul([
    ['没有常驻 GPU、NAT 网关或新增固定月费订阅。','No always-running GPU, NAT gateway or added fixed monthly subscription.'],
    ['GPU 最小容量为零，任务完成后自动停止并释放实例。','GPU capacity scales from zero; instances retire after jobs.'],
    ['保留的 S3 文件、版本、DynamoDB 数据及时间点恢复仍按存储用量计费，即使没人访问。','Retained S3 files and versions, DynamoDB data and point-in-time recovery still incur storage charges, even with no visits.'],
    ['现有域名和 DNS 费用不属于本应用新增费用。','Existing domain and DNS charges are outside this app’s added cost.'],
    ['金额均为美元估算，未扣免费额度或优惠，也未含税。','Figures are USD estimates before free tiers, credits and tax.']])),
   block('费用保护','Spending guard',ul([
    ['Weiqi 的 CloudFormation 栈与可标记资源使用 Project=Weiqi 标签。','Weiqi CloudFormation stacks and supported resources carry the tag Project=Weiqi.'],
    ['AWS Budgets 按实际费用跟踪：每天（UTC）$15，每个日历月 $50。','AWS Budgets track actual spending: $15 per UTC day and $50 per calendar month.'],
    ['任一超过时，私有保护程序暂停两个流程的新 AI，禁用 GPU 队列，并终止待运行和运行中的棋局任务。','When either is exceeded, a private guard pauses new AI in both flows, disables the GPU queues and stops queued and running game jobs.'],
    ['棋谱仍可保存、复盘，已有报告仍可下载。','Saving and replaying games and downloading existing reports keep working.'],
    ['账单数据有延迟，未标记的共享资源可能不计入，因此两者都不是账单硬上限。','Billing data is delayed and untagged shared resources may be missed, so neither figure is a hard bill ceiling.']])),
   block('费用风险','Spending risk',ul([
    ['限额按棋局和请求计数，不是美元上限。','Limits count games and requests, not dollars.'],
    ['重试、后备 GPU、更大的新模型、长时间运行或恶意访问都可能提高账单。','Retries, the fallback GPU, larger future models, long runs or abusive traffic can raise the bill.'],
    ['两小时任务超时用于处理卡住的任务，不是费用保护。','The two-hour job timeout handles stuck jobs; it is not spending protection.'],
    ['开发调试总预算（$50）另行记录，不按棋局重置。','The development and debugging budget ($50 total) is tracked separately and is not reset per game.']]))]]
 ];
 for(const [zh,en,blocks]of groups)f.append(el('h2','',t(zh,en)),...blocks);
}
function table(headers,rows){const wrapper=document.createElement('div');wrapper.className='document-table';const table=document.createElement('table'),head=document.createElement('tr');for(const [zh,en]of headers){const th=document.createElement('th');th.textContent=t(zh,en);head.append(th);}table.append(head);for(const row of rows){const tr=document.createElement('tr');for(const cell of row){const td=document.createElement('td');td.textContent=say(cell);tr.append(td);}table.append(tr);}wrapper.append(table);return wrapper;}
function securityOverview(f){
 f.append(callout('shield',t('2026 年 10 月 8 日审查，并测试了线上网站。这是公开网站：在设定限额内被滥用，是可接受的设计选择。','Reviewed and tested on the live site on 8 October 2026. This is a public site: abuse within the set limits is an accepted design choice.')));
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
 for(const [zh,en]of [['多 IP 分布式滥用仍可用完全站额度；AI 暂停到第二天。','Distributed abuse from many IPs can still use up site-wide limits; AI then pauses until the next day.'],['任何人都可以修改或清空现场棋局和草稿。','Anyone can change or clear the live game and draft.'],['读取与流量费用没有硬上限；没有 WAF 或验证码。','No hard cap on read and transfer charges; no WAF or CAPTCHA.'],['小问题：413 错误显示 AWS 文字；没有 security.txt；HSTS 不含子域名（父域名 dliu.com 另有用途）。','Minor: 413 errors show AWS text; no security.txt; HSTS excludes subdomains (the parent dliu.com is used elsewhere).']]){const li=document.createElement('li');li.textContent=t(zh,en);list.append(li);}
 f.append(list);
 const detail=document.createDocumentFragment();
 detail.append(
  block('公开源码不等于 AWS 访问权限','Public code does not grant AWS access',ul([
   ['公开源码让任何人了解 URL、API、限额和架构，但不提供 AWS 凭据。','Public source reveals URLs, APIs, quotas and architecture, but grants no AWS credentials.'],
   ['浏览器只能调用公开应用 API；私有 S3、DynamoDB 和工作队列由 IAM 控制。','Browsers can call only the public app API; IAM controls private S3, DynamoDB and worker queues.'],
   ['检查了源码、浏览器资源和部署模板，没有发现暴露的 AWS 密钥；访问身份由服务器 IAM 角色提供。','Source, browser assets and deployment templates were checked for exposed credentials; server IAM roles supply the AWS identity.'],
   ['云资源名称及账号编号不是密码。','Resource names and account IDs are not passwords.'],
   ['本审查不是安全认证，也不是永久保证。','This review is not a certification or a permanent guarantee.']])),
  block('最主要的设计风险：公开编辑','Main design risk: public editing',table([['项目','Item'],['现状','How it works']],[
   [['现场棋局和记录草稿','Live game and recording draft'],['任何人可修改或清空','Anyone can edit or clear them']],
   [['每日分析额度','Daily analysis slots'],['任何人可消耗','Anyone can use them up']],
   [['登录、所有权、邀请权限','Login, ownership, invitations'],['没有：这是本站选择的公开协作模式','None: public collaboration is intentional']],
   [['棋局链接','Game links'],['不是保密链接：序号可猜测，库内棋局可公开浏览','Not secret: IDs are predictable and library games are publicly browsable']],
   [['草稿冲突','Draft conflicts'],['版本冲突检查拒绝覆盖','Revision checks reject conflicting overwrites']],
   [['数据恢复','Data recovery'],['S3 版本和 DynamoDB 时间点恢复帮助管理员恢复；不是用户自己的恢复按钮','S3 versions and DynamoDB point-in-time recovery help the administrator; not a user undo button']],
   [['已保存棋谱','Saved records'],['没有公开覆盖或删除 API','No public overwrite or delete API']]]),
   line('不要上传私人信息。','Do not upload private information.')),
  block('输入与浏览器保护','Input and browser protections',table([['输入','Input'],['限制 / 检查','Limit / check']],[
   [['SGF 文件','SGF file'],['只接受 UTF-8、19 路、256 KB 以内','UTF-8 only, 19 × 19, up to 256 KB']],
   [['SGF 内容','SGF content'],['最多 2,000 个局面、100 层变化；检查非法坐标、占用点和棋谱结构','Up to 2,000 positions and 100 variation levels; structure, illegal coordinates and occupied moves checked']],
   [['API 请求','API requests'],['限制请求体，检查 JSON 和来源；拒绝其他站点的浏览器修改请求','Body size limited, JSON required; mutations from other browser origins rejected']],
   [['名称、注释、错误','Names, comments, errors'],['用文本节点显示，不把 SGF 内容作为 HTML 执行','Shown as text nodes, not SGF-supplied HTML']],
   [['报告','Reports'],['由受控工作程序生成；访问只读取已生成文件','A controlled worker creates them; viewing retrieves prepared files']],
   [['浏览器保护','Browser protection'],['HTTPS、HSTS、CSP、禁止嵌入框架、nosniff、来源策略','HTTPS, HSTS, CSP, frame denial, nosniff, referrer controls']],
   [['内联代码','Inline code'],['允许内联样式（棋盘及静态报告需要）；不允许内联脚本','Inline styles allowed (for boards and reports); inline scripts blocked']]])),
  block('计算滥用与拒绝服务','Compute abuse and denial of service',table([['资源','Resource'],['限制','Control']],[
   [['深度 AI 棋局','Deep AI games'],['原子每日额度，每天 10 局；其余棋局只有快速分析','Atomic daily reservations, 10 a day; other games get quick analysis only']],
   [['上传','Uploads'],['UUID 幂等，避免重复保存或重复占用额度','UUID idempotency prevents duplicate records and repeated quota use']],
   [['新棋谱','New records'],['每天 100 个，限制文件增长','100 a day, bounding file growth']],
   [['修改','Edits'],['每个连接 60 次 / 分钟，全站 120 次 / 分钟','60 / min per connection, 120 / min site-wide']],
   [['局面分析','Position analysis'],['每个连接每天 500 次（全站额度的 25%）','500 / day per connection (25% of the site allowance)']],
   [['计数器','Counters'],['原子、自动过期的记录；只保存哈希桶编号，不保存 IP','Atomic, self-expiring rows; a hashed bucket is stored, not the IP']],
   [['API Lambda 并发','API Lambda concurrency'],['使用账户的区域并发额度（当前为 400，与其他函数共享），未单独预留','Shares the account’s regional quota (currently 400) with other functions; no separate reservation']],
   [['GPU','GPU'],['从零扩容，无 CPU 后备，失败最多重试两次','Scales from zero; no CPU fallback; at most two retries']],
   [['查看棋谱、推荐变化或报告','Reading games, suggestions or reports'],['不触发分析','Starts no analysis']]]),
   ul([['攻击者仍可抢占公共额度、拖慢共享页面、制造大量读请求或传输费用。','Attackers can still use up public quotas, slow shared pages, and cause read or transfer charges.'],
    ['应用限流不能消除 DDoS，也不能保证账单硬上限。','App throttling cannot eliminate DDoS or enforce a hard bill cap.'],
    ['没有启用固定月费的 WAF 或 CAPTCHA。','No fixed-fee WAF or CAPTCHA is enabled.']])),
  block('基础设施与数据保护','Infrastructure and data protection',table([['部分','Part'],['保护','Protection']],[
   [['部署与区域','Deployment and region'],['CloudFormation 管理资源；应用计算在爱尔兰。CloudFront 和其必需的证书是全球服务例外','CloudFormation manages resources; application compute runs in Ireland. Global CloudFront and its required certificate are exceptions']],
   [['S3','S3'],['禁止公共存储桶访问并强制 TLS；网站只经 CloudFront OAC 分发','Public bucket access blocked and TLS enforced; the website is served only through CloudFront OAC']],
   [['Lambda URL','Lambda URL'],['使用 AWS IAM，由指定 CloudFront 分配调用','Uses AWS IAM; called by a designated CloudFront distribution']],
   [['GPU 任务','GPU workers'],['安全组无公网入站规则；用角色读取指定棋谱与保存结果，不接收用户 shell 命令','Security groups have no public inbound rules; roles read games and save results; no user shell commands']],
   [['模型','Models'],['只从代码规定的官方来源选择；SGF 不控制下载 URL','Chosen only from code-defined official sources; SGFs do not control download URLs']],
   [['WeiqiStorage','WeiqiStorage'],['独立，有终止保护、保留策略和数据库删除保护；本次仅添加项目标签，保留数据保护设置','Separate, with termination protection, retention and database deletion protection; this release only adds project tags and keeps its data protections']]])),
  block('验证范围与后续建议','Validation scope and follow-up',table([['范围','Scope'],['内容','Details']],[
   [['已检查','Checked'],['棋谱验证、路径穿越、覆盖拒绝、每日并发额度、公共草稿版本冲突、重复保存、跨来源修改、浏览器注入显示、HTTPS 安全头、私有桶、IAM URL 和网络入站配置','SGF validation, traversal, overwrite rejection, concurrent daily quotas, draft revision conflicts, duplicate saving, cross-origin mutations, displayed injection payloads, HTTPS headers, private buckets, IAM function URL, network ingress']],
   [['滥用与并发测试','Abuse and concurrency tests'],['使用本地隔离数据','Isolated local data']],
   [['线上网站（2026-10-08）','Live site (8 October 2026)'],['小规模渗透测试：安全头、方法、路径、来源、输入、直连源站，以及不超过 130 次的短时突发请求；不是压力攻击','Small penetration test: headers, methods, paths, origins, input, direct origin access and bursts of up to 130 requests; not a load attack']],
   [['未测试','Not tested'],['AWS 自身隔离；大型分布式攻击','AWS platform isolation; large distributed attacks']],
   [['适合','Suits'],['在当前公开模式下分享给朋友','Sharing with friends in the chosen public mode']],
   [['大规模公开推广前','Before broad promotion'],['建议增加登录或邀请权限、可选 WAF / 人机验证、更严格的流量防护；$50 月度分析停止机制已配置','Consider sign-in or invitations, optional WAF / human verification and stronger traffic controls; a $50 monthly analysis stop guard is already configured']]])));
 f.append(more(t('更多细节','More details'),detail));
}
function photoSections(f){
 f.append(
  part('上传与隐私','Upload and privacy',ul([
   ['浏览器先缩小照片：最长边不超过 3,072 像素，以 JPEG（质量 0.88）保存；若仍大于约 1 MB，就缩小到 80% 再试。','The browser first shrinks the photo: longest edge at most 3,072 pixels, saved as a JPEG at quality 0.88. If it is still over about 1 MB, it shrinks to 80% and tries again.'],
   ['原文件须小于 50 MB、不超过 7,000 万像素。','The original file must be under 50 MB and at most 70 megapixels.'],
   ['照片发送到爱尔兰（eu-west-1）的 Lambda 函数识别，不会写入 S3 或 DynamoDB。','The photo is sent to a Lambda function in Ireland (eu-west-1). It is never written to S3 or DynamoDB.'],
   ['云端只保存一条含请求哈希、一天后过期的请求记录，以及全站每日额度计数。','The cloud keeps only a request record with a hash, which expires after a day, and the shared daily allowance count.'],
   ['原照片只在你的页面中显示，方便对照。','The original photo is shown only in your page, for comparison.']])),
  part('识别模型','The recognition model',ul([
   ['Moku v4：kaya-go 的开源模型，由 RT-DETR 目标检测模型针对围棋棋盘照片微调而成。','Moku v4: an open-source model from kaya-go, an RT-DETR object detector fine-tuned on Go board photos.'],
   ['每次运行把图像缩放到 640 × 640，给出棋盘四个角，以及每颗黑子和白子的位置、大小和置信度，最多 300 个对象。','Each run scales the image to 640 × 640 and returns the board’s four corners plus the position, size and confidence of each black and white stone, up to 300 objects.'],
   ['模型为约 83 MB 的 ONNX 文件，在 Lambda 中用 CPU 运行，不需要 GPU（版本见技术细节）。','The model is an ONNX file of about 83 MB. It runs on CPU in Lambda; no GPU is needed (versions in Technical details).'],
   ['以下各步只使用 Moku 的输出和这张照片自身的像素。','Every step below uses only Moku’s output and the photo’s own pixels.']])),
  part('识别的四个步骤','The four steps',flow({numbered:true,steps:[
   {icon:'setup',title:t('找到并摆正棋盘','Find and square up the board'),text:t('四个角 → 800 × 800 正方形','Four corners → 800 × 800 square')},
   {icon:'eye',title:t('寻找棋子','Find the stones'),text:t('整盘 + 四个局部','Whole board + four quarters')},
   {icon:'retry',title:t('对齐网格','Refit the grid'),text:t('按棋子中心和棋盘线','To stone centres and printed lines')},
   {icon:'filter',title:t('排除误检','Reject false detections'),text:t('大小 · 颜色 · 重复 · 重影','Size · colour · duplicates · echoes')}]})),
  block('第 1 步：找到并摆正棋盘','Step 1: find and square up the board',ul([
   ['Moku 先在整张照片上找出四个角。','Moku first finds the four corners in the whole photo.'],
   ['找不到四个清晰的角时，把照片左右镜像再运行一次，合并两次找到的角点后重试。','No four clear corners: it runs again on a mirrored copy and retries with the corners from both runs combined.'],
   ['网格仍与棋子对不上时（例如低角度拍摄或很小的棋盘），在棋子最密集处周围最多六个正方形局部（部分经过旋转）上再运行 Moku，选出与棋子最吻合的网格；旋转最小的角点顺序当作棋盘正方向。','Grid still does not fit the stones (for example a low-angle photo or a small board): Moku runs on up to six square crops around the densest stones, some rotated, and the grid that best fits the stones is chosen. The corner order with the least rotation is taken as upright.'],
   ['透视变换把棋盘拉成 800 × 800 像素的正方形，四周留 64 像素边距，相邻交叉点相距约 37 像素。无论从哪个角度拍摄，19 × 19 个交叉点都落在固定位置。','A perspective transform turns the board into an 800 × 800-pixel square with a 64-pixel margin; neighbouring intersections are about 37 pixels apart. Whatever the camera angle, the 19 × 19 intersections sit at fixed positions.']])),
  block('第 2 步：寻找棋子','Step 2: find the stones',ul([
   ['接近终局的棋可能有近 300 颗棋子，而 Moku 每次最多返回 300 个对象，所以整盘只运行一次会漏子。','A board near the end of a game can hold close to 300 stones, but each Moku run returns at most 300 objects, so one run on the whole board missed stones.'],
   ['因此整个棋盘运行一次，再在四个相互重叠的 500 × 500 像素局部上各运行一次。','So Moku runs once on the whole board and once on each of four overlapping 500 × 500-pixel quarters.'],
   ['离局部内侧边缘不到 0.7 格的棋子可能被切开，交给其他几次运行处理。','Stones within 0.7 of a square of a quarter’s inner edge may be cut off, so they are left to the other runs.'],
   ['整盘置信度至少 3.5% 或局部至少 5% 的点成为候选；两类得分相加后决定颜色。','A point becomes a candidate at 3.5% confidence or more on the whole board, or 5% or more in a quarter; the scores are added to choose the colour.']])),
  block('第 3 步：对齐网格','Step 3: refit the grid',ul([
   ['棋子有厚度：斜着拍摄时，棋子中心看起来偏离棋盘表面的交叉点，离镜头越远偏得越多。','Stones have height: in an angled photo their centres appear shifted from the intersections, more so further from the camera.'],
   ['用置信度较高的棋子中心重新拟合网格（最多四轮），再把每个候选归到最近的交叉点；距离超过 0.35 格的候选先不采用。','The grid is refitted to the centres of confident stones (up to four rounds), and each candidate goes to its nearest intersection. Candidates more than 0.35 of a square away are not used at first.'],
   ['然后遮住棋子，检查棋盘上印的线：','Then the printed lines are checked, with the stones masked out:']]),
   table([['棋盘线','Printed lines'],['结果','Result']],[
    [['与网格一致','Agree with the grid'],['保留网格','Keep the grid']],
    [['两个方向的线和棋盘边缘都清楚，但不一致','Both directions and the board edges are clear but disagree'],['改用线的位置','Move the grid to the lines']],
    [['其他情况','Otherwise'],['报告“棋盘网格不确定”，而不是返回错误的棋盘','Report that the board grid is uncertain, rather than return a wrong board']]])),
  block('第 4 步：排除误检','Step 4: reject false detections',para('四项检查排除常见错误。','Four checks remove common errors.'),
   table([['检查','Check'],['规则','Rule'],['排除 / 原因','Removes / why']],[
    [['1 大小','1 Size'],['宽度小于高置信棋子中位宽度 89% 的候选不算棋子','Narrower than 89% of the median width of confident stones: not a stone'],['通常是贴纸或标记','Usually stickers or markers']],
    [['2 颜色','2 Colour'],['以附近 8 个可靠黑子、8 个可靠白子和 8 个明显空点为参照，统计候选中心区域的像素最接近哪一种。黑子需至少 50% 的像素最接近黑色，白子需 60%；不足时改试另一种颜色，仍不合格则判为空点','The nearest 8 reliable black stones, 8 reliable white stones and 8 clearly empty points are references; count which one each pixel in the candidate’s centre is closest to. Black needs at least 50% closest to black, white 60%. If short, the other colour is tried; if that also fails, the point is empty'],['参照取自同一张照片的附近位置，偏色和明暗不均的影响较小','References come from nearby points in the same photo, so colour casts and uneven lighting matter less']],
    [['3 重复','3 Duplicates'],['两颗相邻候选的中心相距不到 0.7 格时，只保留置信度较高的一颗','Two neighbouring candidates less than 0.7 of a square apart: keep only the more confident one'],['斜拍时，较高的棋子可能同时在相邻交叉点被识别','In an angled photo a tall stone can also be detected on the neighbouring point']],
    [['4 重影','4 Echoes'],['离较强棋子不到 0.9 格的较弱候选，只有在它自己的交叉点上显示该颜色时才保留','A weaker candidate less than 0.9 of a square from a stronger stone is kept only if its own intersection shows that colour'],['常是高棋子的重影或旁边的反光','Often an echo of a tall stone, or glare beside it']]]),
   line('最后，一颗单独、大小正常、离交叉点不到半格的棋子，如果通过颜色检查，也会放到最近的交叉点上。','Finally, a single stone of normal size up to half a square from an intersection is placed on the nearest point if it passes the colour check.')),
  part('需要检查的点','Points to check',para('识别完成后，需要检查的点在编辑模式下以琥珀色虚线框标出，点击修改后标记消失。以下情况会标记：','After recognition, points to check have an amber dashed outline in edit mode; it disappears when you tap the point. A point is marked when:'),
   ul([['颜色检查推翻了模型的判断','the colour check overruled the model'],['颜色比例只比要求高出不到 20 个百分点','the colour share was less than 20 percentage points above its requirement'],['置信度低于 5%','the confidence was below 5%'],['在此删除了重复识别或重影','a duplicate or echo was removed there'],['棋子是从交叉点外放进来的','the stone was placed from off the point']]),
   ul([['红色实线框表示没有气的棋子：实战中不可能出现，通常说明识别有误。','A solid red outline marks stones without liberties: this cannot occur in a real game and usually means a recognition error.'],['照片无法还原之前的棋步、提子或劫争。','A photo cannot reveal earlier moves, captures or ko.']])),
  part('准确率测试','Accuracy tests',table([['照片','Photos'],['数量','Count'],['参考局面','References'],['样本（含变化）','Samples (with changes)']],[
    [['用户的真实棋盘照片','Real board photos from the user'],'6',['由另一款独立的付费识别工具读出，并经用户确认 *','Read by a separate paid recognition tool and confirmed by the user *'],'72'],
    [['网上照片','Photos from the web'],'10',['人工抄写','Typed by hand'],'120']]),
   line('* 照片 6 右侧有 12 个点看起来错了一列，按照片目视改正，未经独立核实。','* In photo 6, 12 points on the right looked one column out and were corrected by eye from the photo; this was not checked independently.'),
   ul([['照片 5 低角度拍摄，有棋盒和手；照片 6 是一块较小、倾斜的电子棋盘。','Photo 5 is taken from a low angle, with bowls and hands; photo 6 is a small, tilted electronic board.'],
    ['每张照片另做 11 种合成变化：缩小、两档变暗、提亮、降低对比度、偏暖、偏冷、明暗不均、模糊、旋转 4° 和更强的 JPEG 压缩。这些变化不是新的棋局。','Each photo was also changed in 11 synthetic ways: smaller size, two darker levels, brighter, lower contrast, warmer, cooler, uneven lighting, blur, a 4° rotation and heavier JPEG compression. These changes are not new board positions.'],
    ['参考局面只用于评分，从不参与识别。','References are used only for scoring, never during recognition.'],
    ['上传处理与网页相同；本机时间在 Apple Silicon CPU 上单线程测得，不含上传和 Lambda 启动。','Uploads are prepared as on the page; local times were measured single-threaded on an Apple Silicon CPU and exclude upload and Lambda start-up.']])));
}
function photoIntro(f){const notice=document.createElement('p');notice.className='notice-box';notice.textContent=t('照片识别仍在试验中。它把一张 19 × 19 棋盘照片转成可编辑的局面，只是起点；分析前请对照原照片检查每一颗棋子。','Photo recognition is experimental. It turns a photo of a 19 × 19 board into an editable position as a starting point; check every stone against the photo before analysing.');f.append(notice);const figure=document.createElement('figure');figure.className='architecture-diagram';const caption=document.createElement('figcaption');caption.textContent=t('从照片到局面','From photo to position');figure.append(caption);const rows=[[[t('浏览器','Browser'),t('缩小并压缩照片：最长边不超过 3,072 像素，约 1 MB 以内','Shrinks and compresses the photo: longest edge up to 3,072 pixels, about 1 MB or less')],[t('找到棋盘','Find the board'),t('Moku v4 找出四个角；不确定时用镜像照片和局部放大重试','Moku v4 finds the four corners; if unsure, it retries with a mirrored copy and zoomed crops')],[t('摆正棋盘','Square up the board'),t('透视校正为 800 × 800 像素的正方形','Perspective-corrects the board to an 800 × 800-pixel square')]],[[t('寻找棋子','Find the stones'),t('整盘运行一次，再在四个重叠局部各运行一次','One run on the whole board, plus one on each of four overlapping quarters')],[t('检查候选','Check candidates'),t('对齐网格并核对棋盘线，再检查大小、颜色和重影','Refit the grid and check the printed lines, then check size, colour and echoes')],[t('返回局面','Return the position'),t('返回棋盘和需要检查的点；照片不保存','Returns the board and points to check; the photo is not saved')]]];for(let i=0;i<rows.length;i++){const row=document.createElement('div');row.className='architecture-flow';for(const [title,body]of rows[i]){const box=document.createElement('div');box.className='architecture-node';const h=document.createElement('strong'),p=document.createElement('p');h.textContent=title;p.textContent=body;box.append(h,p);row.append(box);}figure.append(row);if(i<rows.length-1){const down=document.createElement('div');down.className='architecture-down';down.setAttribute('aria-hidden','true');down.textContent='↓';figure.append(down);}}const note=document.createElement('p');note.className='architecture-note';note.textContent=t('除浏览器压缩外，全部步骤在爱尔兰的一个 Lambda 函数中用 CPU 完成，普通照片约 6 秒返回，难读的照片约 10 秒。','Apart from compression in the browser, every step runs on CPU in one Lambda function in Ireland; a normal photo returns in about 6 seconds, a hard one in about 10.');figure.append(note);f.append(figure);}
function photoResults(f){const title=document.createElement('h2');title.textContent=t('测试结果：旧版与当前版本','Test results: previous and current versions');f.append(title);const row=(zh,en,a,b)=>[[zh,en],Array.isArray(a)?a:[a,a],Array.isArray(b)?b:[b,b]];f.append(table([['指标','Measure'],['旧版','Previous'],['当前','Current']],[row('用户照片：原照片完全正确','User photos: exact boards, unchanged','4 / 6','5 / 6'),row('用户照片：原照片错误点数','User photos: wrong points, unchanged',['89，另 1 张失败','89, plus 1 failure'],'2'),row('用户照片：72 个样本完全正确','User photos: exact boards, all 72','43','53'),row('用户照片：识别失败','User photos: detection failures','13','0'),row('用户照片：漏掉 / 多出 / 颜色错误','User photos: missed / extra / wrong colour','954 / 52 / 15','9 / 39 / 1'),row('用户照片：被标为需要检查的错误','User photos: errors marked for checking',['1,021 个中的 34 个','34 of 1,021'],['49 个中的 12 个','12 of 49']),row('网上照片：原照片完全正确','Web photos: exact boards, unchanged','7 / 10','9 / 10'),row('网上照片：120 个样本完全正确','Web photos: exact boards, all 120','83','99'),row('网上照片：识别失败','Web photos: detection failures','24','5'),row('网上照片：错误点数','Web photos: wrong points','113','17'),row('本机识别时间','Local recognition time',['中位 2.2 秒，最长 2.9 秒','Median 2.2 s, up to 2.9 s'],['中位 2.3 秒，最长 5.5 秒','Median 2.3 s, up to 5.5 s'])]));photoTechnical(f);}
function photoTechnical(f){const exact=['完全正确','Exact'];f.append(el('h2','',t('技术细节','Technical details')),
 block('线上结果（2026-10-08，用户照片）','Live results (8 October 2026, user photos)',
  table([['照片','Photo'],['棋子数','Stones'],['结果','Result']],[['1','291',exact],['2','91',exact],['3','229',exact],['4','133',exact],['5','133',['多出 2 颗白子（N14、L13，在反光处）','2 extra white stones (N14, L13, on glare)']],['6','89',['完全正确 *','Exact *']]]),
  line('* 照片 6 的参考局面有 12 个点按照片目视改正，未经独立核实；原文件在本机无法读取，用另存的副本测试。','* For photo 6, 12 reference points were corrected by eye and not checked independently. The original file could not be read on this machine, so a re-saved copy was used.')),
 block('线上速度','Live speed',
  table([['内存','Memory'],['普通照片','Normal photo'],['难读照片','Hard photo'],['冷启动（往返）','Cold start (round trip)']],[[['1,769 MB（1 个 CPU）','1,769 MB (1 CPU)'],['9.2–9.6 秒','9.2–9.6 s'],['14.9–15.6 秒','14.9–15.6 s'],['16.4 秒','16.4 s']],[['3,538 MB（2 个 CPU，当前）','3,538 MB (2 CPUs, current)'],['5.3–5.7 秒','5.3–5.7 s'],['8.8–9.6 秒','8.8–9.6 s'],['10.3 秒','10.3 s']]]),
  line('普通和难读照片为已预热的 Lambda 内用时；往返再加约 0.5 秒（当前为 5.9–6.5 秒和 9.3–10.1 秒）。','Normal and hard photo times are inside a warm Lambda. The round trip adds about 0.5 s (now 5.9–6.5 s and 9.3–10.1 s).'),
  ul([['Lambda 按内存分配 CPU：改用 3,538 MB 后快约 1.65 倍，每张照片的费用只多约 17%。','Lambda gives CPU in proportion to memory: at 3,538 MB recognition is about 1.65 times faster, for about 17% more cost per photo.'],
   ['1.8 GB 时同样的照片需要 10–16 秒。','With 1.8 GB the same photos took 10–16 seconds.'],
   ['函数冷启动时再多约 4 秒。','A cold start adds about 4 seconds.'],
   ['最坏情况（运行 13 次）约 12 秒。识别 20 秒后超时，页面最多等待 30 秒。','The worst case, 13 runs, takes about 12 seconds. Recognition times out after 20 seconds, and the page waits at most 30 seconds.']])),
 block('费用与额度','Cost and allowance',ul([
  ['Lambda 按内存 × 运行时间计费。线上测试中平均计费 7.3 秒（含难读照片和冷启动），约 US$0.00042 / 张；普通照片约 US$0.00032。','Lambda bills memory × time. In live tests the average billed time was 7.3 seconds, including hard photos and cold starts: about US$0.00042 per photo. A normal photo costs about US$0.00032.'],
  ['每次识别或云端局面分析预留 US$0.0015，全站每天（UTC）共 US$3，即 2,000 次，每个连接最多 500 次；用完后当天暂停。','Each recognition or cloud position analysis reserves US$0.0015 from a site-wide allowance of US$3 per UTC day: 2,000 operations, at most 500 per connection. When it runs out, the feature pauses until the next day.'],
  ['项目的费用保护也可能暂停此功能。','The project’s spending safeguard can also pause it.'],
  ['AI 分析只在点击“分析当前局面”后开始。','AI analysis starts only when you click Analyse position.']])),
 block('软件与版本','Software and versions',
  table([['组件','Component'],['版本','Version']],[
   [['运行环境','Runtime'],['AWS Lambda，Python 3.12（x86_64）','AWS Lambda, Python 3.12 (x86_64)']],
   ['numpy','1.26.4'],['Pillow','11.1.0'],['ONNX Runtime',['1.20.1（2 个线程）','1.20.1 (2 threads)']],
   [['Moku v4 模型','Moku v4 model'],['kaya-go 版本 0449e6a，打包在函数中','kaya-go revision 0449e6a, packed into the function']],
   [['流程','Pipeline'],['lines-loose-20261008（上一版：tiled-colour-20261007）','lines-loose-20261008 (previous: tiled-colour-20261007)']]]),
  line('每次冷启动时核对模型的 SHA-256，不一致就拒绝运行。','The model’s SHA-256 is checked at each cold start; the function will not run if it does not match.'),
  table([['代码文件','Code file'],['作用','Role']],[['moku.py',['运行模型','Runs the model']],['grid.py',['找棋盘、在局部上重试并检查棋盘线','Finds the board, retries on crops and checks the grid lines']],['board.py',['读出每个交叉点','Reads each point']],['recognize.py',['把各步串起来','Joins the steps']]])),
 block('每张照片运行几次模型','Model runs per photo',
  table([['情况','Case'],['Moku 运行次数','Moku runs']],[
   [['普通照片：整张照片、摆正后的棋盘、四个局部','Normal photo: whole photo, squared board, four quarters'],'6 (1 + 1 + 4)'],
   [['找不到四个角：镜像照片','Four corners not found: mirrored copy'],'+1'],
   [['网格对不上：在局部上重试（难读的照片）','Grid does not fit: crop retries (hard photos)'],['约 9','about 9']],
   [['最多','Maximum'],'13']]),
  line('在本机一个 CPU 核心上，每次约 0.4 秒。','Each run takes about 0.4 seconds on one local CPU core.')),
 block('服务器检查','Server checks',
  para('服务器只接受浏览器缩小后的照片，并先按手机记录的方向（EXIF）把照片转正。','The server accepts only the copy made by the browser, and first turns it upright using the phone’s orientation tag (EXIF).'),
  table([['检查','Check'],['限制','Limit']],[
   [['文件大小','File size'],['最大 1.1 MB','At most 1.1 MB']],
   [['像素','Pixels'],['最多 1,800 万像素','At most 18 megapixels']],
   [['最长边','Longest side'],['不超过 4,096 像素','Up to 4,096 pixels']],
   [['最短边','Shortest side'],['至少 400 像素','At least 400 pixels']],
   [['棋盘线无法确认网格','Grid lines cannot confirm the grid'],['不返回局面，请你重拍','No position; you are asked for a new photo']],
   [['直接读整张照片得到超过 15 颗棋子，结果却不到一半','A direct read of the whole photo finds more than 15 stones, but the result has fewer than half as many'],['不返回近乎空白的棋盘，而是报告识别不确定，请你重拍','No nearly empty board: the detection is reported as uncertain and you are asked for a new photo']]])),
 block('返回的数据','What the server returns',
  ul([['361 个交叉点的局面和需要检查的点','The 361-point board and the points to check'],['棋盘四个角的位置和黑白子数','The four board corners and the stone counts'],['模型和流程版本','The model and pipeline versions'],['网格的确认方式：直接确认、局部重试或未验证，以及棋盘线检查结果','How the grid was confirmed: directly, by a crop retry, or unverified, plus the line check result'],['用时','The time taken']]),
  line('照片和结果都不保存。','Neither the photo nor the result is stored.')));}
function photoAfter(f){f.append(
 part('局限','Limits',
  para('阈值是看着这些照片调出来的，所以它们不是独立的测试；16 张照片也不能证明在其他棋盘、棋子和光线下的准确率。','The thresholds were tuned while looking at these photos, so they are not an independent test, and 16 photos cannot show accuracy for other boards, stones or lighting.'),
  table([['问题','Problem'],['测试结果','Test result'],['修复','Fix']],[
   [['反光处多出的白子（剩下的错误大多是这种）：反光几乎是纯白，和白子很像','Extra white stones on glare (most remaining errors): glare is almost pure white, like a white stone'],['照片 5 原照片多出 2 颗；12 个版本共 35 个错误，提亮时最多 10 个','Photo 5: 2 on the unchanged photo; 35 errors across its 12 versions, up to 10 when brightened'],['又试了三种检查（棋子下面是否有线、深色边缘、颜色），都会同时删掉真的白子，所以没有采用。需要新的棋子模型；不打算继续做','Three more checks were tried (a line under the stone, a dark rim, colour), but each also removed real white stones, so none is used. Needs a new stone model; no more work planned']],
   [['倾斜照片：角度很低时，高高的棋子会挡住后面的点','Angled photos: at a very low angle, tall stones hide the points behind them'],['每张照片再倾斜 20°–50°：大多数仍只有 0–2 个错误；本来就斜拍的照片 6 再倾斜 35° 以上、较小的照片 2 倾斜 50° 时失败','Each photo tilted by 20°–50°: most still had 0–2 errors; photo 6, already angled, fails at 35° or more, and the small board in photo 2 fails at 50°'],['需要立体处理和新模型；也不打算继续做','Needs 3D handling and a new model; no more work planned either']]]),
  callout('camera',t('请尽量从正上方拍摄。分析前请始终对照照片检查。','Take the photo from above if you can. Always check the board against the photo before analysing.'))),
 part('源代码与许可','Source code and licences',ul([
  ['Moku v4 采用 AGPL-3.0 许可。','Moku v4 is licensed under AGPL-3.0.'],
  ['本站的照片识别代码同样采用 AGPL-3.0，可在照片分析页或下方链接下载。','This site’s photo-recognition code is also AGPL-3.0; download its source from the photo analysis page or the link below.'],
  ['Moku 项目报告其测试集中约 44% 的照片完全识别正确；本站在其输出之上增加了上述步骤。','The Moku project reports that about 44% of its test photos are read perfectly; this site adds the steps above on top of its output.']])));}
function render(){const kind=document.body.dataset.document,page=pages[kind],title=t(...page.title);document.title=title+' · DL Weiqi';document.getElementById('document-title').textContent=title;const f=document.createDocumentFragment();page.intro?.(f);page.sections?.(f);page.extra?.(f);page.after?.(f);const h=document.createElement('h2');h.textContent=t(...(page.sourcesTitle??['参考与实测','Sources and measurements']));f.append(h);const nav=document.createElement('nav');nav.className='page-links';for(const [href,zh,en]of page.links){const a=document.createElement('a');a.href=href;a.textContent=t(zh,en);nav.append(a);}f.append(nav);document.getElementById('document-content').replaceChildren(f);}
window.addEventListener('site-language-change',render);render();
