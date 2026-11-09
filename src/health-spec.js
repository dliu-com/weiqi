// Single source for /docs#health (people), /docs/health.md (machines) and the /health tests.
// Text pairs are [Chinese, English].
export const SITE='https://weiqi.dliu.com';
export const SAMPLE_GAME='2026101001';

export const healthFunctions=[
 {key:'pages',critical:true,name:['网页','Pages'],
  plain:['首页、对局、记谱、棋谱库、指南和文档页面能打开。','The home, play, record, library, guide and docs pages open.'],
  does:['网站的每个页面：首页、对局、记谱、棋谱库、指南和文档。', 'Every page of the site: home, play, record, library, guide and docs.'],
  how:["像访客一样打开每个页面；/health 确认网站文件还在。", "Opens each page like a visitor; /health checks the site files are there."],
  down:['网站打不开。','The site does not load.'],
  pass:['找到文件','object found'],warn:['—','—'],fail:['`timeout`、`read failed`','`timeout`, `read failed`'],
  reads:['网站存储桶：读取首页文件的信息（HeadObject index.html）。','Site bucket: HeadObject of index.html.']},
 {key:'live-game',critical:true,name:['现场对局和共享草稿','Live game and shared draft'],
  plain:['现场棋局、共享记谱草稿和对局列表能读取。','The live game, the shared recording draft and the game list can be read.'],
  does:['两台设备一起下棋，或一起记录一盘棋。', 'Play a game on two devices, or record one together.'],
  how:["读取现场棋局、共享草稿和对局列表；/health 读取对局数据库。", "Reads the live game, the shared draft and the game list; /health reads the game database."],
  down:['不能下棋或记谱。','Nobody can play or record a game.'],
  pass:['读取成功','read succeeded'],warn:['—','—'],fail:['`timeout`、`read failed`','`timeout`, `read failed`'],
  reads:['DynamoDB 对局表：按固定键读取现场棋局（GetItem，只取键）。','DynamoDB game table: GetItem of the fixed live-game key (key only).']},
 {key:'library',critical:true,name:['棋谱库','Game library'],
  plain:['已保存的棋谱列表和单个棋谱能打开。','The saved-game list and a single saved game open.'],
  does:['浏览和回放已保存的棋谱。', 'Browse and replay saved games.'],
  how:["打开棋谱列表和一盘示例棋谱；/health 读取棋谱存储。", "Opens the game list and one sample game; /health reads the game storage."],
  down:['看不到已保存的棋谱。','Saved games cannot be viewed.'],
  pass:['读取成功','read succeeded'],warn:['—','—'],fail:['`timeout`、`read failed`','`timeout`, `read failed`'],
  reads:['棋谱存储桶：读取一个很小的固定控制文件（GetObject）。','Library bucket: GetObject of one small fixed control file.']},
 {key:'reports',critical:false,name:['棋局报告','Game reports'],
  plain:['已生成的 AI 棋局报告能打开，报告生成程序可用，没有失败的报告在等待。','Prepared AI game reports open, the report renderer is ready, and no failed reports are waiting.'],
  does:['阅读一盘棋的 AI 复盘报告。', 'Read the AI review report of a game.'],
  how:["打开示例棋谱的报告；/health 确认报告程序就绪，且没有失败的报告在等待。", "Opens the sample game's report; /health checks the report maker is ready and no failed reports are waiting."],
  down:['新的报告无法生成；已有报告也可能打不开。','New reports are not made, and existing ones may not open.'],
  pass:['生成程序就绪且队列为空','renderer ready and queue empty'],warn:['`failed reports waiting`，或生成程序正在更新（`function not ready`）','`failed reports waiting`, or the renderer is updating (`function not ready`)'],fail:['`timeout`、`read failed`、`function not ready`','`timeout`, `read failed`, `function not ready`'],
  reads:['报告生成函数的状态（Lambda GetFunctionConfiguration）；失败报告队列是否为空（SQS GetQueueAttributes）。','Report renderer state (Lambda GetFunctionConfiguration); whether the failed-report queue is empty (SQS GetQueueAttributes).']},
 {key:'analysis',critical:false,name:['AI 棋局分析','AI game analysis'],
  plain:['AI 分析没有被费用保护暂停。检查从不启动分析。','AI analysis is not paused by the spending guard. The check never starts an analysis.'],
  does:['每盘保存的棋谱都会得到逐手 AI 分析。', 'Every saved game gets an AI review of each move.'],
  how:["读取示例棋谱的 AI 分析；/health 确认分析没有被费用保护暂停。不会启动新分析。", "Reads the sample game's AI review; /health checks it isn't paused by the spending guard. No analysis is started."],
  down:['新棋谱暂时没有 AI 分析，之后会补上。','New games get no AI analysis for now; it catches up later.'],
  pass:['未暂停','not paused'],warn:['`paused by spending guard`','`paused by spending guard`'],fail:['`timeout`、`read failed`','`timeout`, `read failed`'],
  reads:['与棋谱库同一次读取：控制文件中的暂停标记。','The same control-file read as the library: its paused flag.']},
 {key:'position',critical:false,name:['照片识别和局面分析','Photo recognition and position analysis'],
  plain:['照片识别和局面分析程序可用，且没有被费用保护暂停。检查从不识别照片或分析局面。','The photo-recognition and position-analysis functions are ready and not paused by the spending guard. The check never reads a photo or analyses a position.'],
  does:['拍一张棋盘照片，得到这个局面的 AI 建议。', 'Take a photo of a board and get AI advice for that position.'],
  how:["打开 AI 分析页面；/health 确认两个程序就绪且未暂停。不会分析任何照片。", "Opens the AI analysis page; /health checks both programs are ready and not paused. No photo is analysed."],
  down:['不能用照片或局面做 AI 分析。','Photos and positions cannot be analysed.'],
  pass:['两个函数都就绪且未暂停','both functions ready and not paused'],warn:['`paused by spending guard`，或函数正在更新（`function not ready`）','`paused by spending guard`, or a function is updating (`function not ready`)'],fail:['`timeout`、`read failed`、`function not ready`','`timeout`, `read failed`, `function not ready`'],
  reads:['两个函数的状态（Lambda GetFunctionConfiguration）；控制文件中的暂停标记。','State of both functions (Lambda GetFunctionConfiguration); the control file\'s paused flag.']},
 {key:'signin',critical:false,name:['管理员登录和 API','Admin sign-in and API'],
  plain:['管理员能用微软账户登录，API 拒绝没有令牌的请求。访客不登录也能使用整个网站。','The admin can sign in with Microsoft, and the API refuses requests without a token. Guests use the whole site without signing in.'],
  does:['管理员删除棋谱、修改棋局信息；受信任的工具用 auth.dliu.com 令牌通过 API 读写。', 'The admin deletes saved games and edits game info; trusted tools use an auth.dliu.com token to read and write through the API.'],
  how:["打开管理员登录链接（它会转到微软），并确认没有登录时得到“未登录”；/health 确认管理程序就绪、登录设置存在。", "Opens the admin sign-in link (it goes to Microsoft) and confirms a guest is told they are not signed in; /health checks the admin program is ready and the sign-in settings exist."],
  down:['管理员不能登录，API 不能用；访客照常使用网站。','The admin cannot sign in and the API does not work; guests use the site as usual.'],
  pass:['函数就绪且设置存在','function ready and settings present'],warn:['函数正在更新（`function not ready`）','the function is updating (`function not ready`)'],fail:['`timeout`、`read failed`、`function not ready`、`sign-in not configured`','`timeout`, `read failed`, `function not ready`, `sign-in not configured`'],
  reads:['管理函数的状态（Lambda GetFunctionConfiguration）；两个不保密的登录设置是否存在（SSM GetParameters，不解密；从不读取客户端密钥）。','Admin function state (Lambda GetFunctionConfiguration); whether the two non-secret sign-in settings exist (SSM GetParameters without decryption; the client secret is never read).']}
];
export const healthKeys=healthFunctions.map(f=>f.key);

const page=(key,path)=>({key,method:'GET',path,status:200,type:'text/html',marker:'dl-header',slowMs:2000});
const api=(key,path,marker)=>({key,method:'GET',path,status:200,type:'application/json',marker,slowMs:3000});
export const guestChecks=[
 page('pages','/'),page('pages','/play'),page('pages','/record'),page('pages','/guide'),page('pages','/docs'),
 {key:'pages',method:'GET',path:'/docs/health',status:301,location:'/docs#health'},
 {key:'pages',method:'GET',path:'/docs/health.md',status:200,type:'text/markdown',marker:'# DL Weiqi health checks',slowMs:2000},
 {key:'pages',method:'GET',path:'/docs/cost',status:301,location:'/docs#cost'},
 {key:'pages',method:'GET',path:'/docs/api.md',status:200,type:'text/markdown',marker:'# Weiqi API',slowMs:2000},
 {key:'pages',method:'GET',path:'/about',status:301,location:'/docs'},
 {key:'pages',method:'GET',url:'http://weiqi.dliu.com/',status:301,location:SITE+'/'},
 api('live-game','/api/game','"state"'),api('live-game','/api/draft','"draft"'),api('live-game','/api/games','"games"'),
 page('library','/game'),api('library','/api/library','"games"'),page('library','/game/'+SAMPLE_GAME),api('library','/api/library/'+SAMPLE_GAME,'"metadata"'),
 page('reports','/game/'+SAMPLE_GAME+'/report'),api('reports','/api/library/'+SAMPLE_GAME+'/report','"availableLanguages"'),api('reports','/prepared-reports/'+SAMPLE_GAME+'/index.json','"id"'),
 api('analysis','/api/library/'+SAMPLE_GAME,'"analysis"'),
 page('position','/analysis'),
 {key:'signin',method:'GET',path:'/auth/login',status:302,locationPrefix:'https://login.microsoftonline.com/',slowMs:3000},
 api('signin','/api/owner/session','"signedIn":false'),
 {key:'health',method:'GET',path:'/health',status:'200 or 503',type:'application/health+json',marker:'"status"',slowMs:5000}
];
export const checkUrl=c=>c.url||SITE+c.path;

export const notTested=[
 ['下棋、记谱、保存棋谱：这些会改变共享内容，访客检查不能做。','Playing moves, recording and saving games: these change shared content, so guest checks never do them.'],
 ['真正运行 AI 分析、照片识别或局面分析：每次都要花钱。/health 只确认这些程序已就绪且未暂停。','Actually running AI analysis, photo recognition or position analysis: each run costs money. /health only confirms they are ready and not paused.'],
 ['管理员功能（删除棋谱、修改棋局信息）和 API 的读写：需要管理员登录或令牌，访客检查从不登录。安全测试确认没有登录或令牌时这些全部被拒绝。','Admin actions (deleting games, editing game info) and API reads and writes: they need the admin sign-in or a token, and guest checks never sign in. The security tests confirm every one is refused without them.'],
 ['跟着管理员登录链接去微软：检查只确认链接指向微软，从不打开微软的登录页。','Following the admin sign-in link to Microsoft: checks only confirm it points there and never open Microsoft\'s sign-in page.']
];
// Each page bug that was fixed gets a regression test, listed here (newest first) for /docs#health and health.md.
export const fixedBugs=[
 {found:'2026-11-09',when:['2026年11月9日','9 November 2026'],page:['记谱、对局和棋谱回放','Record, Play and game replay'],
  bug:['音量条调到很低，落子声仍然太响：音量按振幅直接调节，10% 只比最大音量低 20 分贝。','The stone sound stayed too loud even with the volume slider set low: the slider scaled the sound wave directly, so 10% was only 20 dB below full volume.'],
  test:['低音量真的很安静（10% 比最大音量至少低 50 分贝），静音不发声，修复前保存的音量保持原来的响度。','Low settings are really quiet (10% is at least 50 dB below full volume), muted makes no sound, and a volume saved before the fix keeps its old loudness.'],
  file:'tests/stone-sound.test.js'}
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
 outputs:['`timeout`','`read failed`','`function not ready`','`paused by spending guard`','`failed reports waiting`','`sign-in not configured`'],
 example:{status:'warn',time:'2026-11-03T23:00:00.000Z',functions:[
  {key:'pages',name:'Pages',status:'pass'},{key:'live-game',name:'Live game and shared draft',status:'pass'},{key:'library',name:'Game library',status:'pass'},
  {key:'reports',name:'Game reports',status:'warn',output:'failed reports waiting'},{key:'analysis',name:'AI game analysis',status:'pass'},{key:'position',name:'Photo recognition and position analysis',status:'pass'},{key:'signin',name:'Admin sign-in and API',status:'pass'}]}
};

const cell=v=>String(v).replace(/\|/g,'\\|');
export function healthMarkdown(){
 const lines=['# DL Weiqi health checks','','How status.dliu.com (or anyone) can test '+SITE+' as an anonymous guest. This is the full technical version of '+SITE+'/docs#health (the Health tab). Guests use every page without signing in; only the admin signs in, and these checks never do.','',
  '## Functions','','| Key | Name | Critical | What a guest gets | Down means |','|---|---|---|---|---|',
  ...healthFunctions.map(f=>'| `'+f.key+'` | '+f.name[1]+' ('+f.name[0]+') | '+(f.critical?'yes':'no')+' | '+cell(f.plain[1])+' | '+cell(f.down[1])+' |'),'',
  '## Guest checks','','One row per check. Method GET, no cookies. "Type" is a prefix of `Content-Type`. "Marker" is a fixed string in the body (a JSON key for JSON). For redirects, `Location` must equal the given value (or start with it, where the table says so); never follow a redirect to Microsoft. "Slow" is the time above which the check counts as slow.','',
  '| Function | Method | URL | Status | Type | Marker or Location | Slow (ms) |','|---|---|---|---|---|---|---|',
  ...guestChecks.map(c=>'| `'+c.key+'` | '+c.method+' | '+checkUrl(c)+' | '+c.status+' | '+(c.type?'`'+c.type+'`':'—')+' | '+(c.location?'Location: `'+c.location+'`':c.locationPrefix?'Location starts with `'+c.locationPrefix+'`':'`'+cell(c.marker)+'`')+' | '+(c.slowMs??'—')+' |'),'',
  '## Health endpoint','','`GET '+SITE+healthEndpoint.path+'`','',...['caching','timeouts','format','private'].map(k=>'- '+healthEndpoint[k][1]),'- `output` values: '+healthEndpoint.outputs.join(', ')+'.','',
  '| Key | What /health reads | pass | warn | fail |','|---|---|---|---|---|',
  ...healthFunctions.map(f=>'| `'+f.key+'` | '+cell(f.reads[1])+' | '+f.pass[1]+' | '+f.warn[1]+' | '+f.fail[1]+' |'),'',
  'Example response:','','```json',JSON.stringify(healthEndpoint.example,null,2),'```','',
  '## Not tested','',...notTested.map(n=>'- '+n[1]),'',
  '## Regression tests','','Each page bug that was fixed has an automated test that fails if the bug comes back. They run in `make test` (`npm test`), which `make deploy` runs before publishing and stops on a failure. They test the code, not the live site.','',
  '| Found | Page | Bug | What the test checks | Test file |','|---|---|---|---|---|',
  ...fixedBugs.map(b=>'| '+b.found+' | '+b.page[1]+' | '+cell(b.bug[1])+' | '+cell(b.test[1])+' | `'+b.file+'` |'),'',
  '## Rules','',...rules.map(r=>'- '+r[1]),''];
 return lines.join('\n');
}
