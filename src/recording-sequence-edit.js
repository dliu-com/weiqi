import {play} from './engine.js';
import {recordingSgf,recordingNodeIndex,updateMainLine} from './recording-tree.js';

// This workspace lives only in memory. Replaying here is a board preview,
// never an acceptance check: only the draft API can accept a correction.
export class RecordingSequenceEdit{
 constructor(record,selected){this.original=structuredClone(record);this.originalSelected=selected;this.record=structuredClone(record);this.selected=selected;this.refresh();}
 refresh(){
  const r=this.record,pending=[0];this.previewIssues=[];
  while(pending.length){
   const id=pending.pop(),node=r.nodes[id];delete node.previewIssue;delete node.previewIncomplete;
   if(id){
    const parent=r.nodes[node.parent];node.depth=parent.depth+1;node.turn=node.move.side==='B'?'W':'B';node.board=parent.board;
    // After an illegal move, show the last reliable board until it is repaired.
    node.previewIncomplete=Boolean(parent.previewIssue||parent.previewIncomplete);
    if(!node.previewIncomplete&&node.move.index!==null){try{node.board=play(parent.board,node.move.index,node.move.side==='B'?'black':'white',19).board;}catch(e){node.previewIssue=e.message;this.previewIssues.push(id);}}
   }
   for(let i=node.children.length-1;i>=0;i--)pending.push(node.children[i]);
  }
  updateMainLine(r);return {record:r,selected:this.selected};
 }
 insert(parent,index){
  const r=this.record,node=r.nodes[parent];if(!node)throw Error('Invalid move.');
  if(this.count()>=2000)throw Error('The draft may contain at most 2,000 positions.');
  const id=r.nodes.length;r.nodes.push({parent,move:{side:node.turn,index},children:node.children.slice(),comment:''});
  for(const child of node.children)r.nodes[child].parent=id;
  node.children=[id];this.selected=id;return this.refresh();
 }
 delete(id){
  if(!id||!this.record.nodes[id])throw Error('Select a move to delete.');
  const r=this.record,node=r.nodes[id],parent=r.nodes[node.parent];parent.children.splice(parent.children.indexOf(id),1,...node.children);
  for(const child of node.children)r.nodes[child].parent=node.parent;
  this.selected=node.parent;return this.refresh();
 }
 reposition(id,index){if(!id||!this.record.nodes[id])throw Error('Select a move to reposition.');this.record.nodes[id].move.index=index;this.selected=id;return this.refresh();}
 count(){let count=0,pending=[0];while(pending.length){const id=pending.pop();count++;pending.push(...this.record.nodes[id].children);}return count;}
 submission(selected=this.selected){return {sgf:recordingSgf(this.record),selected:recordingNodeIndex(this.record,selected)};}
 cancel(){return {record:structuredClone(this.original),selected:this.originalSelected};}
}
