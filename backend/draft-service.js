import {readSgf} from '../src/sgf.js';
import {newRecordingSgf,mainRecordingSgf} from '../src/recording-tree.js';
export function createDraft(){return {revision:0,sgf:newRecordingSgf(),selected:0,updatedAt:null};}
export function draftTransition(current,request){
 if(!request||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision!==current.revision)throw Object.assign(Error('The public draft changed on another device. Reload it before editing.'),{statusCode:409});
 if(current.publication?.status==='pending')throw Object.assign(Error('The main branch is being saved. Retry Save game before editing.'),{statusCode:409});
 const record=readSgf(request.sgf);
 if(!Number.isInteger(request.selected)||!record.nodes[request.selected])throw Object.assign(Error('Invalid draft position.'),{statusCode:400});
 const next={revision:current.revision+1,sgf:request.sgf,selected:request.selected,updatedAt:new Date().toISOString()};
 if(new TextEncoder().encode(JSON.stringify(next)).length>350000)throw Object.assign(Error('The draft is too large.'),{statusCode:413});
 return next;
}
export function draftPublication(current,request){
 if(!request||request.expectedRevision!==current.revision)throw Object.assign(Error('The public draft changed on another device. Reload it before saving.'),{statusCode:409});
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(request.id||''))throw Object.assign(Error('Invalid save request.'),{statusCode:400});
 return {revision:current.revision+1,sgf:mainRecordingSgf(current.sgf),selected:0,updatedAt:new Date().toISOString(),publication:{id:request.id,status:'pending'}};
}
