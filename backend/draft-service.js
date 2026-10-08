import {readSgf} from '../src/sgf.js';
import {MAX_GAME_MOVES} from '../src/engine.js';
import {newRecordingSgf,mainRecordingSgf,recordingTree,validateRecordingDetails,recordingDepth,recordingLimitError} from '../src/recording-tree.js';
export function createDraft(){return {revision:0,sgf:newRecordingSgf(),selected:0,updatedAt:null};}
export function draftTransition(current,request){
 if(!request||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision!==current.revision)throw Object.assign(Error('The public draft changed on another device. Reload it before editing.'),{statusCode:409});
 if(current.publication?.status==='pending')throw Object.assign(Error('The main branch is being saved. Retry Save game before editing.'),{statusCode:409});
 const record=readSgf(request.sgf);validateDraftSequence(record);
 // Older drafts above the cap may still be shortened, never lengthened.
 const moves=recordingDepth(record);if(moves>MAX_GAME_MOVES&&moves>recordingDepth(readSgf(current.sgf)))throw recordingLimitError();
 if(!Number.isInteger(request.selected)||!record.nodes[request.selected])throw Object.assign(Error('Invalid draft position.'),{statusCode:400});
 const next={revision:current.revision+1,sgf:request.sgf,selected:request.selected,updatedAt:new Date().toISOString()};
 if(new TextEncoder().encode(JSON.stringify(next)).length>350000)throw Object.assign(Error('The draft is too large.'),{statusCode:413});
 return next;
}
export function draftPublication(current,request){
 if(!request||request.expectedRevision!==current.revision)throw Object.assign(Error('The public draft changed on another device. Reload it before saving.'),{statusCode:409});
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(request.id||''))throw Object.assign(Error('Invalid save request.'),{statusCode:400});
 const source=mainRecordingSgf(current.sgf);const record=recordingTree(source);validateDraftSequence(record);validateRecordingDetails(record);
 const moves=record.mainLine.length-1;if(moves>MAX_GAME_MOVES)throw Object.assign(Error(`A game can have at most ${MAX_GAME_MOVES} moves. This game has ${moves}.`),{statusCode:400});
 return {revision:current.revision+1,sgf:source,selected:0,updatedAt:new Date().toISOString(),publication:{id:request.id,status:'pending'}};
}
export function freshSavedDraft(pending,gameId){
 return {...createDraft(),revision:pending.revision+1,updatedAt:new Date().toISOString(),publication:{id:pending.publication.id,status:'ready',gameId}};
}

function validateDraftSequence(record){
 for(const node of record.nodes.slice(1)){if(node.move.side!==record.nodes[node.parent].turn)throw Object.assign(Error('Move '+node.depth+': Black and White must alternate. Correct the missing or extra move before applying.'),{statusCode:400});}
}
