// Photos/positions are sent only when the user selects an input or requests analysis.
export async function positionRequest(kind,body,signal){
 const started=performance.now(),payload=JSON.stringify({...body,requestId:crypto.randomUUID()}),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload)),hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');const response=await fetch('/api/position/'+kind,{method:'POST',headers:{'content-type':'application/json','x-amz-content-sha256':hash},body:payload,signal});let result;try{result=await response.json();}catch{throw Error('The position service is unavailable.');}if(!response.ok)throw Error(result.message||'The position service could not finish.');return {...result,requestMs:performance.now()-started};
}
export function cloudPosition(frames,cursor,side,rules,komi){
 const flat=b=>b.map(c=>c==='black'?'B':c==='white'?'W':'.').join(''),colour=c=>c==='black'?'B':'W';let start=frames[0],moves=frames.slice(1,cursor+1).map(f=>({side:colour(f.move.side),index:f.move.index})),expected=start.turn;
 for(const m of moves){if(m.side!==colour(expected)){moves=[];start=frames[cursor];break;}expected=expected==='black'?'white':'black';}
 if(expected!==side){moves=[];start=frames[cursor];}
 return {initialBoard:flat(start.board),initialSide:colour(moves.length?start.turn:side),side:colour(side),moves,rules,komi};
}
