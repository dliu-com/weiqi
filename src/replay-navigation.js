// Traverse temporary moves before walking the recorded tree. Retain forward
// history inside a preview; reaching its origin restores normal record replay.
export function stepReplay(record,state,amount){
 let {selected,aiLine,trials=[],trialOffset=trials.length}=state;
 if(aiLine)aiLine={...aiLine};
 const direction=Math.sign(amount);
 for(let i=0;i<Math.abs(amount);i++){
  if(direction<0&&trialOffset>0){
   trialOffset--;
   if(!trialOffset&&!aiLine)trials=[];
  }else if(direction>0&&trialOffset<trials.length){
   trialOffset++;
  }else if(aiLine){
   if(direction<0&&aiLine.offset>0){
    trials=[];trialOffset=0;aiLine.offset--;
    if(!aiLine.offset){selected=aiLine.anchor;aiLine=null;}
   }else if(direction>0&&aiLine.offset<aiLine.frames.length-1){aiLine.offset++;}
   else break;
  }else{
   const next=direction<0?record.nodes[selected].parent:record.nodes[selected].children[0];
   if(next===null||next===undefined)break;
   selected=next;
  }
 }
 return {selected,aiLine,trials,trialOffset};
}
