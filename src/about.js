import './site-shell.js';
import {localTimestamp} from './site-time.js';
import {t,setLanguage} from './i18n.js';
import {flow,tiers,stats,icon,more as details} from './flow-diagram.js';
// Each section: [zh title, en title, items, links]. An item is a [zh, en] bullet or a {head, rows} table; table cells are plain strings or [zh, en] pairs.
const sections=[
 ['计时标准与速度目标','Timing and response targets',[
  ['正式棋局从分析进入 SQS 开始计时。','Production timing starts when analysis enters SQS.'],
  ['计时包含排队、等待计算资源、实例和容器启动、模型下载、分析及结果保存。','It includes queueing, capacity waits, machine and container startup, model download, analysis and saving results.'],
  ['复盘页显示总计已等待时间；完成后分别显示总耗时和引擎分析耗时。','Replay shows the total time waited so far. Finished results show total time and engine time separately.'],
  ['排队估计使用只读 Batch 状态、前面作业剩余的快速与深度分析，以及当前队列的工作容量。','The queue estimate uses read-only Batch status, the quick and deep work left in earlier jobs, and the queue’s worker capacity.'],
  ['页面显示保守的单一预计开始与完成时间，精确到分钟；API 状态缓存 15 秒。','It shows one cautious start time and finish time, rounded up to the minute. API status is cached for 15 seconds.'],
  ['GPU 容量等待无法可靠预测；超过预计时段后不再推迟时间，而是明确提示开始时间未知。','GPU capacity waits cannot be predicted reliably. Once a forecast has passed, the page says the start time is unknown instead of pushing it back again.'],
  {head:[['分析','Pass'],['目标','Target']],rows:[
   [['快速分析','Quick analysis'],['5 分钟内','Within 5 minutes']],
   [['深度分析','Deep analysis'],['1 小时内，最多 2 小时','1 hour; at most 2 hours']]]},
  ['云端容量和同时上传数量会影响这些目标。','Cloud capacity and simultaneous uploads affect these targets.'],
  ['基准页分别显示总时间与处理时间。','The benchmark page shows both total time and processing time.']
 ]],
 ['已生成的 AI 报告与 PDF','Prepared AI reports and PDFs',[
  ['深度分析完成后，Batch 事件通知原有 Lambda，验证作业与棋谱，并把报告 JSON 保存到受保护的 WeiqiStorage。','After deep analysis, the Batch completion event asks the existing Lambda to check the job and SGF, then save the report JSON in protected WeiqiStorage.'],
  ['消息随后进入 FIFO 报告队列，由另一个按使用计费的 Lambda 顺序准备中英文 HTML 与固定 A4 PDF。','A FIFO report queue then passes the work to a separate usage-billed Lambda. It makes English and Chinese HTML views and fixed A4 PDFs.'],
  ['文件保存到现有私有网站 S3 桶，由 CloudFront 分发。','Files are saved in the existing private site S3 bucket and delivered through CloudFront.'],
  ['两个语言的所有文件保存完成后才标记就绪；失败最多重试两次。','A report is marked ready only after every file in both languages is saved. Failures are retried twice.'],
  ['无需新的 GPU 作业，也没有常驻报告服务器。','No new GPU job or always-running report server is needed.'],
  {head:[['报告部分','Report part'],['内容','Contents']],rows:[
   [['开头','Opening'],['带手数的总谱，然后是全局点数与胜率走势','Numbered full game record, then game-wide score and winning chances']],
   [['六张图','Six graphs'],['着法质量、典型损失、手数区间与关键时刻；先用例子解释，再给出计算细节','Move quality, typical loss, move ranges and key moments; plain examples first, then calculation details']],
   [['失误表','Mistake tables'],['双方各五手失误；前三手链接到后面的棋盘详解','Each side’s five worst moves; the first three link to detailed board reviews']],
   [['版式','Layout'],['含棋局链接与元数据的封面、目录、页眉页脚和书签','Title page with game link and details, contents, headers and footers, bookmarks']]]},
  ['打开报告、切换语言和保存 PDF 只读取已生成文件，不触发新的报告或 PDF 计算。','Opening a report, switching language and saving the PDF only read prepared files. They never start report or PDF generation.'],
  ['没有用户配置选项。','There are no settings to configure.']
 ]],
 ['棋步点评与推荐变化','Move review and suggested variations',[
  ['分析文件保存 KataGo 排名最高的最多 8 个候选着法（如有必要另保留实战着法）。','Analysis files keep up to eight of KataGo’s leading candidate moves (plus the played move when needed).'],
  ['每个候选着法保存最多 12 手的主要变化。','Each candidate keeps a main line of up to twelve moves.'],
  ['棋盘标记和推荐按钮使用当前显示局面的分析，为当前行棋方推荐下一手；点击后从当前棋盘继续回放。','Board markers and suggestion buttons use the analysis of the board shown. They suggest the next move for the player to move, and their lines start from that board.'],
  ['上一手的点评从落子前局面比较候选分数，按实战棋手的视角计算点数损失。','The last-move rating compares candidate scores before the move, and counts point loss from the view of the player who moved.'],
  ['实战着法搜索不足时，使用落子后的局面评分，并标注为估计。','If the played move was not searched enough, the score after the move is used and marked as an estimate.'],
  {head:[['点评','Rating'],['点数损失','Point loss']],rows:[
   [['最佳','Best'],['引擎首选','Engine’s top choice']],
   [['好棋','Good'],'≤ 0.5'],
   [['不精确','Inaccuracy'],'0.5–2'],
   [['失误','Mistake'],'2–5'],
   [['严重失误','Blunder'],'> 5']]},
  ['这些阈值是应用的点评规则。','These thresholds are the app’s own rating rules.'],
  ['变化由浏览器根据原有 S3 分析文件复现；显示或切换变化无需额外分析作业。','The browser replays lines from the existing S3 analysis file. Showing or hiding them starts no extra analysis job.']
 ]],
 ['公共工作区与保存','Public workspaces and saving',[
  ['/play 的现场对弈及 /record 的记录草稿存入 DynamoDB。','Live play at /play and the recording draft at /record are stored in DynamoDB.'],
  ['公共草稿按版本号自动保存；版本冲突时拒绝覆盖。','The draft saves automatically with revision checks; a conflicting save is rejected, not overwritten.'],
  ['记录树支持分支，保存时仅保留主分支。','The editor keeps variations, but saving keeps only the main branch.'],
  ['完成的现场对弈自动保存。','Finished live games save automatically.'],
  ['所有保存均经幂等 API 先写入 S3 棋谱库，再发送 SQS 分析消息；保存重试复用原棋局。','Every save goes through an idempotent API: it writes the record to S3, then sends an SQS analysis message. A retried save reuses the same game.'],
  ['/game 显示分页棋谱库，/game/编号 提供复盘及 AI。','/game is the paginated record library; /game/ID shows replay and AI.']
 ]],
 ['照片识别','Photo recognition',[
  ['/analysis 可以上传 19 × 19 棋盘照片。','/analysis accepts a photo of a 19 × 19 board.'],
  ['照片在浏览器中压缩后，发送到爱尔兰的 Lambda。','The browser compresses the photo and sends it to a Lambda function in Ireland.'],
  ['开源 Moku v4 模型在 CPU 上找出棋盘四角和棋子。','The open-source Moku v4 model finds the board corners and stones on CPU.'],
  ['程序把棋盘摆正，在整盘和四个重叠局部上寻找棋子。','The board is squared up, and stones are found on the whole board and on four overlapping quarters.'],
  ['再检查候选棋子的网格位置、大小、颜色和重复。','Candidates are then checked for grid position, size, colour and duplicates.'],
  ['线上通常 6–10 秒返回结果。','Live results usually return in 6–10 seconds.'],
  ['识别仍在试验中：可疑的点会标出，分析前请对照照片检查。','Recognition is experimental. Doubtful points are outlined, so check the board against the photo before analysing.']
 ],[['/photo-recognition','照片识别原理：步骤、测试结果和局限','How photo recognition works: steps, test results and limits']]],
 ['AI 分析一个局面','AI analysis of one position',[
  ['/analysis 的每次分析都是一次短暂的云端请求，没有长时间运行的任务。','Each analysis on /analysis is one short cloud request, with no long-running jobs.'],
  ['局面按中国规则分析（贴 7.5 或 0.5 目），因为照片无法显示之前的提子和打劫。','Positions are analysed under Chinese rules (komi 7.5 or 0.5), because a photo cannot show earlier captures or ko history.']
 ]],
 ['费用与安全','Costs and security',[
  ['全部访问公开，草稿可由任何人编辑。','Everything is public, and anyone can edit the draft.'],
  {head:[['全站限制','Site-wide limit'],['上限','Cap']],rows:[
   [['AI 额度','AI quota'],['10 / 天','10 per day']],
   [['新棋谱','New records'],['100 / 天','100 per day']],
   [['修改','Edits'],['120 / 分钟','120 per minute']]]},
  ['限流不是 AWS 账单的硬上限。','Throttling is not a hard cap on the AWS bill.']
 ],[['/cost','网站运行成本','Site running costs'],['/security','安全审查','Security review']]],
 ['网页与 API','Website and API',[
  ['网页文件保存在私有 S3 存储桶，通过 CloudFront 提供。','Website files are kept in a private S3 bucket and served through CloudFront.'],
  ['CloudFront 把 /game/棋局ID 路由到复盘页。','CloudFront routes /game/game-ID to the replay page.'],
  ['Lambda API 负责上传 SGF、读取棋谱和检查分析状态。','A Lambda API accepts SGF uploads, reads records and returns analysis status.'],
  ['上传成功后立即返回固定链接，不等待 AI 完成。','Uploads return a permanent link at once, without waiting for AI.']
 ]],
 ['可迁移的 S3 棋谱库','Portable records in S3',[
  ['每个棋局保存在 games/日期/序号/ 下，例如 games/20261005/01/。','Each game lives under games/date/sequence/, for example games/20261005/01/.'],
  {head:[['文件','File'],['内容','Contents']],rows:[
   ['original.sgf',['原始棋谱','The original record']],
   ['metadata.json',['棋局信息及状态','Game details and status']],
   ['analysis-quick.json',['临时快速评估','Preliminary quick evaluations']],
   ['analysis.json',['深度逐手评估及引擎配置','Deeper per-position evaluations and engine settings']]]},
  ['保存时仅保留主分支，主线注释保留。','Saving keeps only the main line, with its comments.'],
  ['原始上传 API 兼容已有棋谱。','The upload API stays compatible with existing records.'],
  ['棋局 ID 不依赖存储桶名称。','Game IDs do not depend on the bucket name.'],
  ['迁移时复制棋谱文件，并保留 uploads/（上传映射）、reservations/（ID 分配记录）和 daily-analysis/（每日额度记录）。','To move the library, copy these files and keep uploads/ (upload mappings), reservations/ (ID allocation) and daily-analysis/ (daily allowances).']
 ]],
 ['独立的生产存储','Protected production storage',[
  ['WeiqiStorage 是独立的 CloudFormation 栈，拥有 S3 棋谱库（原始 SGF、棋局信息、快速及深度分析文件）和直接对弈的 DynamoDB 表。','WeiqiStorage is a separate CloudFormation stack. It owns the S3 record library and the DynamoDB live-game table.'],
  ['栈启用终止保护；存储资源采用保留策略，栈策略阻止删除或替换。','Termination protection, resource retention and a stack policy guard against deletion or replacement.'],
  ['S3 启用版本控制，保留旧版本文件。','S3 versioning keeps earlier versions of files.'],
  ['DynamoDB 启用删除保护和时间点恢复。','DynamoDB has deletion protection and point-in-time recovery.'],
  ['部署或删除计算栈不会删除棋谱库。','Updating or deleting the compute stack does not delete the library.']
 ]],
 ['后台 GPU 分析','Background GPU analysis',[
  ['上传 API 发送 SQS 消息。','The upload API sends an SQS message.'],
  ['短时 Lambda 选出评分可靠的最强官方模型，同时提交两个 GPU Batch 作业，然后立即退出。','A short-lived Lambda picks the strongest confidently-rated official model, submits two GPU Batch jobs at once, then exits.'],
  ['快速分析单独在一台 T4 按需实例上运行，尽快出结果。','Quick analysis runs on its own T4 On-Demand machine, so it is ready as soon as possible.'],
  ['深度分析在另一台 GPU 上运行。','Deep analysis runs on a second GPU.'],
  ['如果深度那台先启动而快速分析还没开始，它会先做快速分析，单独的快速作业随即取消。','If the deep machine starts first and quick analysis has not started, it does quick analysis too, and the separate quick job is cancelled.'],
  ['每个阶段都从官方来源重新下载模型，不缓存或保存模型文件。','Each pass downloads the official model fresh; the weights are never cached or kept.'],
  ['结果与配置写入 S3。','Results and settings are saved to S3.'],
  ['快速分析每分钟检查一次；深度分析需刷新页面查看。','Quick results are checked once a minute; deep results need a page refresh.']
 ]],
 ['模型、GPU 与后备','Model, GPU and fallback',[
  {head:['',['快速分析','Quick analysis'],['深度分析','Deep analysis']],rows:[
   ['GPU',['T4 按需（g4dn.xlarge）','T4 On-Demand (g4dn.xlarge)'],['首选 NVIDIA A10G 按需（g5.xlarge，4 vCPU、16 GB 内存）；等待 3 分钟仍未启动时，确认取消后转向 T4 按需（g4dn.xlarge）','First NVIDIA A10G On-Demand (g5.xlarge, 4 vCPUs, 16 GB RAM). If not started after three minutes, it is cancelled and moved to T4 On-Demand (g4dn.xlarge)']],
   [['每个局面的访问次数','Visits per position'],'32','3,000'],
   [['用时','Time'],['通常约 3–4 分钟可看','Usually ready in about 3–4 minutes'],['250 手：A10G 约 15 分钟，T4 约 36 分钟','250 moves: about 15 min on A10G, 36 min on T4']]]},
  ['超长棋局按手数降低每个局面的访问量。','Very long games use fewer visits per position.'],
  ['所有 GPU 使用相同模型、16 个分析线程，神经网络批量大小 32。','Every GPU uses the same model, 16 analysis threads and NN batch size 32.'],
  ['不使用 Spot 实例，因为 AWS 可能在运行中途收回。','Spot machines are not used, because AWS can take them back mid-run.'],
  ['不会改用 CPU。','CPU fallback is disabled.'],
  ['每个结果保存实际模型名称、地址、校验值、引擎版本、计算配置与运行时间。','Each result keeps the actual model name, URL, checksum, engine version, compute settings and timing.'],
  ['只分析 19 路主线；SGF 未注明规则时采用日本规则。','Only 19 × 19 main lines are analysed; if the SGF gives no rules, Japanese rules are used.']
 ]],
 ['能用上 A10G 的机会','How often a game gets an A10G',[
  ['爱尔兰的 A10G 经常没有空闲。','A10G machines in Ireland are often busy.'],
  ['2026-10-08 AWS 对爱尔兰 A10G 空闲容量的评分为 1 / 10（T4 为 8 / 10）。','On 2026-10-08, AWS rated spare A10G capacity in Ireland 1 out of 10 (T4: 8 out of 10).'],
  ['目前 3 次 A10G 请求中，1 次在 3 分钟内启动，另 2 次等了 15–18 分钟。','Of our three A10G requests so far, one started within three minutes; the other two waited 15–18 minutes.'],
  ['因此预计约三分之一的棋局深度分析使用 A10G，其余使用 T4。','So expect about one game in three to get an A10G for deep analysis; the rest use T4.']
 ]],
 ['失败与自动重试','Failure and automatic retries',[
  ['分析失败时，棋谱与已完成的快速分析保留，复盘页显示错误。','On failure, the record and any finished quick analysis stay available, and replay shows an error.'],
  ['最多自动重试两次：首次失败后 5 分钟，再次失败后 15 分钟。','At most two automatic retries: five minutes after the first failure, fifteen minutes after the second.'],
  ['页面显示重试的日期、时间、时区和剩余等待时间。','The page shows the retry date, time, time zone and time left.'],
  ['重试轮换 GPU 容量池，只执行尚未完成的分析阶段。','Retries alternate between GPU pools and run only unfinished passes.'],
  ['SQS 延迟消息安排重试，不需要常驻服务器。','Delayed SQS messages schedule retries, so no always-running server is needed.'],
  ['重试次数用完时会明确告知用户。','When retries run out, the page says so clearly.']
 ]],
 ['按用量计费与自动停止','Usage billing and automatic shutdown',[
  ['容器保存结果后退出；GPU 最小容量为零，实例自动释放。','Containers save results and exit. GPU minimum capacity is zero, and machines retire automatically.'],
  ['没有常驻 AI 服务器、NAT 网关或容量预留。','There is no always-running AI server, NAT gateway or capacity reservation.'],
  ['每个新棋谱都有快速分析；每天前 10 个还有深度分析和报告。','Every new game gets quick analysis; the first 10 each day also get deep analysis and a report.'],
  ['查看棋谱和推荐变化不触发新作业。','Viewing a record or a suggested line starts no extra job.'],
  ['按用量计费：计算、启动、等待自动释放的时间、存储、网络、API、队列和日志。','Billed by usage: compute, startup, time until automatic retirement, storage, network, API, queues and logs.'],
  ['每盘快速加深度分析的费用目标低于 1 美元。','The cost target for quick plus deep analysis is below US$1 per game.'],
  ['排队、云端容量、棋谱长度、重试和模型大小会影响时间及费用；性能目标不是容量保证。','Queueing, cloud capacity, game length, retries and model size affect time and cost. Response targets are not capacity guarantees.'],
  ['另有两小时的作业超时保护，处理卡住的作业。','A separate two-hour job timeout handles stuck workers.']
 ]],
 ['直接对弈与性能记录','Live play and performance records',[
  ['当前现场棋局与公共记录草稿保存在按需计费的 DynamoDB 中；结束或保存后写入 S3 棋谱库。','The live game and public recording draft use on-demand DynamoDB; finished or saved games go into the S3 library.'],
  ['工作程序记录下载、引擎分析和保存的分段时间；AWS Batch 记录排队和容器启动时间。','Workers record download, engine and saving times; AWS Batch records queue and container startup times.'],
  ['基准实验页面用表格列出支持当前 GPU 和访问数选择的测试。','The benchmark page shows, in tables, the tests behind the current GPU and visit choices.'],
  ['失败或已停止的实验不显示。','Failed or stopped experiments are not shown.'],
  ['基准时间包含启动和保存，不含排队。','Benchmark times include start-up and saving, not queue waiting.']
 ]]
];
const text=value=>Array.isArray(value)?t(value[0],value[1]):value;
function detailTable({head,rows}){
 const wrap=document.createElement('div'),table=document.createElement('table'),thead=document.createElement('thead'),tbody=document.createElement('tbody'),headRow=document.createElement('tr');
 wrap.className='about-table-wrap';table.className='about-table';
 for(const cell of head){const th=document.createElement('th');th.scope='col';th.textContent=text(cell);headRow.append(th);}
 thead.append(headRow);
 for(const [first,...cells]of rows){const tr=document.createElement('tr'),th=document.createElement('th');th.scope='row';th.textContent=text(first);tr.append(th);for(const cell of cells){const td=document.createElement('td');td.textContent=text(cell);tr.append(td);}tbody.append(tr);}
 table.append(thead,tbody);wrap.append(table);return wrap;
}
function detailSection([zh,en,items,links=[]]){
 const article=document.createElement('article'),title=document.createElement('h2');title.textContent=t(zh,en);article.append(title);
 let list=null;
 for(const item of items){
  if(!Array.isArray(item)){list=null;article.append(detailTable(item));continue;}
  if(!list){list=document.createElement('ul');list.className='about-points';article.append(list);}
  const li=document.createElement('li');li.textContent=t(item[0],item[1]);list.append(li);
 }
 if(links.length){const p=document.createElement('p');p.className='about-links';links.forEach(([href,linkZh,linkEn],index)=>{if(index)p.append(' · ');const a=document.createElement('a');a.href=href;a.textContent=t(linkZh,linkEn)+' →';p.append(a);});article.append(p);}
 return article;
}
// Cards linking to the other info pages, each with one headline fact from that page.
function readMore(){
 const section=document.createElement('section'),heading=document.createElement('h2'),grid=document.createElement('div');
 section.className='about-read-more';heading.textContent=t('延伸阅读','Read more');grid.className='about-cards';
 for(const [href,name,title,line,key]of [
  ['/benchmarks','chart',['CPU / GPU 基准实验','CPU / GPU benchmarks'],['支持 GPU 与访问数选择的测试','Tests behind the GPU and visit choices'],['深度 3,000 次：T4 约 44 分钟','Deep 3,000 visits ≈ 44 min on T4']],
  ['/cost','budget',['网站运行成本','Site running costs'],['网站承担，用户免费','Paid by the site, free for users'],['深度分析 US$0.50–0.75 / 局','Deep analysis US$0.50–0.75 per game']],
  ['/security','shield',['安全审查','Security review'],['线上渗透测试与威胁模型','Live penetration test and threat model'],['2026 年 10 月 8 日测试','Tested 8 Oct 2026']],
  ['/photo-recognition','camera',['照片识别原理','How photo recognition works'],['从棋盘照片到可编辑局面','From a board photo to an editable position'],['6 张实拍照片中 5 张完全正确','5 of 6 real photos exact']]
 ]){
  const card=document.createElement('a'),body=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('span'),fact=document.createElement('span');
  card.className='about-card';card.href=href;body.className='about-card-text';small.className='about-card-line';fact.className='about-card-key';
  strong.textContent=text(title);small.textContent=text(line);fact.textContent=text(key);
  body.append(strong,small,fact);card.append(icon(name,'large'),body);grid.append(card);
 }
 section.append(heading,grid);return section;
}
function render(){
 document.title=t('关于 · DL','About · DL');document.getElementById('about-title').textContent=t('技术架构','Technical architecture');
 const fragment=document.createDocumentFragment(),detail=document.createDocumentFragment();
 for(const section of sections)detail.append(detailSection(section));
 fragment.append(stats([[t('0 台','0'),t('空闲时运行的服务器','servers running when idle'),'power'],[t('≈ 5 分钟','≈ 5 min'),t('快速 AI 复盘','quick AI review'),'clock'],[t('≈ 1 小时','≈ 1 h'),t('深度 AI 复盘','deep AI review'),'gpu'],[t('≈ 3 秒','≈ 3 s'),t('分析一个局面','AI for one position'),'katago']]),systemMap(),deepFlow(),positionFlow(),gpuFallback(),spendingGuard(),readMore(),details(t('更多技术细节（文字）','More technical details (text)'),detail),quickAnalysisLicence());
 document.getElementById('about-content').replaceChildren(fragment);
}
window.addEventListener('site-language-change',render);render();

function quickAnalysisLicence(){
 const p=document.createElement('p'),link=(href,text)=>{const a=document.createElement('a');a.href=href;a.textContent=text;return a;};
 p.className='licence-line';
 p.append(t('AI 分析 © 2026 DL。','AI analysis © 2026 DL. '),link('/photo-assets/LICENSE.txt','AGPL-3.0'),t('；无担保。','; no warranty. '),link('/photo-assets/photo-source.tar.gz',t('下载源码','Download source')),' · ',link('/photo-assets/NOTICES.txt',t('第三方许可','Third-party notices')),' · ',link('https://huggingface.co/kaya-go/moku-v4',t('识别模型及源码','Recognition model and source')));
 return p;
}

function systemMap(){
 return tiers({title:t('系统总览','System map'),rows:[
  {badge:t('用户','Users'),label:t('浏览器','Browser'),nodes:[{icon:'browser',title:t('手机或电脑','Phone or computer'),text:t('无须登录','No sign-in')}]},
  {link:'HTTPS',badge:t('边缘','Edge'),label:'CloudFront',tone:'edge',nodes:[{icon:'cloudfront',title:'Amazon CloudFront',text:t('CDN · HTTPS · 安全头','CDN · HTTPS · security headers')}]},
  {link:t('页面 / API','Pages / API'),badge:t('应用','App'),label:t('按次运行','Runs per request'),tone:'app',nodes:[{icon:'s3',title:t('网站文件','Website files'),text:'S3 · HTML / JS / CSS'},{icon:'lambda',title:t('棋局 API','Game API'),text:t('对弈 · 记录 · 棋谱库','Play · record · library')},{icon:'camera',title:t('照片识别','Photo detection'),text:'Lambda · Moku v4'},{icon:'katago',title:t('快速 AI 分析','Quick AI analysis'),text:'Lambda · KataGo CPU'}]},
  {link:t('读写','Read / write'),badge:t('数据','Data'),label:t('私有存储','Private storage'),tone:'private',nodes:[{icon:'dynamodb',title:'DynamoDB',text:t('现场棋局 · 草稿 · 限额','Live game · draft · limits')},{icon:'s3',title:t('棋谱库','Record library'),text:t('S3 · SGF · AI 结果 · 报告','S3 · SGF · AI results · reports')}]},
  {link:t('记录后','After Record'),badge:t('后台','Background'),label:t('只在有任务时运行','Runs only when needed'),nodes:[{icon:'sqs',title:'Amazon SQS',text:t('分析队列','Analysis queue')},{icon:'gpu',title:'AWS Batch GPU',text:'KataGo · T4 / A10G'},{icon:'report',title:t('报告 Lambda','Report Lambda'),text:'Chromium → HTML / PDF'}]}
 ],note:t('全部资源由 AWS CDK / CloudFormation 部署在爱尔兰（eu-west-1）；CloudFront 是全球服务。','Everything is deployed with AWS CDK / CloudFormation in Ireland (eu-west-1); CloudFront is global.')});
}
function deepFlow(){
 return flow({title:t('记录棋局 → 深度 AI 报告','Record game → deep AI report'),numbered:true,steps:[
  {icon:'record',title:t('记录棋局','Record game'),text:t('浏览器','Browser')},
  {icon:'library',title:t('存入棋谱库','Save'),text:'Lambda → S3'},
  {icon:'sqs',title:t('排队','Queue'),text:'SQS'},
  {icon:'gpu',title:t('GPU 分析','GPU analysis'),text:t('快速 ≈ 5 分钟 · 深度 ≈ 1 小时','Quick ≈ 5 min · deep ≈ 1 h')},
  {icon:'report',title:t('AI 报告','AI report'),text:'HTML + PDF'},
  {icon:'power',title:t('GPU 关闭','GPU stops'),text:t('空闲时不运行','Nothing runs when idle')}
 ],note:t('快速 32 次访问；深度 3,000 次访问（所有 GPU 相同）。失败后 5 分钟、15 分钟自动重试。','Quick: 32 visits. Deep: 3,000 visits on every GPU. Failures retry after 5 and 15 minutes.')});
}
function positionFlow(){
 return flow({title:t('AI 分析一个局面','AI analysis of one position'),numbered:true,steps:[
  {icon:'phone',title:t('照片 / SGF / 摆子','Photo / SGF / set up'),text:t('照片在浏览器中缩小','Photo resized in browser')},
  {icon:'camera',title:t('照片识别','Photo detection'),text:'Moku v4 · ≈ 8 s'},
  {icon:'flag',title:t('检查棋子','Check stones'),text:t('琥珀色框需检查','Amber boxes need a check')},
  {icon:'katago',title:t('快速 AI 分析','Quick AI analysis'),text:'KataGo CPU · ≈ 3 s'},
  {icon:'chart',title:t('推荐着法','Suggested moves'),text:t('胜率与目差','Win rate and score')}
 ],note:t('不保存照片和局面。全站每天 2,000 次，每个连接 500 次。','Photos and positions are not stored. 2,000 requests a day site-wide, 500 per connection.')});
}
function gpuFallback(){
 return flow({title:t('GPU 容量不足时','When GPU capacity is short'),steps:[
  {icon:'gpu',title:'A10G On-Demand',text:t('深度分析首选','First choice for deep')},
  {icon:'gpu',title:'T4 On-Demand',text:t('等待 3 分钟后','After 3 min waiting')},
  {icon:'retry',title:t('稍后重试','Retry later'),text:t('15 分钟仍无容量','Still no capacity after 15 min'),tone:'warn'}
 ]});
}
function spendingGuard(){
 return flow({title:t('费用保护','Spending guard'),steps:[
  {icon:'budget',title:'AWS Budgets',text:t('每天 $15 · 每月 $50','$15 / day · $50 / month')},
  {icon:'lambda',title:t('保护程序','Guard Lambda'),text:t('超额时运行','Runs when exceeded')},
  {icon:'shield',title:t('暂停 AI','Pause AI'),text:t('停止 GPU 队列与任务','Stops GPU queue and jobs'),tone:'bad'},
  {icon:'check',title:t('仍可复盘','Replay still works'),text:t('棋谱与报告保留','Games and reports stay'),tone:'good'}
 ]});
}
