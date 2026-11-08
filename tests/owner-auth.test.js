import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {gameTree,gameClock} from '../src/engine.js';
import {createState,transition,GameError} from '../backend/game-service.js';
import {gamePrefix,recordIndexKey} from '../backend/library-service.js';
import {padMoves} from './fixtures/long-game.js';
// Owner sign-in and the managed API. Guests (no sign-in, no Microsoft token) must get nothing new:
// no delete, no upload, no lifted limits. Each regression here is listed on /docs#health ("Signed-in features").
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const strip=source=>source.replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replace(/^module.exports=.*;$/gm,'');
const SITE='https://weiqi.dliu.com',TENANT='tenant-1',CLIENT='site-client';
const params={'/dliu/entra-tenant-id':TENANT,'/weiqi/entra-client-id':CLIENT,'/weiqi/entra-client-secret':'site-secret'};
const config={tenantId:TENANT,clientId:CLIENT,clientSecret:'site-secret',allowedDomain:'dliu.com'};
const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'k1'};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function idToken(claims,key=privateKey){const head=b64({alg:'RS256',kid:'k1'})+'.'+b64(claims);return head+'.'+crypto.sign('RSA-SHA256',Buffer.from(head),key).toString('base64url');}
const goodClaims=nonce=>({iss:'https://login.microsoftonline.com/'+TENANT+'/v2.0',tid:TENANT,aud:CLIENT,exp:Math.floor(Date.now()/1000)+600,nbf:Math.floor(Date.now()/1000)-10,nonce,preferred_username:'me@dliu.com',name:'Dewei Liu',oid:'owner-oid'});
function microsoft(claimsFor){
 const calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url,options});
  if(url.endsWith('/discovery/v2.0/keys'))return {ok:true,json:async()=>({keys:[jwk]})};
  return {ok:true,status:200,json:async()=>({id_token:idToken(claimsFor(calls))})};};
 return {fetchImpl,calls};
}
function ssm(){
 const calls=[];class GetParametersCommand{constructor(input){this.input=input;}}
 class SSMClient{async send(c){calls.push(c.input);return {Parameters:c.input.Names.filter(n=>params[n]).map(Name=>({Name,Value:params[Name]}))};}}
 return {calls,module:{SSMClient,GetParametersCommand}};
}
function loadAuth(env={}){
 const exports={},parameterStore=ssm();
 vm.runInNewContext(strip(read('backend/auth.cjs'))+'\nexports.auth=weiqiAuth;',{exports,require:name=>name==='node:crypto'?crypto:name==='@aws-sdk/client-ssm'?parameterStore.module:undefined,process:{env},Buffer,URLSearchParams,console});
 return {auth:exports.auth,ssmCalls:parameterStore.calls};
}
const cookieValue=(cookies,name)=>cookies.find(c=>c.startsWith(name+'='))?.split(';')[0];
const now=Date.now(),seconds=Math.floor(now/1000);

test('a session cookie needs the session key, the session type and an unexpired time',()=>{
 const {auth}=loadAuth(),sessionKey=auth.sessionKey(config),loginKey=auth.loginKey(config);
 const event=token=>({cookies:[auth.SESSION_COOKIE+'='+token]});
 const good=auth.sign({typ:'session',user:'me@dliu.com',exp:seconds+60},sessionKey);
 assert.equal(auth.getSession(event(good),config).user,'me@dliu.com');
 const [body,mac]=good.split('.');
 assert.equal(auth.getSession(event(body+'.'+Buffer.from('forged').toString('base64url')),config),null,'forged MAC');
 assert.equal(auth.getSession(event(b64({typ:'session',user:'x@dliu.com',exp:seconds+60})+'.'+mac),config),null,'swapped payload');
 assert.equal(auth.getSession(event(auth.sign({typ:'session',user:'me@dliu.com',exp:seconds-1},sessionKey)),config),null,'expired');
 assert.equal(auth.getSession(event(auth.sign({typ:'login',user:'me@dliu.com',exp:seconds+60},sessionKey)),config),null,'login type');
 assert.equal(auth.getSession(event(auth.sign({typ:'session',user:'me@dliu.com',exp:seconds+60},loginKey)),config),null,'login key');
 assert.equal(auth.getSession(event(auth.sign({typ:'session',user:'me@dliu.com',exp:seconds+60},auth.sessionKey({...config,clientSecret:'other'}))),config),null,'other secret');
 assert.equal(auth.getSession({cookies:['weiqi_owner=1']},config),null,'the page hint is not a session');
 assert.equal(auth.hasSessionCookie({cookies:['weiqi_owner=1']}),false);
});

test('the sign-in cookie that /auth/login gives anyone can never be replayed as a session',()=>{
 const {auth}=loadAuth(),login=auth.startLogin(config,SITE,now,'/library');
 const value=cookieValue(login.cookies,auth.AUTH_COOKIE).split('=')[1];
 assert.equal(auth.getSession({cookies:[auth.SESSION_COOKIE+'='+value]},config),null);
 const url=new URL(login.location);
 assert.equal(url.origin+url.pathname,'https://login.microsoftonline.com/'+TENANT+'/oauth2/v2.0/authorize');
 assert.equal(url.searchParams.get('redirect_uri'),SITE+'/auth/callback');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('client_id'),CLIENT);assert.ok(url.searchParams.get('nonce')&&url.searchParams.get('state'));
 assert.match(login.cookies[0],/^__Host-weiqi_auth=[^;]+; Path=\/; Max-Age=600; Secure; HttpOnly; SameSite=Lax$/);
 for(const bad of ['//evil.com','/\\evil.com','https://evil.com','/a b',' /x'])assert.equal(auth.safeReturnPath(bad),'/',bad);
 assert.equal(auth.safeReturnPath('/game/2026101001?lang=en'),'/game/2026101001?lang=en');
});

async function signIn(auth,claims){
 const login=auth.startLogin(config,SITE,Date.now(),'/library'),state=new URL(login.location).searchParams.get('state'),nonce=new URL(login.location).searchParams.get('nonce');
 const {fetchImpl,calls}=microsoft(()=>claims(nonce));
 const event={queryStringParameters:{code:'code-1',state},cookies:[cookieValue(login.cookies,auth.AUTH_COOKIE)]};
 return {result:await auth.finishLogin(event,config,SITE,{fetchImpl}),calls,login,state};
}
test('Microsoft sign-in creates a 30-day session only for a verified @dliu.com account',async()=>{
 const {auth}=loadAuth();
 const {result,calls}=await signIn(auth,goodClaims);
 assert.equal(result.location,'/library');assert.equal(calls[0].url,'https://login.microsoftonline.com/'+TENANT+'/oauth2/v2.0/token');
 assert.match(String(calls[0].options.body),/code_verifier=/);
 const session=cookieValue(result.cookies,auth.SESSION_COOKIE);
 assert.match(result.cookies.find(c=>c.startsWith('__Host-weiqi_session=')),/Max-Age=2592000; Secure; HttpOnly; SameSite=Lax$/);
 assert.match(result.cookies.find(c=>c.startsWith('weiqi_owner=')),/^weiqi_owner=1; Path=\/; Max-Age=2592000; Secure; SameSite=Lax$/);
 assert.equal(auth.getSession({cookies:[session]},config).name,'Dewei Liu');
 for(const user of ['someone@gmail.com','me@dliu.com.evil.com','me@evil-dliu.com']){
  const {result:refused}=await signIn(auth,nonce=>({...goodClaims(nonce),preferred_username:user,email:undefined,upn:undefined}));
  assert.equal(refused.status,403,user);assert.equal(cookieValue(refused.cookies,auth.SESSION_COOKIE),undefined,user);
 }
 for(const [name,change] of [['nonce',{nonce:'other'}],['audience',{aud:'other'}],['issuer',{iss:'https://login.microsoftonline.com/other/v2.0'}],['tenant',{tid:'other'}],['expiry',{exp:seconds-600}]])
  await assert.rejects(signIn(auth,nonce=>({...goodClaims(nonce),...change})),undefined,name);
 const forged=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
 const login=auth.startLogin(config,SITE,Date.now()),state=new URL(login.location).searchParams.get('state'),nonce=new URL(login.location).searchParams.get('nonce');
 const forgedFetch=async url=>url.endsWith('/keys')?{ok:true,json:async()=>({keys:[jwk]})}:{ok:true,json:async()=>({id_token:idToken(goodClaims(nonce),forged)})};
 await assert.rejects(auth.finishLogin({queryStringParameters:{code:'c',state},cookies:[cookieValue(login.cookies,auth.AUTH_COOKIE)]},config,SITE,{fetchImpl:forgedFetch}),/signature/);
});

test('a callback without the matching sign-in cookie or with attacker text is refused',async()=>{
 const {auth}=loadAuth(),{fetchImpl,calls}=microsoft(()=>({}));
 const login=auth.startLogin(config,SITE,now),state=new URL(login.location).searchParams.get('state');
 assert.equal((await auth.finishLogin({queryStringParameters:{code:'c',state}},config,SITE,{fetchImpl})).status,400);
 assert.equal((await auth.finishLogin({queryStringParameters:{code:'c',state:'other'},cookies:[cookieValue(login.cookies,auth.AUTH_COOKIE)]},config,SITE,{fetchImpl})).status,400);
 const shown=await auth.finishLogin({queryStringParameters:{error:'<script>alert(1)</script>'}},config,SITE,{fetchImpl});
 assert.equal(shown.error,'Sign-in failed: unknown_error');
 assert.equal((await auth.finishLogin({queryStringParameters:{error:'access_denied'}},config,SITE,{fetchImpl})).error,'Sign-in failed: access_denied');
 assert.equal(calls.length,0,'no token exchange');
});

// The public website Lambda: an owner session lifts only per-connection shares; nothing else changes.
function gameHandler(env={}){
 const rows=new Map(),parameterStore=ssm();
 class GetItemCommand{constructor(input){this.input=input;}}
 class PutItemCommand{constructor(input){this.input=input;}}
 class ScanCommand{constructor(input){this.input=input;}}
 class TransactWriteItemsCommand{constructor(input){this.input=input;}}
 class UpdateItemCommand{constructor(input){this.input=input;}}
 class DynamoDBClient{async send(c){
  if(c instanceof UpdateItemCommand){const key=c.input.Key.id.S,used=rows.get(key)||0;if(used>=Number(c.input.ExpressionAttributeValues[':limit'].N))throw Object.assign(Error(),{name:'ConditionalCheckFailedException'});rows.set(key,used+1);return {};}
  if(c instanceof ScanCommand)return {Items:[]};if(c instanceof GetItemCommand)return {};return {};}}
 const exports={},modules={'@aws-sdk/client-dynamodb':{DynamoDBClient,GetItemCommand,PutItemCommand,ScanCommand,TransactWriteItemsCommand,UpdateItemCommand},'node:crypto':crypto,'@aws-sdk/client-ssm':parameterStore.module};
 vm.runInNewContext(['backend/client-limit.cjs','backend/auth.cjs','backend/handler.cjs'].map(f=>strip(read(f))).join('\n'),{exports,require:name=>modules[name],
  process:{env:{TABLE_NAME:'game',SITE_ORIGIN:SITE,POSITION_USAGE_TABLE:'usage',CLIENT_EDITS_PER_MINUTE:'1',SITE_EDITS_PER_MINUTE:'3',CLIENT_READS_PER_MINUTE:'1',...env}},
  Buffer,URLSearchParams,console,structuredClone,gameTree,gameClock,createState,transition,GameError});
 const call=(path,{method='GET',cookies}={})=>exports.handler({rawPath:path,cookies,requestContext:{http:{method}},headers:{'content-type':'application/json',origin:SITE,'x-weiqi-viewer':'203.0.113.9'},body:method==='POST'?'{}':undefined});
 return {call,ssmCalls:parameterStore.calls};
}
const ownerCookie=(claims={})=>{const {auth}=loadAuth();return auth.SESSION_COOKIE+'='+auth.sign({typ:'session',user:'me@dliu.com',name:'Dewei Liu',oid:'owner-oid',exp:seconds+600,...claims},auth.sessionKey(config));};

test('guests keep every public limit and never cause a sign-in lookup',async()=>{
 const h=gameHandler(),hint=['weiqi_owner=1'];
 assert.equal((await h.call('/api/games',{cookies:hint})).statusCode,200);
 assert.equal((await h.call('/api/games',{cookies:hint})).statusCode,429,'read share');
 assert.notEqual((await h.call('/api/game',{method:'POST'})).statusCode,429);
 const edit=await h.call('/api/game',{method:'POST',cookies:hint});
 assert.equal(edit.statusCode,429);assert.match(JSON.parse(edit.body).message,/from this connection/);
 assert.equal(h.ssmCalls.length,0,'no cookie, no parameter read');
 assert.equal((await gameHandler().call('/api/owner/library/2026101001/delete',{method:'POST',cookies:[ownerCookie()]})).statusCode,404,'the public Lambda has no owner routes');
});

test('forged, expired, login-typed and other-key cookies are treated as guests',async()=>{
 const {auth}=loadAuth();
 for(const cookie of [auth.SESSION_COOKIE+'=garbage',ownerCookie({exp:seconds-5}),ownerCookie({typ:'login'}),auth.SESSION_COOKIE+'='+auth.sign({typ:'session',user:'x',exp:seconds+600},auth.loginKey(config))]){
  const h=gameHandler();
  assert.equal((await h.call('/api/games',{cookies:[cookie]})).statusCode,200);
  assert.equal((await h.call('/api/games',{cookies:[cookie]})).statusCode,429,cookie.slice(0,40));
 }
});

test('a signed-in owner skips per-connection shares but not the site-wide caps',async()=>{
 const h=gameHandler(),cookies=[ownerCookie()];
 for(let n=0;n<3;n++)assert.equal((await h.call('/api/games',{cookies})).statusCode,200);
 for(let n=0;n<3;n++)assert.notEqual((await h.call('/api/game',{method:'POST',cookies})).statusCode,429,'edit '+n);
 const capped=await h.call('/api/game',{method:'POST',cookies});
 assert.equal(capped.statusCode,429);assert.match(JSON.parse(capped.body).message,/^Too many edits\./);
 assert.equal(h.ssmCalls.length,1,'parameters are cached');
 const broken=gameHandler({PARAMETER_PREFIX:'/missing'});
 assert.equal((await broken.call('/api/games',{cookies})).statusCode,200);assert.equal((await broken.call('/api/games',{cookies})).statusCode,429,'unconfigured sign-in means guest');
});

test('the public website Lambda code cannot delete anything',()=>{
 for(const file of ['backend/handler.cjs','backend/client-limit.cjs','backend/auth.cjs','backend/library-handler.cjs','backend/position-handler.cjs'])assert.doesNotMatch(read(file),/Delete(Object|Item)/,file);
});

// OwnerApi: owner website routes and the managed API, bundled like the CDK stack does.
const API='api-1',AUDIENCE='api://dliu-api',API_CLIENT='dliu-api-client';
const ownerSources=['src/engine.js','backend/game-service.js','src/sgf.js','src/recording-tree.js','backend/draft-service.js','src/ai-review.js','src/report-insights.js','src/report-data.js','backend/library-service.js','src/queue-estimate.js','backend/share-preview.cjs','backend/library-handler.cjs','backend/queue-status.cjs','backend/auth.cjs'];
function ownerApi(env={}){
 const buckets={library:new Map(),site:new Map()},deletes=[],messages=[],rows=new Map(),parameterStore=ssm();
 const command=name=>class{constructor(input){this.input=input;this.name=name;}};
 const S3={GetObjectCommand:command('Get'),PutObjectCommand:command('Put'),ListObjectsV2Command:command('List'),DeleteObjectCommand:command('Delete')};
 class S3Client{async send(c){const files=buckets[c.input.Bucket],key=c.input.Key;
  if(c.name==='Get'){if(!files.has(key))throw Object.assign(Error(),{name:'NoSuchKey'});return {ETag:'e',Body:{transformToString:async()=>files.get(key)}};}
  if(c.name==='Put'){if(c.input.IfNoneMatch==='*'&&files.has(key))throw Object.assign(Error(),{$metadata:{httpStatusCode:412}});files.set(key,c.input.Body);return {};}
  if(c.name==='Delete'){deletes.push(c.input.Bucket+':'+key);files.delete(key);return {};}
  const keys=[...files.keys()].filter(k=>k.startsWith(c.input.Prefix)).sort(),offset=Number(c.input.ContinuationToken||0);
  return {Contents:keys.slice(offset,offset+c.input.MaxKeys).map(Key=>({Key})),NextContinuationToken:keys.length>offset+c.input.MaxKeys?String(offset+c.input.MaxKeys):undefined};}}
 class SQSClient{async send(c){messages.push(c.input);return {};}}
 class BatchClient{async send(){return {jobs:[],jobSummaryList:[]};}}
 class GetItemCommand{constructor(input){this.input=input;}}
 class DynamoDBClient{async send(c){return {Item:rows.get(c.input.Key.gameId.S)};}}
 const modules={'@aws-sdk/client-s3':{S3Client,...S3},'@aws-sdk/client-sqs':{SQSClient,SendMessageCommand:command('Send')},'@aws-sdk/client-batch':{BatchClient,DescribeJobsCommand:command('Describe'),ListJobsCommand:command('ListJobs')},'@aws-sdk/client-dynamodb':{DynamoDBClient,GetItemCommand},'@aws-sdk/client-ssm':parameterStore.module,'node:crypto':crypto,'node:zlib':{deflateSync}};
 const exports={},source=ownerSources.map(f=>strip(read(f))).join('\n')+'\nconst MANAGED_ROUTES='+read('backend/managed-routes.json')+';\n'+strip(read('backend/owner-api.cjs'))
  +'\nexports.seed=async(sgf,id)=>{const m=await uploadRecord(libraryStore,sgf,"seed.sgf",id);await saveSharePreview(sgf,m);return m;};';
 const microsoftLogin=microsoft(()=>goodClaims(new URL(exports.lastLogin).searchParams.get('nonce')));
 vm.runInNewContext(source,{exports,require:name=>modules[name],fetch:microsoftLogin.fetchImpl,
  process:{env:{LIBRARY_BUCKET:'library',SITE_BUCKET:'site',AI_CONTROL_KEY:'control/ai-spending.json',ANALYSIS_QUEUE:'analysis',TABLE_NAME:'game',SITE_ORIGIN:SITE,API_GATEWAY_ID:API,API_TENANT_ID:TENANT,API_AUDIENCE:AUDIENCE,API_CLIENT_ID:API_CLIENT,...env}},
  Buffer,URLSearchParams,TextEncoder,structuredClone,console,setTimeout,clearTimeout});
 const web=async(path,{method='GET',cookies,headers={'content-type':'application/json',origin:SITE},query,body}={})=>{
  const r=await exports.handler({version:'2.0',routeKey:'$default',rawPath:path,queryStringParameters:query,cookies,headers,body:body??(method==='POST'?'{}':undefined),requestContext:{http:{method}}});
  if(path==='/auth/login'&&r.headers?.location)exports.lastLogin=r.headers.location;return r;};
 const claims=(over={})=>({ver:'2.0',iss:'https://login.microsoftonline.com/'+TENANT+'/v2.0',tid:TENANT,aud:AUDIENCE,oid:'caller-oid',sub:'caller-sub',azp:API_CLIENT,roles:'[api.access]',name:'API caller',...over});
 const managed=async(routeKey,{scopes=['weiqi.read','weiqi.write','weiqi.delete'],claims:c=claims(),apiId=API,pathParameters,query,body,cookies,contentType='application/json'}={})=>{
  const [method,template]=routeKey.split(' '),rawPath=template.replace(/\{(\w+)\}/g,(_,k)=>pathParameters[k]);
  const r=await exports.handler({version:'2.0',routeKey,rawPath,pathParameters,queryStringParameters:query,cookies,headers:{'content-type':contentType},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),requestContext:{apiId,routeKey,http:{method},authorizer:c?{jwt:{claims:c,scopes}}:undefined}});
  return {status:r.statusCode,...JSON.parse(r.body)};};
 return {exports,web,managed,claims,buckets,deletes,messages,rows,ssmCalls:parameterStore.calls,microsoftCalls:microsoftLogin.calls};
}
const longGame=(name='API game',moves=60)=>'(;GM[1]FF[4]SZ[19]KM[7.5]GN['+name+']'+padMoves(moves)+')';
async function seedReady(h,name='Seed',uploadId=crypto.randomUUID()){
 const m=await h.exports.seed(longGame(name),uploadId),key=gamePrefix(m.id)+'/metadata.json',meta=JSON.parse(h.buckets.library.get(key));
 meta.analysis={status:'ready',available:'deep',quick:{status:'ready'},deep:{status:'ready'}};h.buckets.library.set(key,JSON.stringify(meta));
 h.buckets.library.set(gamePrefix(m.id)+'/analysis.json','{}');h.buckets.site.set('prepared-reports/'+m.id+'/index.json','{}');h.buckets.site.set('prepared-reports/'+m.id+'/en.pdf','pdf');
 return meta;
}

test('guests get only sign-in and a signed-out session answer from OwnerApi',async()=>{
 const h=ownerApi(),meta=await seedReady(h),before=[...h.buckets.library.keys()].length;
 const session=await h.web('/api/owner/session',{cookies:['weiqi_owner=1']});
 assert.deepEqual(JSON.parse(session.body),{signedIn:false});assert.equal(session.headers['cache-control'],'no-store');
 const path='/api/owner/library/'+meta.id+'/delete';
 assert.equal((await h.web(path,{method:'POST'})).statusCode,401);
 assert.equal((await h.web(path,{method:'POST',cookies:['weiqi_owner=1']})).statusCode,401);
 assert.equal((await h.web(path,{method:'POST',headers:{'content-type':'application/json'},cookies:[ownerCookie()]})).statusCode,403,'Origin is required');
 assert.equal((await h.web(path,{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},cookies:[ownerCookie()]})).statusCode,403);
 assert.equal((await h.web(path,{method:'POST',headers:{'content-type':'text/plain',origin:SITE},cookies:[ownerCookie()]})).statusCode,415);
 assert.equal((await h.web(path,{cookies:[ownerCookie()]})).statusCode,405,'GET never deletes');
 for(const cookie of [ownerCookie({exp:seconds-5}),ownerCookie({typ:'login'}),'__Host-weiqi_session=garbage'])
  assert.equal((await h.web(path,{method:'POST',cookies:[cookie]})).statusCode,401,cookie.slice(0,40));
 assert.equal((await h.web('/api/owner/anything')).statusCode,404);assert.equal((await h.web('/api/library')).statusCode,404,'website events never reach the managed API');
 assert.equal((await h.web('/api/library',{headers:{authorization:'Bearer x'}})).statusCode,404);
 assert.equal(h.deletes.length,0);assert.equal([...h.buckets.library.keys()].length,before);
 assert.equal(h.ssmCalls.length,1,'only the requests that carried a session cookie read parameters');
});

test('sign-in routes redirect to Microsoft, finish with a session and sign out cleanly',async()=>{
 const h=ownerApi();
 const login=await h.web('/auth/login',{query:{return:'/library'}});
 assert.equal(login.statusCode,302);assert.match(login.headers.location,/^https:\/\/login\.microsoftonline\.com\/tenant-1\/oauth2\/v2\.0\/authorize\?/);
 assert.equal((await h.web('/auth/login',{query:{return:'//evil.com'}})).statusCode,302);
 const auth=cookieValue((await h.web('/auth/login',{query:{return:'/library'}})).cookies,'__Host-weiqi_auth');
 const callback=await h.web('/auth/callback',{query:{code:'c',state:new URL(h.exports.lastLogin).searchParams.get('state')},cookies:[auth]});
 assert.equal(callback.statusCode,302);assert.equal(callback.headers.location,'/library');
 const session=cookieValue(callback.cookies,'__Host-weiqi_session');assert.ok(session);
 assert.deepEqual(JSON.parse((await h.web('/api/owner/session',{cookies:[session]})).body),{signedIn:true,user:'me@dliu.com',name:'Dewei Liu'});
 const failed=await h.web('/auth/callback',{query:{error:'"><script>x</script>'}});
 assert.equal(failed.statusCode,401);assert.match(failed.headers['content-type'],/^text\/html/);assert.doesNotMatch(failed.body,/<script>/);assert.match(failed.body,/dl\.css/);
 const logout=await h.web('/auth/logout');
 assert.equal(logout.statusCode,302);assert.equal(logout.headers.location,'/');
 for(const name of ['__Host-weiqi_session','__Host-weiqi_auth','weiqi_owner'])assert.match(logout.cookies.find(c=>c.startsWith(name+'=')),/Max-Age=0/);
 const stale=await h.web('/api/owner/session',{cookies:[ownerCookie({exp:seconds-5})]});
 assert.deepEqual(JSON.parse(stale.body),{signedIn:false});assert.ok(stale.cookies.some(c=>c.startsWith('weiqi_owner=;')),'a stale session clears the page hint');
 const unconfigured=ownerApi({PARAMETER_PREFIX:'/missing'});
 assert.equal((await unconfigured.web('/auth/login')).statusCode,503);
});

test('the owner deletes a finished game: unlisted first, metadata last, counters kept, recoverable versions only',async()=>{
 const h=ownerApi(),meta=await seedReady(h),prefix=gamePrefix(meta.id)+'/';
 const r=await h.web('/api/owner/library/'+meta.id+'/delete',{method:'POST',cookies:[ownerCookie()]});
 assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.body),{deleted:meta.id});
 assert.equal(h.deletes[0],'library:'+recordIndexKey(meta));assert.equal(h.deletes.at(-1),'library:'+prefix+'metadata.json');
 for(const key of ['share/'+meta.id+'.html','share/'+meta.id+'.png','prepared-reports/'+meta.id+'/index.json','prepared-reports/'+meta.id+'/en.pdf'])assert.ok(h.deletes.includes('site:'+key),key);
 assert.ok(![...h.buckets.library.keys()].some(k=>k.startsWith(prefix)||k.startsWith('library-index/')));
 assert.ok([...h.buckets.library.keys()].some(k=>k.startsWith('uploads/'))&&[...h.buckets.library.keys()].some(k=>k.startsWith('reservations/')),'daily counters stay');
 assert.equal((await h.web('/api/owner/library/'+meta.id+'/delete',{method:'POST',cookies:[ownerCookie()]})).statusCode,404);
 assert.doesNotMatch(read('backend/owner-api.cjs'),/DeleteObjectVersion|VersionId/);
});

test('the sample game and games still being analysed cannot be deleted',async()=>{
 const h=ownerApi(),cookies=[ownerCookie()];
 assert.equal((await h.web('/api/owner/library/2026101001/delete',{method:'POST',cookies})).statusCode,409);
 assert.equal((await h.web('/api/owner/library/..%2F..%2Fcontrol/delete',{method:'POST',cookies})).statusCode,404);
 const m=await h.exports.seed(longGame('Busy'),crypto.randomUUID()),key=gamePrefix(m.id)+'/metadata.json';
 for(const analysis of [{status:'queued'},{status:'running'},{status:'retry_wait'},{status:'ready',quick:{status:'ready'},deep:{status:'running'}}]){
  h.buckets.library.set(key,JSON.stringify({...m,analysis}));
  assert.equal((await h.web('/api/owner/library/'+m.id+'/delete',{method:'POST',cookies})).statusCode,409,JSON.stringify(analysis));
 }
 assert.equal(h.deletes.length,0);
});

test('the managed API needs a gateway-validated Microsoft token with the api.access role and the route scope',async()=>{
 const h=ownerApi();
 assert.deepEqual(await h.managed('GET /api/me'),{status:200,user:'caller-oid',name:'API caller'});
 assert.equal((await h.managed('GET /api/me',{claims:h.claims({roles:'["api.access","other"]'})})).status,200);
 for(const [name,options] of [['no authorizer',{claims:null}],['other API',{apiId:'other'}],['v1 token',{claims:h.claims({ver:'1.0'})}],['issuer',{claims:h.claims({iss:'https://sts.windows.net/x/'})}],['tenant',{claims:h.claims({tid:'other'})}],['audience',{claims:h.claims({aud:'other'})}],['no oid',{claims:h.claims({oid:''})}]])
  assert.equal((await h.managed('GET /api/me',options)).status,401,name);
 for(const [name,options] of [['other client',{claims:h.claims({azp:'other'})}],['no role',{claims:h.claims({roles:undefined})}],['other role',{claims:h.claims({roles:'[api.reader]'})}],['spoofed role',{claims:h.claims({roles:'[api.access other"]'})}],['no scope',{scopes:[]}],['write scope only',{scopes:['weiqi.write']}]])
  assert.equal((await h.managed('GET /api/me',options)).status,403,name);
 assert.equal((await h.managed('GET /api/me',{claims:null,cookies:[ownerCookie()]})).status,401,'an owner cookie is not a token');
 const meta=await seedReady(h);
 assert.equal((await h.managed('DELETE /api/library/{gameId}',{pathParameters:{gameId:meta.id},scopes:['weiqi.read','weiqi.write']})).status,403);
 assert.equal((await h.managed('POST /api/library',{body:{sgf:longGame()},scopes:['weiqi.read']})).status,403);
 assert.equal(h.deletes.length,0);
 assert.equal((await h.managed('GET /api/unknown')).status,404);
});

test('managed reads return the live game, the shared draft and paged library records',async()=>{
 const h=ownerApi();
 assert.equal((await h.managed('GET /api/game')).state.phase,createState().phase);
 h.rows.set('record-draft',{state:{S:JSON.stringify({revision:7,sgf:'(;SZ[19])',selected:0})}});
 assert.equal((await h.managed('GET /api/draft')).draft.revision,7);
 for(let n=0;n<3;n++)await seedReady(h,'Game '+n);
 const page=await h.managed('GET /api/library',{query:{limit:'2'}});
 assert.equal(page.games.length,2);assert.ok(page.cursor);assert.equal(page.total,3);
 assert.equal((await h.managed('GET /api/library')).games.length,3);
 for(const limit of ['0','51','x','2.5'])assert.equal((await h.managed('GET /api/library',{query:{limit}})).status,400,limit);
 const one=await h.managed('GET /api/library/{gameId}',{pathParameters:{gameId:page.games[0].id}});
 assert.equal(one.status,200);assert.match(one.sgf,/GN\[Game/);
 assert.equal((await h.managed('GET /api/library/{gameId}',{pathParameters:{gameId:'2026010199'}})).status,404);
});

test('managed uploads follow the Save game rules, honour the daily cap and are safe to retry',async()=>{
 const h=ownerApi();
 const saved=await h.managed('POST /api/library',{body:{sgf:longGame('From API'),filename:'club.sgf',requestId:'club-1'}});
 assert.equal(saved.status,201);assert.match(saved.id,/^[0-9]{10}$/);assert.equal(saved.url,SITE+'/game/'+saved.id);
 assert.equal(saved.metadata.originalFilename,'club.sgf');assert.equal(h.messages.length,1,'analysis queued');
 assert.ok(h.buckets.site.has('share/'+saved.id+'.html'));
 assert.equal((await h.managed('POST /api/library',{body:{sgf:longGame('From API'),filename:'club.sgf',requestId:'club-1'}})).id,saved.id,'retry returns the same game');
 assert.equal((await h.managed('POST /api/library',{body:{sgf:longGame('Other'),filename:'club.sgf',requestId:'club-1'}})).status,409);
 const quick=await h.managed('POST /api/library',{body:{sgf:longGame('Quick only'),deep:false}});
 assert.equal(quick.status,201);assert.notEqual(quick.id,saved.id);assert.equal(quick.metadata.analysis.deep.status,'limited');
 for(const [name,body] of [['short',{sgf:longGame('Short',10)}],['missing',{}],['not SGF',{sgf:'hello'}],['too long',{sgf:'(;GM[1]SZ[19]'+Array.from({length:401},(_,i)=>i%2?';W[]':';B[]').join('')+')'}],['bad requestId',{sgf:longGame(),requestId:'../x'}],['bad deep',{sgf:longGame(),deep:'no'}],['bad filename',{sgf:longGame(),filename:''}],['array',[]]])
  assert.equal((await h.managed('POST /api/library',{body})).status,400,name);
 assert.equal((await h.managed('POST /api/library',{body:'{',contentType:'application/json'})).status,400);
 assert.equal((await h.managed('POST /api/library',{body:{sgf:longGame()},contentType:'text/plain'})).status,415);
 assert.equal((await h.managed('POST /api/library',{body:'x'.repeat(1600001)})).status,413);
 const full=ownerApi({DAILY_UPLOAD_CAP:'1'});
 assert.equal((await full.managed('POST /api/library',{body:{sgf:longGame('One')}})).status,201);
 assert.equal((await full.managed('POST /api/library',{body:{sgf:longGame('Two')}})).status,429);
});

test('managed delete uses the same guarded delete as the website',async()=>{
 const h=ownerApi(),meta=await seedReady(h);
 assert.equal((await h.managed('DELETE /api/library/{gameId}',{pathParameters:{gameId:'2026101001'}})).status,409);
 assert.deepEqual(await h.managed('DELETE /api/library/{gameId}',{pathParameters:{gameId:meta.id}}),{status:200,deleted:meta.id});
 assert.equal((await h.managed('GET /api/library/{gameId}',{pathParameters:{gameId:meta.id}})).status,404);
 assert.equal((await h.managed('DELETE /api/library/{gameId}',{pathParameters:{gameId:meta.id}})).status,404);
});

test('managed routes and scopes come from one file',()=>{
 const routes=JSON.parse(read('backend/managed-routes.json'));
 for(const [key,{scope}] of Object.entries(routes)){
  assert.match(key,/^(GET|POST|DELETE) \/api\//);
  assert.equal(scope,key.startsWith('GET ')?'weiqi.read':key.startsWith('POST ')?'weiqi.write':'weiqi.delete',key);
 }
});
