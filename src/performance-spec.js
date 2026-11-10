// Performance budgets. One source for tests/performance.test.js, scripts/performance/measure.mjs
// and the Performance tab of /docs (performance.js), so the page always shows the budgets the tests enforce.

// Gzipped size of what a first visit downloads from this site: the HTML, its local CSS and every JavaScript module
// it imports statically. The shared dl.css (files.dliu.com), fonts, images and data fetched later are not counted.
export const PAGE_BUDGETS=[
 {path:'/',file:'index.html',kb:40,name:['首页','Home']},
 {path:'/play',file:'play.html',kb:70,name:['对局','Play']},
 {path:'/game',file:'library.html',kb:40,name:['棋谱库','Library']},
 {path:'/game/<id>',file:'record.html',kb:90,name:['棋谱','Game record']},
 {path:'/game/<id>/report',file:'report.html',kb:30,name:['AI 报告','AI report']},
 {path:'/record',file:'editor.html',kb:80,name:['记录棋谱','Record a game']},
 {path:'/analysis',file:'photo.html',kb:75,name:['AI 分析','AI analysis']},
 {path:'/guide',file:'how-to-use.html',kb:55,name:['使用指南','Guide']},
 {path:'/docs',file:'about.html',kb:110,name:['技术文档','Docs']}
];

// Median of 5 runs on the test machine. Budgets are about 5–10 times today's time, so only a real slowdown fails.
export const CPU_BUDGETS=[
 {id:'play-game',ms:1500,name:['按服务器规则下完 300 手','Play 300 moves with the server rules'],why:['每一步都复制整盘棋；这是对局 API 最重的部分。','Each move copies the whole game; the heaviest part of the game API.']},
 {id:'read-sgf',ms:30,name:['读取一盘 300 手的 SGF','Read a 300-move SGF'],why:['上传、打开棋谱和照片分析都会读取 SGF。','Uploads, game pages and photo analysis all read SGF.']},
 {id:'largest-sgf',ms:75,name:['读取允许的最大 SGF（256 KB）','Read the largest allowed SGF (256 KB)'],why:['上传大小上限下最慢的读取。','The slowest read the upload limit allows.']},
 {id:'recording-tree',ms:40,name:['打开并保存一盘 300 手的记录','Open and save a 300-move recording'],why:['记录棋谱页每次编辑都会做。','The recorder does this on every edit.']}
];

// Live checks from the measuring computer. Only guest GET requests: no cookies, no sign-in, no admin or managed API.
// The public read limit is 120 per minute per connection, so 5 samples of each read never come close.
export const LIVE_SAMPLES=5;
export const LIVE_TARGETS=[
 ...PAGE_BUDGETS.map(page=>({path:page.path,kind:'page',name:page.name})),
 {path:'/api/game',kind:'api',name:['当前对局','Live game']},
 {path:'/api/library',kind:'api',name:['棋谱列表','Game list']},
 {path:'/api/library/<id>',kind:'api',name:['一盘棋谱','One game']},
 {path:'/health',kind:'api',name:['健康检查','Health check']}
];
// Live times depend on where they are measured from, so they are reported, not budgeted; every target must answer 200.
// Rate-limited public reads (/api/library…) per run: one lookup of a game ID plus the samples.
export const RATE_LIMITED_READS=path=>/^\/api\/(library|games)(\/|$)/.test(path);

// Lambda duration over the last 7 days, read from CloudWatch Logs. It does not depend on where the test runs.
export const SERVER_DAYS=7;
export const SERVER_BUDGETS=[
 {id:'game',match:'^WeiqiSite-GameHandler',p95:1000,name:['公共 API','Public API'],role:['对局、棋谱库和局面分析请求','Live game, library and position requests']},
 {id:'owner',match:'^WeiqiSite-OwnerApi',p95:1500,name:['管理员与管理 API','Admin and managed API'],role:['管理员登录、管理工具和 Weiqi API','Admin sign-in, admin tools and the Weiqi API']},
 {id:'health',match:'^WeiqiSite-HealthCheck',p95:3000,name:['健康检查','Health check'],role:['每次检查全部功能','Checks every function each time']},
 {id:'engine',match:'^WeiqiPositionEngine$',p95:10000,name:['局面 AI','Position AI'],role:['KataGo 分析一个局面','KataGo analyses one position']},
 {id:'recognition',match:'^WeiqiPositionRecognition$',p95:20000,name:['照片识别','Photo recognition'],role:['从照片读出棋盘','Reads the board from a photo']},
 {id:'report',match:'^WeiqiSite-ReportRenderer',p95:60000,name:['报告生成','Report renderer'],role:['生成可下载的 AI 报告','Builds the downloadable AI report']}
];
