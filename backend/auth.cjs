// Microsoft sign-in for the site owner (ported from dliu-com/travel-plan lambda/api/auth.js and config.js).
// Concatenated into both website Lambdas, so everything lives inside weiqiAuth. Modules load on first use:
// a guest request without the session cookie never reads SSM or does any crypto.
const weiqiAuth=(()=>{
 const SESSION_COOKIE='__Host-weiqi_session',AUTH_COOKIE='__Host-weiqi_auth';
 // Not a secret: only tells the pages to ask /api/owner/session, so guests never call it. The server ignores it.
 const HINT_COOKIE='weiqi_owner';
 const SESSION_SECONDS=30*24*60*60,AUTH_SECONDS=10*60,CLOCK_SKEW_SECONDS=120,JWKS_TTL_MS=60*60*1000,CONFIG_TTL_MS=5*60*1000;
 const PREFIX=()=>process.env.PARAMETER_PREFIX||'/weiqi',TENANT=()=>process.env.TENANT_PARAMETER||'/dliu/entra-tenant-id';
 const crypto=()=>require('node:crypto');
 const b64url=buf=>Buffer.from(buf).toString('base64url'),fromB64url=str=>Buffer.from(str,'base64url'),nowSeconds=now=>Math.floor(now/1000);
 class NotConfigured extends Error{}

 let cached,cachedAt=0,ssmClient;
 async function loadConfig(ssm,now=Date.now()){
  if(cached&&now-cachedAt<CONFIG_TTL_MS)return cached;
  const {SSMClient,GetParametersCommand}=require('@aws-sdk/client-ssm');
  ssm??=(ssmClient??=new SSMClient({}));
  const names={tenantId:TENANT(),clientId:PREFIX()+'/entra-client-id',clientSecret:PREFIX()+'/entra-client-secret'};
  const result=await ssm.send(new GetParametersCommand({Names:Object.values(names),WithDecryption:true}));
  const values=Object.fromEntries((result.Parameters||[]).map(p=>[p.Name,p.Value]));
  const missing=Object.values(names).filter(name=>!values[name]);
  if(missing.length)throw new NotConfigured('Missing SSM parameters: '+missing.join(', ')+'. Run "make set-secrets".');
  cached={tenantId:values[names.tenantId].trim(),clientId:values[names.clientId].trim(),clientSecret:values[names.clientSecret],allowedDomain:(process.env.ALLOWED_DOMAIN||'dliu.com').trim().toLowerCase()};
  cachedAt=now;return cached;
 }
 const resetConfigCache=()=>{cached=undefined;cachedAt=0;};

 // Sign-in and session cookies use different keys and a checked typ, so the sign-in
 // cookie that /auth/login hands to anyone can never be replayed as a session.
 const sessionKey=config=>crypto().createHmac('sha256',config.clientSecret).update('weiqi-session-v1').digest();
 const loginKey=config=>crypto().createHmac('sha256',config.clientSecret).update('weiqi-login-v1').digest();
 function sign(payload,key){const body=b64url(JSON.stringify(payload));return body+'.'+b64url(crypto().createHmac('sha256',key).update(body).digest());}
 function verifySigned(token,key,now=Date.now(),typ){
  if(typeof token!=='string')return null;
  const [body,mac,extra]=token.split('.');if(!body||!mac||extra!==undefined)return null;
  const expected=crypto().createHmac('sha256',key).update(body).digest(),given=fromB64url(mac);
  if(given.length!==expected.length||!crypto().timingSafeEqual(given,expected))return null;
  let payload;try{payload=JSON.parse(fromB64url(body).toString('utf8'));}catch{return null;}
  if(!payload||typeof payload.exp!=='number'||payload.exp<=nowSeconds(now)||payload.typ!==typ)return null;
  return payload;
 }

 function parseCookies(event){
  const list=Array.isArray(event?.cookies)?event.cookies:[],header=event?.headers&&(event.headers.cookie||event.headers.Cookie);
  const cookies={};
  for(const part of header?list.concat(header.split(';')):list){const i=part.indexOf('=');if(i<1)continue;const name=part.slice(0,i).trim();if(!(name in cookies))cookies[name]=part.slice(i+1).trim();}
  return cookies;
 }
 const cookie=(name,value,maxAge,httpOnly=true)=>name+'='+value+'; Path=/; Max-Age='+maxAge+'; Secure'+(httpOnly?'; HttpOnly':'')+'; SameSite=Lax';
 const authority=config=>'https://login.microsoftonline.com/'+encodeURIComponent(config.tenantId);
 const hasSessionCookie=event=>Boolean(parseCookies(event)[SESSION_COOKIE]);

 function getSession(event,config,now=Date.now()){
  const session=verifySigned(parseCookies(event)[SESSION_COOKIE],sessionKey(config),now,'session');
  return session&&typeof session.user==='string'&&session.user?session:null;
 }
 // Only same-site paths, so the login flow can't be used as an open redirect.
 const safeReturnPath=value=>typeof value==='string'&&/^\/(?![\/\\])[^\s]*$/.test(value)&&value.length<=300?value:'/';

 function startLogin(config,siteUrl,now=Date.now(),returnTo='/'){
  const state=b64url(crypto().randomBytes(24)),nonce=b64url(crypto().randomBytes(24)),verifier=b64url(crypto().randomBytes(48));
  const challenge=b64url(crypto().createHash('sha256').update(verifier).digest());
  const transient=sign({typ:'login',state,nonce,verifier,returnTo:safeReturnPath(returnTo),exp:nowSeconds(now)+AUTH_SECONDS},loginKey(config));
  const params=new URLSearchParams({client_id:config.clientId,response_type:'code',response_mode:'query',redirect_uri:siteUrl+'/auth/callback',scope:'openid profile email',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'});
  return {location:authority(config)+'/oauth2/v2.0/authorize?'+params,cookies:[cookie(AUTH_COOKIE,transient,AUTH_SECONDS)]};
 }

 const jwksCache=new Map();
 async function getSigningKey(config,kid,fetchImpl,now){
  const url=authority(config)+'/discovery/v2.0/keys';let entry=jwksCache.get(url);
  const find=()=>entry&&entry.keys.find(key=>key.kid===kid);
  if(!entry||now-entry.at>JWKS_TTL_MS||!find()){
   const response=await fetchImpl(url);if(!response.ok)throw Error('JWKS request failed with '+response.status);
   entry={at:now,keys:(await response.json()).keys||[]};jwksCache.set(url,entry);
  }
  const jwk=find();if(!jwk)throw Error('Unknown signing key');
  return crypto().createPublicKey({key:{kty:jwk.kty,n:jwk.n,e:jwk.e},format:'jwk'});
 }
 async function verifyIdToken(idToken,config,expectedNonce,{fetchImpl=fetch,now=Date.now()}={}){
  const parts=String(idToken).split('.');if(parts.length!==3)throw Error('Malformed id_token');
  const header=JSON.parse(fromB64url(parts[0]).toString('utf8'));
  if(header.alg!=='RS256'||!header.kid)throw Error('Unsupported id_token algorithm');
  const key=await getSigningKey(config,header.kid,fetchImpl,now);
  if(!crypto().verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,fromB64url(parts[2])))throw Error('Invalid id_token signature');
  const claims=JSON.parse(fromB64url(parts[1]).toString('utf8')),seconds=nowSeconds(now);
  if(claims.iss!=='https://login.microsoftonline.com/'+config.tenantId+'/v2.0')throw Error('Unexpected issuer');
  if(claims.tid!==config.tenantId)throw Error('Unexpected tenant');
  if(claims.aud!==config.clientId)throw Error('Unexpected audience');
  if(typeof claims.exp!=='number'||claims.exp+CLOCK_SKEW_SECONDS<seconds)throw Error('Expired id_token');
  if(typeof claims.nbf==='number'&&claims.nbf-CLOCK_SKEW_SECONDS>seconds)throw Error('id_token not yet valid');
  if(claims.nonce!==expectedNonce)throw Error('Nonce mismatch');
  return claims;
 }
 // Microsoft decides who may sign in (Entra user assignment on the weiqi app); the app also checks the email domain.
 function isAllowed(claims,config){
  const suffix='@'+config.allowedDomain;
  return [claims.preferred_username,claims.email,claims.upn].filter(Boolean).some(value=>String(value).toLowerCase().endsWith(suffix));
 }

 async function finishLogin(event,config,siteUrl,{fetchImpl=fetch,now=Date.now()}={}){
  const query=event.queryStringParameters||{},clearAuth=cookie(AUTH_COOKIE,'',0);
  // Only well-formed OAuth error codes are shown, so the page cannot display attacker text.
  if(query.error)return {error:'Sign-in failed: '+(/^[a-z_]{1,64}$/.test(query.error)?query.error:'unknown_error'),status:401,cookies:[clearAuth]};
  const transient=verifySigned(parseCookies(event)[AUTH_COOKIE],loginKey(config),now,'login');
  if(!transient||!query.state||query.state!==transient.state||!query.code)return {error:'Sign-in expired or invalid. Please try again.',status:400,cookies:[clearAuth]};
  const tokenResponse=await fetchImpl(authority(config)+'/oauth2/v2.0/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'authorization_code',code:query.code,redirect_uri:siteUrl+'/auth/callback',code_verifier:transient.verifier,scope:'openid profile email'}).toString()});
  const tokens=await tokenResponse.json();
  if(!tokenResponse.ok||!tokens.id_token){console.warn(JSON.stringify({message:'Token exchange failed',status:tokenResponse.status,error:tokens.error}));return {error:'Sign-in failed during token exchange.',status:401,cookies:[clearAuth]};}
  const claims=await verifyIdToken(tokens.id_token,config,transient.nonce,{fetchImpl,now});
  if(!isAllowed(claims,config)){
   // The domain is enough to see why; the username itself stays out of the logs.
   const username=String(claims.preferred_username||claims.email||claims.upn||'');
   console.warn(JSON.stringify({message:'User domain not allowed',domain:username.includes('@')?username.split('@').pop():'',oid:claims.oid}));
   return {error:(claims.preferred_username||'This account')+' is not allowed to manage DL Weiqi.',status:403,cookies:[clearAuth]};
  }
  const session=sign({typ:'session',user:claims.preferred_username||claims.email||claims.oid,name:claims.name,oid:claims.oid,exp:nowSeconds(now)+SESSION_SECONDS},sessionKey(config));
  return {location:safeReturnPath(transient.returnTo),cookies:[clearAuth,cookie(SESSION_COOKIE,session,SESSION_SECONDS),cookie(HINT_COOKIE,'1',SESSION_SECONDS,false)]};
 }
 const logoutCookies=()=>[cookie(SESSION_COOKIE,'',0),cookie(AUTH_COOKIE,'',0),cookie(HINT_COOKIE,'',0,false)];
 const clearLoginCookie=()=>cookie(AUTH_COOKIE,'',0);

 return {SESSION_COOKIE,AUTH_COOKIE,HINT_COOKIE,NotConfigured,loadConfig,resetConfigCache,sessionKey,loginKey,sign,verifySigned,parseCookies,hasSessionCookie,getSession,safeReturnPath,startLogin,verifyIdToken,isAllowed,finishLogin,logoutCookies,clearLoginCookie};
})();
module.exports=weiqiAuth;
