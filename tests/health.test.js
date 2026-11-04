import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync,existsSync} from 'node:fs';
import {healthFunctions,healthKeys,guestChecks,healthMarkdown,notTested,rules} from '../src/health-spec.js';
// Guards the status.dliu.com contract (status/HEALTH.md): /docs#health, /docs/health.md and GET /health stay in sync.
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8');
const healthSource=read('backend/health.cjs');

function loadHealth(responses={}){
 const calls=[];const commands={};
 for(const name of ['HeadObjectCommand','GetObjectCommand','GetItemCommand','GetQueueAttributesCommand','GetFunctionConfigurationCommand'])commands[name]=class{constructor(input){this.input=input;this.name=name;}};
 const client=()=>class{async send(c){calls.push({name:c.name,input:JSON.parse(JSON.stringify(c.input))});const r=responses[c.name];const v=typeof r==='function'?r(c.input):r;if(v instanceof Error)throw v;return v??{};}};
 const modules={'@aws-sdk/client-s3':{S3Client:client(),HeadObjectCommand:commands.HeadObjectCommand,GetObjectCommand:commands.GetObjectCommand},'@aws-sdk/client-dynamodb':{DynamoDBClient:client(),GetItemCommand:commands.GetItemCommand},'@aws-sdk/client-sqs':{SQSClient:client(),GetQueueAttributesCommand:commands.GetQueueAttributesCommand},'@aws-sdk/client-lambda':{LambdaClient:client(),GetFunctionConfigurationCommand:commands.GetFunctionConfigurationCommand}};
 const exports={},env={SITE_BUCKET:'private-site-bucket',LIBRARY_BUCKET:'private-library-bucket',AI_CONTROL_KEY:'control/ai-spending.json',TABLE_NAME:'private-table',REPORT_DLQ_URL:'https://sqs/private-dlq',REPORT_RENDERER:'private-renderer',POSITION_RECOGNIZER:'private-recognizer',POSITION_ENGINE:'private-engine'};
 vm.runInNewContext(healthSource,{exports,module:{exports},require:name=>modules[name],process:{env},setTimeout,clearTimeout,Promise,JSON,Number,Object,Error,Date});
 return {handler:exports.handler,calls,FUNCTIONS:exports.FUNCTIONS};
}
const control=paused=>({Body:{transformToString:async()=>JSON.stringify({paused})}});
const healthy={GetObjectCommand:control(false),GetQueueAttributesCommand:{Attributes:{ApproximateNumberOfMessages:'0'}},GetFunctionConfigurationCommand:{State:'Active',LastUpdateStatus:'Successful'}};
const run=async responses=>{const h=loadHealth(responses),res=await h.handler();return {...h,res,body:JSON.parse(res.body)};};
const byKey=body=>Object.fromEntries(body.functions.map(f=>[f.key,f]));

test('GET /health passes with one cheap read per dependency, the health+json type and a 60 s cache',async()=>{
 const {res,body,calls}=await run(healthy);
 assert.equal(res.statusCode,200);assert.equal(res.headers['content-type'],'application/health+json');assert.equal(res.headers['cache-control'],'public, max-age=60');
 assert.equal(body.status,'pass');assert.ok(!Number.isNaN(Date.parse(body.time)));
 assert.deepEqual(body.functions.map(f=>f.key),healthKeys);assert.ok(body.functions.every(f=>f.status==='pass'&&!('output' in f)));
 assert.deepEqual(calls.map(c=>c.name).sort(),['GetFunctionConfigurationCommand','GetFunctionConfigurationCommand','GetFunctionConfigurationCommand','GetItemCommand','GetObjectCommand','GetQueueAttributesCommand','HeadObjectCommand']);
 assert.deepEqual(calls.find(c=>c.name==='GetItemCommand').input,{TableName:'private-table',Key:{gameId:{S:'current'}},ProjectionExpression:'gameId'});
 assert.equal(calls.find(c=>c.name==='HeadObjectCommand').input.Key,'index.html');
});

test('the spending guard, failed reports and updating functions warn but keep HTTP 200',async()=>{
 const {res,body}=await run({...healthy,GetObjectCommand:control(true),GetQueueAttributesCommand:{Attributes:{ApproximateNumberOfMessages:'3'}}});
 const f=byKey(body);assert.equal(res.statusCode,200);assert.equal(body.status,'warn');
 assert.deepEqual([f.analysis.output,f.position.output,f.reports.output],['paused by spending guard','paused by spending guard','failed reports waiting']);
 assert.equal(f.library.status,'pass');
 const updating=await run({...healthy,GetFunctionConfigurationCommand:i=>i.FunctionName==='private-engine'?{State:'Active',LastUpdateStatus:'InProgress'}:{State:'Inactive'}});
 assert.equal(updating.body.status,'warn');assert.equal(byKey(updating.body).position.output,'function not ready');assert.equal(byKey(updating.body).reports.status,'pass');
});

test('a failed dependency returns 503 with only a generic reason and no private details',async()=>{
 const denied=Object.assign(Error('User: arn:aws:sts::123456789012:assumed-role/x is not authorized on table private-table'),{name:'AccessDeniedException'});
 const {res,body}=await run({...healthy,GetItemCommand:denied,GetFunctionConfigurationCommand:i=>i.FunctionName==='private-renderer'?{State:'Failed'}:{State:'Active'}});
 const f=byKey(body);assert.equal(res.statusCode,503);assert.equal(body.status,'fail');
 assert.equal(f['live-game'].output,'read failed');assert.equal(f.reports.output,'function not ready');assert.equal(f.pages.status,'pass');
 for(const secret of ['arn:','123456789012','private','control/','sqs','AccessDenied','not authorized'])assert.ok(!res.body.includes(secret),secret);
 const missing=await run({...healthy,GetObjectCommand:Object.assign(Error('gone'),{name:'NoSuchKey'})});
 assert.equal(byKey(missing.body).library.status,'pass');assert.equal(byKey(missing.body).analysis.status,'pass');
 const broken=await run({...healthy,GetObjectCommand:Object.assign(Error('denied'),{name:'AccessDenied'})});
 assert.deepEqual(['library','analysis','position'].map(k=>byKey(broken.body)[k].output),['read failed','read failed','read failed']);
});

test('a hung dependency times out after about 2 s instead of hanging the response',async()=>{
 const started=Date.now(),{res,body}=await run({...healthy,HeadObjectCommand:()=>new Promise(()=>{})});
 assert.ok(Date.now()-started<3500);assert.equal(res.statusCode,503);assert.equal(byKey(body).pages.output,'timeout');
});

test('the /health handler reads no part of the request and never writes or starts work',()=>{
 assert.match(healthSource,/exports\.handler=async\(\)=>/);
 const code=healthSource.replace(/^\/\/.*$/gm,'');
 assert.doesNotMatch(code,/cookie|authorization|headers\[|event|querystring|rawPath|requestContext/i);
 assert.doesNotMatch(code,/(Put|Delete|Update|Invoke|SendMessage|ListObjects|Scan|Query|SubmitJob|RunTask|StartExecution)\w*Command/);
});

test('page, Markdown and endpoint list the same functions and guest checks',()=>{
 const {FUNCTIONS}=loadHealth();
 assert.deepEqual(JSON.parse(JSON.stringify(FUNCTIONS)),healthFunctions.map(f=>[f.key,f.name[1]]));
 for(const f of healthFunctions)for(const field of ['name','plain','down','reads','pass','warn','fail'])assert.ok(f[field][0]&&f[field][1],f.key+' '+field);
 for(const c of guestChecks)assert.ok([...healthKeys,'health'].includes(c.key),c.key);
 for(const key of healthKeys)assert.ok(guestChecks.some(c=>c.key===key),key+' has a guest check');
 const md=read('src/health.md');assert.equal(md,healthMarkdown(),'run node scripts/build-health-md.mjs');
 for(const f of healthFunctions)assert.ok(md.includes('| `'+f.key+'` | '+f.name[1]),f.key);
 for(const c of guestChecks)assert.ok(md.includes(c.url??'https://weiqi.dliu.com'+c.path),c.path);
 for(const n of [...notTested,...rules])assert.ok(md.includes(n[1]),n[1]);
 assert.match(md,/application\/health\+json/);assert.match(md,/max-age=60/);
});

test('/docs#health is the Health tab on /docs, with a diagram, folded technical details and a link to the Markdown',()=>{
 const html=read('src/about.html'),about=read('src/about.js'),docs=read('src/documents.js'),shell=read('src/site-shell.js'),c={};
 assert.match(html,/dl-docs\.css/);assert.match(html,/rel="alternate" type="text\/markdown" href="\/docs\/health\.md"/);
 assert.ok(!existsSync(new URL('../src/site-health.html',import.meta.url)),'the separate page is gone');
 assert.match(about,/import \{renderDocument\} from '\.\/documents\.js'/);
 assert.match(about,/location\.hash==='#health'\)\{renderDocument\('health'/);assert.match(about,/addEventListener\('hashchange',render\)/);
 assert.match(docs,/export function renderDocument\(/);assert.match(docs,/if\(document\.body\.dataset\.document\)/);
 assert.ok(shell.includes("['/docs#health','健康','Health']"));assert.match(shell,/location\.hash==='#health'/);
 vm.runInNewContext(read('src/routes.cjs'),c);
 const go=(uri,querystring={})=>c.handler({request:{uri,querystring}});
 assert.equal(go('/docs').uri,'/about.html');
 for(const old of ['/docs/health','/docs/health/','/site-health.html']){const r=go(old);assert.equal(r.statusCode,301);assert.equal(r.headers.location.value,'/docs#health');}
 assert.equal(go('/docs/health',{lang:{value:'en'}}).headers.location.value,'/docs?lang=en#health');
 assert.equal(go('/about').headers.location.value,'/docs');
 assert.equal(go('/docs/health.md').uri,'/docs/health.md');
 const publish=read('scripts/publish-site.sh');
 assert.ok(!publish.includes('site-health.html')&&publish.includes('health-spec.js')&&publish.includes('documents.js'));
 assert.match(publish,/s3:\/\/\$SITE_BUCKET_NAME\/docs\/health\.md" --content-type 'text\/markdown; charset=utf-8'/);
});

test('the Health tab is for people: flows, numbers, a table and a chart, with no exact technical details',()=>{
 const docs=read('src/documents.js'),block=docs.slice(docs.indexOf('// /docs#health is for people'),docs.indexOf('// /docs#health reuses'));
 assert.ok(block.length>500);
 for(const piece of ['stats([','tiers({title:','flow({title:',"tone:'good'","tone:'warn'","tone:'bad'",'healthChart()','table([','ul(notTested)'])assert.ok(block.includes(piece),piece);
 for(const banned of ['more(','code(',"'details'",'<details','dg-more','<code','checkUrl','healthEndpoint','.path','.status==','rules'])assert.ok(!block.includes(banned),banned);
 const exact={test:text=>/https?:\/\/|`|\b[1-5]\d\d\b|application\/|text\/|\bGET\b|\bHEAD\b|\{"/.test(text)||/content-type|cache-control|\bjson\b/i.test(text)};
 const literals=[...block.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m=>m[1]).filter(x=>!['/health','health-mark','https://status.dliu.com/site/weiqi'].includes(x));
 for(const text of literals)assert.ok(!exact.test(text)||text==="/health",text);
 for(const fn of healthFunctions)for(const field of ['name','does','how','down'])for(const text of fn[field])assert.ok(!exact.test(text),fn.key+'.'+field+': '+text);
 for(const n of notTested)for(const text of n)assert.ok(!exact.test(text),text);
 assert.match(docs,/health:\{title:\[[^\]]+\],intro:healthIntro,sections:healthSections,sourcesTitle:null,links:\[\['\/docs\/health\.md','给机器看的技术版本（Markdown）','Technical version for machines \(Markdown\)'\]\]\}/);
 assert.equal((docs.match(/href='\/docs\/health\.md'/g)||[]).length,1,'one link to the Markdown under the heading, plus the one at the end');
 assert.match(block,/status\.href='https:\/\/status\.dliu\.com\/site\/weiqi'/,'links to its own status page');
 const intro=block.slice(block.indexOf('function healthIntro'));assert.ok(intro.indexOf("link.href='/docs/health.md'")<intro.indexOf('stats(['),'the Markdown link comes first');
 for(const piece of ['tiers({title:',"tone:'untrusted'","tone:'edge'","tone:'app'","tone:'private'","icon:'cloudfront'","icon:'lambda'","icon:'dynamodb'"])assert.ok(block.includes(piece),piece);
});
