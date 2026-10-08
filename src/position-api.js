// AI analysis cloud requests. Copyright 2026 DL; AGPL-3.0-only.
// Photos and positions are sent only when the user selects a photo or requests analysis.
export class PositionError extends Error{constructor(message,status=0){super(message);this.status=status;}}
const aborted=()=>new DOMException('The request was cancelled.','AbortError');
function reply(status,text){
 let result;try{result=JSON.parse(text);}catch{throw new PositionError('The position service is unavailable.',status);}
 if(status<200||status>=300)throw new PositionError(result.message||'The position service could not finish.',status);
 return result;
}
// CloudFront signs the origin request, so the exact body hash travels with it.
export async function positionRequest(kind,body,{signal,onUploadProgress}={}){
 const started=performance.now(),payload=JSON.stringify({...body,requestId:crypto.randomUUID()}),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
 const url='/api/position/'+kind,headers={'content-type':'application/json','x-amz-content-sha256':Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
 let result;
 if(onUploadProgress&&typeof XMLHttpRequest==='function')result=await new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(aborted());return;}
  const xhr=new XMLHttpRequest();xhr.open('POST',url);for(const [key,value]of Object.entries(headers))xhr.setRequestHeader(key,value);
  xhr.upload.onprogress=event=>{if(event.lengthComputable)onUploadProgress(event.loaded/event.total);};xhr.upload.onload=()=>onUploadProgress(1);
  xhr.onload=()=>{try{resolve(reply(xhr.status,xhr.responseText));}catch(error){reject(error);}};
  xhr.onerror=()=>reject(new PositionError('The network connection failed.'));xhr.onabort=()=>reject(aborted());
  signal?.addEventListener('abort',()=>xhr.abort(),{once:true});xhr.send(payload);
 });
 else{const response=await fetch(url,{method:'POST',headers,body:payload,signal});result=reply(response.status,await response.text());}
 return {...result,requestMs:performance.now()-started};
}
// Keeps the earlier moves when they alternate correctly; otherwise the shown board becomes a new setup.
export function cloudPosition(frames,cursor,side,rules,komi){
 let start=frames[0],moves=frames.slice(1,cursor+1).map(f=>({side:f.move.side,index:f.move.index})),expected=start.turn;
 for(const m of moves){if(m.side!==expected){moves=[];start=frames[cursor];break;}expected=expected==='B'?'W':'B';}
 if(expected!==side){moves=[];start=frames[cursor];}
 return {initialBoard:start.board,initialSide:moves.length?start.turn:side,side,moves,rules,komi};
}
