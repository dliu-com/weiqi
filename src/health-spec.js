// Single source for /docs/health (people), /docs/health.md (machines) and the /health tests.
// Text pairs are [Chinese, English].
export const SITE='https://weiqi.dliu.com';
export const SAMPLE_GAME='2026101001';

export const healthFunctions=[
 {key:'pages',critical:true,name:['网页','Pages'],
  plain:['首页、对局、记谱、棋谱库、指南和文档页面能打开。','The home, play, record, library, guide and docs pages open.'],
  down:['网站打不开。','The site does not load.'],
  pass:['找到文件','object found'],warn:['—','—'],fail:['`timeout`、`read failed`','`timeout`, `read failed`'],
  reads:['网站存储桶：读取首页文件的信息（HeadObject index.html）。','Site bucket: HeadObject of index.html.']},
 {key:'live-game',critical:true,name:['现场对局和共享草稿','Live game and shared draft'],
  plain:['现场棋局、共享记谱草稿和对局列表能读取。','The live game, the shared recording draft and the game list can be read.'],
  down:['不能下棋或记谱。','Nobody can play or record a game.'],
  pass:['读取成功','read succeeded'],warn:['—','—'],fail:['`timeout`、`read failed`','`timeout`, `read failed`'],
  reads:['DynamoDB 对局表：按固定键读取现场棋局（GetItem，只取键）。','DynamoDB game table: GetItem of the fixed live-game key (key only).']},
 {key:'library',critical:true,name:['棋谱库','Game library'],
  plain:['已保存的棋谱列表和单个棋谱能打开。','The saved-game list and a single saved game open.'],
  down:['看不到已保存的棋谱。','Saved games cannot be viewed.'],
  pass:['读取成功','read succeeded'],warn:['—','—'],fail:['`timeout`、`read failed`','`timeout`, `read failed`'],
  reads:['棋谱存储桶：读取一个很小的固定控制文件（GetObject）。','Library bucket: GetObject of one small fixed control file.']},
 {key:'reports',critical:false,name:['棋局报告','Game reports'],
  plain:['已生成的 AI 棋局报告能打开，报告生成程序可用，没有失败的报告在等待。','Prepared AI game reports open, the report renderer is ready, and no failed reports are waiting.'],
  down:['新的报告无法生成；已有报告也可能打不开。','New reports are not made, and existing ones may not open.'],
  pass:['生成程序就绪且队列为空','renderer ready and queue empty'],warn:['`failed reports waiting`，或生成程序正在更新（`function not ready`）','`failed reports waiting`, or the renderer is updating (`function not ready`)'],fail:['`timeout`、`read failed`、`function not ready`','`timeout`, `read failed`, `function not ready`'],
  reads:['报告生成函数的状态（Lambda GetFunctionConfiguration）；失败报告队列是否为空（SQS GetQueueAttributes）。','Report renderer state (Lambda GetFunctionConfiguration); whether the failed-report queue is empty (SQS GetQueueAttributes).']},
 {key:'analysis',critical:false,name:['AI 棋局分析','AI game analysis'],
  plain:['AI 分析没有被费用保护暂停。检查从不启动分析。','AI analysis is not paused by the spending guard. The check never starts an analysis.'],
  down:['新棋谱暂时没有 AI 分析，之后会补上。','New games get no AI analysis for now; it catches up later.'],
  pass:['未暂停','not paused'],warn:['`paused by spending guard`','`paused by spending guard`'],fail:['`timeout`、`read failed`','`timeout`, `read failed`'],
  reads:['与棋谱库同一次读取：控制文件中的暂停标记。','The same control-file read as the library: its paused flag.']},
 {key:'position',critical:false,name:['照片识别和局面分析','Photo recognition and position analysis'],
  plain:['照片识别和局面分析程序可用，且没有被费用保护暂停。检查从不识别照片或分析局面。','The photo-recognition and position-analysis functions are ready and not paused by the spending guard. The check never reads a photo or analyses a position.'],
  down:['不能用照片或局面做 AI 分析。','Photos and positions cannot be analysed.'],
  pass:['两个函数都就绪且未暂停','both functions ready and not paused'],warn:['`paused by spending guard`，或函数正在更新（`function not ready`）','`paused by spending guard`, or a function is updating (`function not ready`)'],fail:['`timeout`、`read failed`、`function not ready`','`timeout`, `read failed`, `function not ready`'],
  reads:['两个函数的状态（Lambda GetFunctionConfiguration）；控制文件中的暂停标记。','State of both functions (Lambda GetFunctionConfiguration); the control file\'s paused flag.']}
];
export const healthKeys=healthFunctions.map(f=>f.key);

const page=(key,path)=>({key,method:'GET',path,status:200,type:'text/html',marker:'dl-header',slowMs:2000});
const api=(key,path,marker)=>({key,method:'GET',path,status:200,type:'application/json',marker,slowMs:3000});
export const guestChecks=[
 page('pages','/'),page('pages','/play'),page('pages','/record'),page('pages','/guide'),page('pages','/docs'),page('pages','/docs/health'),
 {key:'pages',method:'GET',path:'/docs/health.md',status:200,type:'text/markdown',marker:'# DL Weiqi health checks',slowMs:2000},
 {key:'pages',method:'GET',path:'/about',status:301,location:'/docs'},
 {key:'pages',method:'GET',url:'http://weiqi.dliu.com/',status:301,location:SITE+'/'},
 api('live-game','/api/game','"state"'),api('live-game','/api/draft','"draft"'),api('live-game','/api/games','"games"'),
 page('library','/game'),api('library','/api/library','"games"'),page('library','/game/'+SAMPLE_GAME),api('library','/api/library/'+SAMPLE_GAME,'"metadata"'),
 page('reports','/game/'+SAMPLE_GAME+'/report'),api('reports','/api/library/'+SAMPLE_GAME+'/report','"availableLanguages"'),api('reports','/prepared-reports/'+SAMPLE_GAME+'/index.json','"id"'),
 api('analysis','/api/library/'+SAMPLE_GAME,'"analysis"'),
 page('position','/analysis'),
 {key:'health',method:'GET',path:'/health',status:'200 or 503',type:'application/health+json',marker:'"status"',slowMs:5000}
];
export const checkUrl=c=>c.url||SITE+c.path;

export const notTested=[
 ['下棋、记谱、保存棋谱：这些会改变共享内容，访客检查不能做。','Playing moves, recording and saving games: these change shared content, so guest checks never do them.'],
 ['真正运行 AI 分析、照片识别或局面分析：每次都要花钱。/health 只确认这些程序已就绪且未暂停。','Actually running AI analysis, photo recognition or position analysis: each run costs money. /health only confirms they are ready and not paused.'],
 ['网站没有登录，所以没有需要登录的功能。','The site has no sign-in, so there are no signed-in features.']
];
export const rules=[
 ['只用 GET，不带 cookie、不带 `Authorization` 头、不带请求体。（网页也接受 HEAD，但 `/api/` 对 HEAD 返回 405。）','Only GET, with no cookies, no `Authorization` header and no request body. (Pages also accept HEAD, but `/api/` answers HEAD with 405.)'],
 ['绝不 POST，绝不修改内容，绝不启动要花钱的工作（分析、识别、生成报告）。','Never POST, never change content and never start paid work (analysis, recognition, report rendering).'],
 ['使用 user agent `dliu-status-bot/1.0 (+https://status.dliu.com/docs)`。','Send the user agent `dliu-status-bot/1.0 (+https://status.dliu.com/docs)`.'],
 ['读取 `/api/game` 时，如果对局双方已经结束对局，网站会把它存入棋谱库，和任何访客打开页面时一样；它从不改变进行中的对局。','Reading `/api/game` may finish publishing a game its players already ended, exactly as any visitor\'s page load would. It never changes a game in progress.'],
 ['棋谱库接口（`/api/library…`）每个连接每分钟最多 120 次读取；一轮检查只用几次。','The library API (`/api/library…`) allows 120 reads a minute per connection; one check run uses a handful.']
];
export const healthEndpoint={
 path:'/health',
 caching:['CloudFront 缓存 60 秒（缓存键为空；`Cache-Control: public, max-age=60`）。`/health` 不转发 cookie、`Authorization` 头或查询字符串，处理程序也不读取请求的任何部分。','CloudFront caches it for 60 s (cache key: nothing; `Cache-Control: public, max-age=60`). The `/health` behavior forwards no cookies, no `Authorization` header and no query string, and the handler reads no part of the request.'],
 timeouts:['每次读取有 2 秒超时（报告为 `timeout`）；整个回应在 5 秒内返回。','Each read has its own 2 s timeout (reported as `timeout`); the response returns within 5 s.'],
 format:['`Content-Type: application/health+json`。`status` 为 `pass` 或 `warn` 时返回 HTTP 200，为 `fail` 时返回 503。顶层 `status` 是各功能中最差的状态。','`Content-Type: application/health+json`. HTTP 200 when `status` is `pass` or `warn`, 503 when it is `fail`. The top-level `status` is the worst function status.'],
 private:['只读：每个依赖只做一次便宜的读取，不写入，不列出 S3，从不启动分析、识别、报告生成、GPU 或 Fargate 工作。不透露私有信息：没有资源名称、数量或用户数据；`output` 只会是下列之一。','Read only: one cheap read per dependency, no writes, no S3 LIST, and it never starts analysis, recognition, report rendering, GPU or Fargate work. Nothing private: no resource names, counts or user data; `output` is only one of the values below.'],
 outputs:['`timeout`','`read failed`','`function not ready`','`paused by spending guard`','`failed reports waiting`'],
 example:{status:'warn',time:'2026-11-03T23:00:00.000Z',functions:[
  {key:'pages',name:'Pages',status:'pass'},{key:'live-game',name:'Live game and shared draft',status:'pass'},{key:'library',name:'Game library',status:'pass'},
  {key:'reports',name:'Game reports',status:'warn',output:'failed reports waiting'},{key:'analysis',name:'AI game analysis',status:'pass'},{key:'position',name:'Photo recognition and position analysis',status:'pass'}]}
};

const cell=v=>String(v).replace(/\|/g,'\\|');
export function healthMarkdown(){
 const lines=['# DL Weiqi health checks','','How status.dliu.com (or anyone) can test '+SITE+' as an anonymous guest. This is the full technical version of '+SITE+'/docs/health. The site has no sign-in.','',
  '## Functions','','| Key | Name | Critical | What a guest gets | Down means |','|---|---|---|---|---|',
  ...healthFunctions.map(f=>'| `'+f.key+'` | '+f.name[1]+' ('+f.name[0]+') | '+(f.critical?'yes':'no')+' | '+cell(f.plain[1])+' | '+cell(f.down[1])+' |'),'',
  '## Guest checks','','One row per check. Method GET, no cookies. "Type" is a prefix of `Content-Type`. "Marker" is a fixed string in the body (a JSON key for JSON). For redirects, `Location` must equal the given value. "Slow" is the time above which the check counts as slow.','',
  '| Function | Method | URL | Status | Type | Marker or Location | Slow (ms) |','|---|---|---|---|---|---|---|',
  ...guestChecks.map(c=>'| `'+c.key+'` | '+c.method+' | '+checkUrl(c)+' | '+c.status+' | '+(c.type?'`'+c.type+'`':'—')+' | '+(c.location?'Location: `'+c.location+'`':'`'+cell(c.marker)+'`')+' | '+(c.slowMs??'—')+' |'),'',
  '## Health endpoint','','`GET '+SITE+healthEndpoint.path+'`','',...['caching','timeouts','format','private'].map(k=>'- '+healthEndpoint[k][1]),'- `output` values: '+healthEndpoint.outputs.join(', ')+'.','',
  '| Key | What /health reads | pass | warn | fail |','|---|---|---|---|---|',
  ...healthFunctions.map(f=>'| `'+f.key+'` | '+cell(f.reads[1])+' | '+f.pass[1]+' | '+f.warn[1]+' | '+f.fail[1]+' |'),'',
  'Example response:','','```json',JSON.stringify(healthEndpoint.example,null,2),'```','',
  '## Not tested','',...notTested.map(n=>'- '+n[1]),'',
  '## Rules','',...rules.map(r=>'- '+r[1]),''];
 return lines.join('\n');
}
