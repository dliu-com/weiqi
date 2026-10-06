export async function libraryRequest(path='/api/library',payload) {
  const options={cache:'no-store',signal:AbortSignal.timeout(20000)};
  if(payload){options.method='POST';options.body=JSON.stringify(payload);const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(options.body));options.headers={'content-type':'application/json','x-amz-content-sha256':Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};}
  const r=await fetch(path,options),data=await r.json();if(!r.ok){const error=Error(data.message || 'Request failed.');error.statusCode=r.status;error.data=data;throw error;}return data;
}
