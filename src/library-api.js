export async function libraryRequest(path='/api/library',payload) {
  const options={cache:'no-store',signal:AbortSignal.timeout(20000)};
  if(payload){options.method='POST';options.body=JSON.stringify(payload);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(options.body));options.headers={'content-type':'application/json','x-amz-content-sha256':Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};}
  let r;
  try{r=await fetch(path,options);}catch(e){const timeout=e?.name==='TimeoutError'||e?.name==='AbortError';throw Object.assign(Error(timeout?'The server took too long to respond. Please try again.':'Could not reach the server. Check your connection and try again.'),{statusCode:0,kind:timeout?'timeout':'network'});}
  // Missing API resources come back as the site's HTML 404 page, so the body is not always JSON.
  let data=null;try{data=await r.json();}catch{}
  if(!r.ok||!data||typeof data!=='object'){const kind=requestErrorKind(r.status),error=Error(typeof data?.message==='string'&&data.message?data.message:requestErrorText({kind},(zh,en)=>en));error.statusCode=r.status;error.kind=kind;error.data=data;throw error;}
  return data;
}

function requestErrorKind(status) {
  return status===404?'not-found':status===429?'busy':status>=500?'server':'failed';
}

// Bilingual, user-readable text for a failed request. Server sentences are kept except for not-found, network, timeout, and server faults.
export function requestErrorText(error,t,notFound) {
  const kind=error?.kind;
  if(kind==='not-found')return notFound||t('找不到请求的内容。','The requested item could not be found.');
  if(kind==='network')return t('无法连接服务器。请检查网络后重试。','Could not reach the server. Check your connection and try again.');
  if(kind==='timeout')return t('服务器响应超时。请稍后重试。','The server took too long to respond. Please try again.');
  if(kind==='server')return t('服务器暂时出错。请稍后重试。','The server had a problem. Please try again later.');
  if(kind==='busy'&&!error?.data?.message)return t('请求太频繁。请稍后重试。','Too many requests. Please try again later.');
  if(error?.data?.message)return error.data.message;
  if(kind==='failed')return t('请求失败。请稍后重试。','The request failed. Please try again later.');
  return error?.readable?error.message:t('出了点问题。请刷新页面重试。','Something went wrong. Refresh the page to try again.');
}
