// OwnerApi: the owner's website tools (/auth/*, /api/owner/*) and the managed API (API Gateway with a Microsoft
// JWT authorizer). The CDK stack prepends the shared library code, auth.cjs and MANAGED_ROUTES (managed-routes.json).
// A guest reaches only sign-in and GET /api/owner/session; everything else needs the owner's session cookie or a
// Microsoft access token with the route's scope. The public GameHandler has no delete permission at all.
const {DynamoDBClient:OwnerDynamoDBClient,GetItemCommand:OwnerGetItemCommand}=require('@aws-sdk/client-dynamodb');
const {DeleteObjectCommand:OwnerDeleteObjectCommand}=require('@aws-sdk/client-s3');
const {createHash:ownerHash,randomUUID:ownerUploadId}=require('node:crypto');
const ownerDb=new OwnerDynamoDBClient({});
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const response=(statusCode,body,cookies)=>({statusCode,headers:{...JSON_HEADERS},body:JSON.stringify(body),...(cookies?{cookies}:{})});
const redirect=(location,cookies)=>({statusCode:302,headers:{location,'cache-control':'no-store'},cookies});
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function signInPage(statusCode,message,cookies){
 return {statusCode,cookies,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'},
  body:'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in · DL Weiqi</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl.css"></head>'+
  '<body class="dl-page"><main class="dl-main"><h1>登录失败 · Sign-in failed</h1><p>'+escapeHtml(message)+'</p><p><a class="dl-button" href="/">返回 DL 围棋 · Back to DL Weiqi</a></p></main></body></html>'};
}
const bodyText=event=>event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):event.body||'';
const isJson=event=>Boolean(event.headers?.['content-type']?.toLowerCase().startsWith('application/json'));

// The /health sample game (src/health-spec.js SAMPLE_GAME) must stay.
const PROTECTED_RECORDS=['2026101001'];
const ANALYSIS_DONE=['ready','failed','limited','paused'],ANALYSIS_BUSY=['queued','running','retry_wait'];
// Buckets are versioned, so a delete leaves a delete marker and can be undone for 30 days (library) or 7 (site).
// The game leaves the list first and metadata.json goes last, so a failed delete can simply be retried.
// uploads/, reservations/ and daily-analysis/ stay: they count today's saves and analyses.
async function deleteRecord(id){
 if(typeof id!=='string'||!validRecordId(id))return response(404,{message:'Record not found.'});
 if(PROTECTED_RECORDS.includes(id))return response(409,{message:'This sample game is used by the site health checks and cannot be deleted.'});
 const prefix=gamePrefix(id)+'/',metadataKey=prefix+'metadata.json';
 let metadata;try{metadata=JSON.parse(await libraryStore.get(metadataKey));}catch(e){if(e.name==='NoSuchKey')return response(404,{message:'Record not found.'});throw e;}
 const analysis=metadata.analysis||{};
 if(!ANALYSIS_DONE.includes(analysis.status)||ANALYSIS_BUSY.includes(analysis.quick?.status)||ANALYSIS_BUSY.includes(analysis.deep?.status))
  return response(409,{message:'AI analysis is still running for this game. Delete it after the analysis finishes.'});
 const remove=(Bucket,Key)=>libraryS3.send(new OwnerDeleteObjectCommand({Bucket,Key}));
 const listed=async(Bucket,Prefix)=>{const keys=[];let token;do{const r=await libraryS3.send(new ListObjectsV2Command({Bucket,Prefix,MaxKeys:1000,...(token?{ContinuationToken:token}:{})}));keys.push(...(r.Contents||[]).map(o=>o.Key));token=r.NextContinuationToken;}while(token);return keys;};
 await remove(process.env.LIBRARY_BUCKET,recordIndexKey(metadata));
 for(const key of await listed(process.env.LIBRARY_BUCKET,prefix))if(key!==metadataKey)await remove(process.env.LIBRARY_BUCKET,key);
 for(const key of ['share/'+id+'.html','share/'+id+'.png',...await listed(process.env.SITE_BUCKET,'prepared-reports/'+id+'/')])await remove(process.env.SITE_BUCKET,key);
 await remove(process.env.LIBRARY_BUCKET,metadataKey);
 return response(200,{deleted:id});
}

async function ownerSession(event){
 if(!weiqiAuth.hasSessionCookie(event))return null;
 return weiqiAuth.getSession(event,await weiqiAuth.loadConfig());
}
async function websiteHandler(event){
 const method=event.requestContext?.http?.method,path=event.rawPath||'',site=process.env.SITE_ORIGIN;
 try{
  if(['/auth/login','/auth/callback','/auth/logout'].includes(path)){
   if(method!=='GET')return response(405,{message:'Method not allowed.'});
   if(path==='/auth/logout')return redirect('/',weiqiAuth.logoutCookies());
   let config;
   try{config=await weiqiAuth.loadConfig();}
   catch(e){console.error('Sign-in not available',{name:e.name});return signInPage(503,'Sign-in is not available right now. Please try again later.');}
   if(path==='/auth/login'){const login=weiqiAuth.startLogin(config,site,Date.now(),event.queryStringParameters?.return);return redirect(login.location,login.cookies);}
   try{const result=await weiqiAuth.finishLogin(event,config,site);return result.error?signInPage(result.status,result.error,result.cookies):redirect(result.location,result.cookies);}
   catch(e){console.error('Sign-in failed',{name:e.name,message:e.message});return signInPage(401,'Sign-in failed. Please try again.',[weiqiAuth.clearLoginCookie()]);}
  }
  if(path==='/api/owner/session'){
   if(method!=='GET')return response(405,{message:'Method not allowed.'});
   if(!weiqiAuth.hasSessionCookie(event))return response(200,{signedIn:false});
   const session=await ownerSession(event);
   // A stale session also clears the page hint, so the pages stop asking.
   return session?response(200,{signedIn:true,user:session.user,name:session.name||session.user}):response(200,{signedIn:false},weiqiAuth.logoutCookies());
  }
  const deleteId=path.match(/^\/api\/owner\/library\/([^/]+)\/delete$/)?.[1];
  if(deleteId!==undefined){
   if(method!=='POST')return response(405,{message:'Method not allowed.'});
   // Stricter than the public POSTs: Origin is required, so no other site can make a signed-in browser delete.
   if(event.headers?.origin!==site)return response(403,{message:'Invalid request origin.'});
   if(!isJson(event))return response(415,{message:'Use JSON.'});
   const session=await ownerSession(event);
   if(!session)return response(401,{message:'Sign in as the site owner to delete games.'});
   const result=await deleteRecord(deleteId);
   if(result.statusCode===200)console.log(JSON.stringify({message:'Owner deleted game',id:deleteId,oid:session.oid}));
   return result;
  }
  return response(404,{message:'Not found.'});
 }catch(e){
  if(e.statusCode)return response(e.statusCode,{message:e.message});
  console.error('Owner request failed',{name:e.name});return response(500,{message:'Something went wrong. Please retry.'});
 }
}

// Managed API (ported from dliu-com/travel-plan lambda/api/api-access.js).
const API_ROLE='api.access';
// API Gateway passes array claims as "[a b]"; Entra role values cannot contain spaces. Anything odd is denied.
function parseRoles(roles){
 if(typeof roles==='string'){
  if(/^\[\s*"/.test(roles)){try{roles=JSON.parse(roles);}catch{return null;}}
  else if(roles.startsWith('[')&&roles.endsWith(']')){const inner=roles.slice(1,-1);if(!inner)return [];roles=inner.split(' ');if(roles.some(role=>!role||/["\s]/.test(role)))return null;}
  else if(/^[^\s"[\]]+$/.test(roles))roles=[roles];
  else return null;
 }
 return Array.isArray(roles)&&roles.every(role=>typeof role==='string')?roles:null;
}
// Only AWS sets requestContext: a CloudFront/function URL request (routeKey $default) can never look managed.
function isManaged(event){
 const context=event?.requestContext;
 return Boolean(context&&(context.authorizer?.jwt||(context.apiId&&context.routeKey&&context.routeKey!=='$default')));
}
function authorize(event,scope){
 const context=event.requestContext,jwt=context?.authorizer?.jwt,claims=jwt?.claims;
 const tenant=process.env.API_TENANT_ID,audience=process.env.API_AUDIENCE,client=process.env.API_CLIENT_ID;
 // Only API Gateway supplies this context; cookies and viewer headers are never evidence of a valid token.
 if(!process.env.API_GATEWAY_ID||!context||context.apiId!==process.env.API_GATEWAY_ID||!tenant||!audience||!client||!claims||
   claims.ver!=='2.0'||claims.iss!=='https://login.microsoftonline.com/'+tenant+'/v2.0'||claims.tid!==tenant||claims.aud!==audience||
   typeof claims.oid!=='string'||!claims.oid||typeof claims.sub!=='string'||!claims.sub)
  return {status:401,error:'Microsoft access token required'};
 // Access comes from the assigned app role and the route scope, never from mutable claims such as email.
 const roles=parseRoles(claims.roles);
 if(claims.azp!==client||!roles||!roles.includes(API_ROLE)||typeof scope!=='string'||!Array.isArray(jwt.scopes)||!jwt.scopes.includes(scope))
  return {status:403,error:'Weiqi API permission required'};
 const display=[claims.name,claims.preferred_username].find(value=>typeof value==='string'&&value.trim());
 return {user:claims.oid,name:display?display.trim().slice(0,100):claims.oid};
}
async function storedState(key,fallback){
 const data=await ownerDb.send(new OwnerGetItemCommand({TableName:process.env.TABLE_NAME,Key:{gameId:{S:key}},ConsistentRead:true}));
 return data.Item?JSON.parse(data.Item.state.S):fallback();
}
const MAX_API_UPLOAD_BYTES=1600000;
// Same rules as Save game on /record: a legal main line of 50–400 moves; today's save limit applies.
// A requestId makes retries safe: the same caller and requestId always return the same game.
async function managedUpload(event,caller){
 if(!isJson(event))return response(415,{message:'Use JSON.'});
 const raw=bodyText(event);if(Buffer.byteLength(raw)>MAX_API_UPLOAD_BYTES)return response(413,{message:'Request too large.'});
 let request;try{request=JSON.parse(raw);}catch{return response(400,{message:'Invalid JSON.'});}
 if(!request||typeof request!=='object'||Array.isArray(request))return response(400,{message:'Send a JSON object.'});
 const filename=request.filename??'api-upload.sgf';
 if(typeof filename!=='string'||!filename||filename.length>255)return response(400,{message:'"filename" must be 1–255 characters.'});
 if(request.deep!==undefined&&typeof request.deep!=='boolean')return response(400,{message:'"deep" must be true or false.'});
 if(request.requestId!==undefined&&(typeof request.requestId!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(request.requestId)))return response(400,{message:'"requestId" must be 1–100 letters, digits, dots, dashes or underscores.'});
 const source=publishableSgf(request.sgf);
 const hex=request.requestId&&ownerHash('sha256').update('api|'+caller.user+'|'+request.requestId).digest('hex');
 const uploadId=hex?[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-'):ownerUploadId();
 const metadata=await uploadRecord(libraryStore,source,filename,uploadId,new Date(),{deep:request.deep!==false});
 await enqueueSavedRecord(metadata);await saveSharePreview(source,metadata);
 console.log(JSON.stringify({message:'API saved game',id:metadata.id,oid:caller.user}));
 return response(201,{id:metadata.id,url:process.env.SITE_ORIGIN+'/game/'+metadata.id,metadata});
}
async function managedHandler(event){
 const key=event.requestContext?.routeKey,route=typeof key==='string'&&Object.hasOwn(MANAGED_ROUTES,key)?MANAGED_ROUTES[key]:null;
 if(!route)return response(404,{message:'Not found.'});
 const caller=authorize(event,route.scope);
 if(caller.status)return response(caller.status,{message:caller.error});
 try{
  switch(key){
   case 'GET /api/me':return response(200,{user:caller.user,name:caller.name});
   case 'GET /api/game':return response(200,{state:await storedState('current',createState),serverTime:Date.now()});
   case 'GET /api/draft':return response(200,{draft:await storedState('record-draft',createDraft)});
   case 'GET /api/library':{
    const value=event.queryStringParameters?.limit,limit=value===undefined?20:Number(value);
    if(!Number.isInteger(limit)||limit<1||limit>50)return response(400,{message:'"limit" must be a whole number from 1 to 50.'});
    return libraryHandler(event,limit);
   }
   case 'GET /api/library/{gameId}':case 'GET /api/library/{gameId}/report':return libraryHandler(event);
   case 'POST /api/library':return await managedUpload(event,caller);
   case 'DELETE /api/library/{gameId}':{
    const id=event.pathParameters?.gameId,result=await deleteRecord(id);
    if(result.statusCode===200)console.log(JSON.stringify({message:'API deleted game',id,oid:caller.user}));
    return result;
   }
  }
  return response(404,{message:'Not found.'});
 }catch(e){
  if(e.name==='NoSuchKey')return response(404,{message:'Record not found.'});
  if(e.statusCode)return response(e.statusCode,{message:e.message});
  console.error('Managed API request failed',{name:e.name});return response(500,{message:'Something went wrong. Please retry.'});
 }
}

exports.handler=async event=>isManaged(event)?managedHandler(event):websiteHandler(event);
exports.authorize=authorize;exports.isManaged=isManaged;exports.parseRoles=parseRoles;
