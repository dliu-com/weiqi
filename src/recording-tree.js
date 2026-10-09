import {readSgf,parseSgf} from './sgf.js';
import {play,MAX_GAME_MOVES,handicapBoard,standardKomi} from './engine.js';
export function recordingTree(source){const record=readSgf(source);record.rootProperties=structuredClone(parseSgf(source).nodes[0]);delete record.rootProperties.B;delete record.rootProperties.W;return record;}
// Deepest move number reachable from a node, across every variation.
export function recordingDepth(record,id=0){let deepest=0;const pending=[id];while(pending.length){const node=record.nodes[pending.pop()];deepest=Math.max(deepest,node.depth||0);pending.push(...node.children);}return deepest;}
export function recordingLimitError(){return Object.assign(Error(`A game can have at most ${MAX_GAME_MOVES} moves.`),{code:'move-limit',statusCode:400});}
export function defaultRecordingKomi(rules,handicap=0){return standardKomi(rules,handicap);}
export function setRecordingRules(record,rules){
 const next=structuredClone(record),handicap=Number(record.rootProperties.HA?.[0]||0);
 if(record.komi===defaultRecordingKomi(record.rules,handicap))next.komi=defaultRecordingKomi(rules,handicap);
 next.rules=rules;return next;
}
export function recordingResultFields(result){
 const raw=String(result||'').trim(),match=raw.match(/^([BW])\+(.*)$/i);
 if(/^(?:0|draw|jigo)$/i.test(raw))return {choice:'0',margin:''};
 if(/^void$/i.test(raw))return {choice:'Void',margin:''};
 if(raw==='?')return {choice:'?',margin:''};
 if(match){
  const side=match[1].toUpperCase(),reason=match[2].trim();
  if(!reason)return {choice:side+'+',margin:''};
  if(/^(?:r|res|resign|resignation)$/i.test(reason))return {choice:side+'R',margin:''};
  if(/^(?:t|time|timeout)$/i.test(reason))return {choice:side+'T',margin:''};
  if(/^(?:f|forfeit)$/i.test(reason))return {choice:side+'F',margin:''};
  const points=reason.match(/^(\d+(?:\.\d+)?)\s*(?:目|点|points?|pts?)?$/i)?.[1];if(points&&Number(points)>0)return {choice:side+'points',margin:points};
  return {choice:side+'+',margin:''};
 }
 return {choice:'?',margin:''};
}
export function recordingResultValue(choice,margin){
 if(/^[BW]points$/.test(choice)){
  const text=String(margin??'').trim();if(!/^\d+(?:\.\d+)?$/.test(text)||!Number.isFinite(Number(text))||Number(text)<=0||Number(text)>1000)throw Error('Enter a winning margin greater than zero and no more than 1,000 points.');
  return choice[0]+'+'+String(Number(text));
 }
 if(/^[BW][RTF]$/.test(choice))return choice[0]+'+'+choice[1];
 if(['0','B+','W+','?','Void'].includes(choice))return choice;
 throw Error('Choose a game result.');
}
export function validateRecordingDetails(record){
 const required=[record.name,record.players.black,record.players.white,record.date,record.rules,record.result];
 if(required.some(value=>!String(value??'').trim()))throw Object.assign(Error('Game title, date, both players, rules and result are required.'),{statusCode:400});
 const handicap=Number(record.rootProperties.HA?.[0]||0),date=String(record.date);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Object.assign(Error('Choose a valid game date.'),{statusCode:400});
 if(!Number.isFinite(record.komi)||Math.abs(record.komi)>100||!Number.isInteger(handicap)||handicap<0||handicap>9)throw Object.assign(Error('Valid komi and handicap are required.'),{statusCode:400});
}
export function populateRecordingDetails(record,now=new Date()){
 let changed=false;
 const fill=(object,key,value)=>{if(!String(object[key]??'').trim()){object[key]=value;changed=true;}};
 fill(record,'name','Recorded game');fill(record.players,'black','Unnamed black player');fill(record.players,'white','Unnamed white player');
 fill(record,'date',String(now.getFullYear()).padStart(4,'0')+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0'));
 fill(record,'rules','Japanese');fill(record,'result','0');
 if(!record.rootProperties.KM){record.komi=defaultRecordingKomi(record.rules,record.rootProperties.HA?.[0]);changed=true;}
 return changed;
}
export function recordingSgf(record,mainOnly=false){
 const escape=value=>String(value).replace(/\\/g,'\\\\').replace(/\]/g,'\\]').replace(/\r\n?/g,'\n');
 const coord=i=>String.fromCharCode(97+i%19,97+Math.floor(i/19));
 const props={...record.rootProperties,GM:['1'],FF:['4'],CA:['UTF-8'],SZ:['19'],KM:[String(record.komi)],RU:[record.rules||'Japanese'],GN:[record.name||'Recorded game'],PB:[record.players.black],PW:[record.players.white],BR:[record.playerRanks?.black??record.rootProperties.BR?.[0]??''],WR:[record.playerRanks?.white??record.rootProperties.WR?.[0]??''],DT:[record.date],PC:[record.venue??record.rootProperties.PC?.[0]??''],RE:[record.result||'0'],PL:[record.initialPlayer]};
 if(record.timeControl!==undefined){props.TM=record.timeControl?[String(record.timeControl.mainSeconds)]:[];props.OT=record.timeControl?.overtime?[record.timeControl.overtime]:[];}
 for(const [key,side]of [['AB','B'],['AW','W']]){props[key]=[...record.nodes[0].board].flatMap((v,i)=>v===side?[coord(i)]:[]);}delete props.AE;
 const properties=Object.entries(props).filter(([,values])=>values?.length&&values.some(v=>v!==''&&v!==undefined)).map(([key,values])=>key+values.map(v=>'['+escape(v)+']').join('')).join('');
 const nodeText=n=>';'+n.move.side+'['+(n.move.index===null?'':coord(n.move.index))+']'+(n.comment?'C['+escape(n.comment)+']':'');
 function sequence(start,level=0){if(level>100)throw Error('Too many branches.');let out='',id=start;while(id!==undefined){const n=record.nodes[id];out+=nodeText(n);const children=mainOnly?n.children.slice(0,1):n.children;if(children.length>1){out+=children.map(child=>'('+sequence(child,level+1)+')').join('');break;}id=children[0];}return out;}
 const children=mainOnly?record.nodes[0].children.slice(0,1):record.nodes[0].children;
 return '(;'+properties+(children.length>1?children.map(child=>'('+sequence(child)+')').join(''):children.length?sequence(children[0]):'')+')';
}
export function addRecordingMove(record,parent,index){
 const node=record.nodes[parent];if(!node)throw Error('Invalid move.');
 const existing=node.children.find(id=>record.nodes[id].move.index===index&&record.nodes[id].move.side===node.turn);if(existing!==undefined)return existing;
 if(node.depth>=MAX_GAME_MOVES)throw recordingLimitError();
 if(record.nodes.length>=2000)throw Error('The draft may contain at most 2,000 positions.');
 const history=[];for(let n=parent;n!==null;n=record.nodes[n].parent)history.push(record.nodes[n].board);
 const board=index===null?node.board:play(node.board,index,node.turn==='B'?'black':'white',19,history).board;
 const id=record.nodes.length;record.nodes.push({parent,board,depth:node.depth+1,move:{side:node.turn,index},turn:node.turn==='B'?'W':'B',children:[],comment:''});node.children.push(id);updateMainLine(record);return id;
}
export function updateMainLine(record){record.mainLine=[0];let n=0;while(record.nodes[n].children.length){n=record.nodes[n].children[0];record.mainLine.push(n);}return record;}
export function promoteRecordingBranch(record,id){if(!record.nodes[id])throw Error('Invalid move.');for(let n=id;record.nodes[n].parent!==null;n=record.nodes[n].parent){const parent=record.nodes[record.nodes[n].parent];parent.children=[n,...parent.children.filter(c=>c!==n)];}return updateMainLine(record);}
export function deleteRecordingBranch(record,id){if(!id||!record.nodes[id])throw Error('Select a move to delete.');const parent=record.nodes[id].parent;record.nodes[parent].children=record.nodes[parent].children.filter(c=>c!==id);const next=recordingTree(recordingSgf(record));const path=[];for(let n=parent;n!==0;n=record.nodes[n].parent)path.unshift(record.nodes[record.nodes[n].parent].children.indexOf(n));let selected=0;for(const child of path)selected=next.nodes[selected].children[child];return {record:next,selected};}
// Replay the entire edited tree before adopting it. A correction must never
// silently discard a continuation or leave a cached board out of date.
function replayEdit(next,selected){
 const index=recordingNodeIndex(next,selected);
 try{return {record:recordingTree(recordingSgf(next)),selected:index};}
 catch{throw Error('This edit would make a later move illegal. Edit or delete that continuation first.');}
}
export function deleteRecordingMove(record,id){
 if(!id||!record.nodes[id])throw Error('Select a move to delete.');
 const next=structuredClone(record),node=next.nodes[id],parent=next.nodes[node.parent];
 parent.children.splice(parent.children.indexOf(id),1,...node.children);
 for(const child of node.children)next.nodes[child].parent=node.parent;
 return replayEdit(next,node.parent);
}
export function insertRecordingMove(record,parent,index){
 if(!record.nodes[parent])throw Error('Invalid move.');
 if(record.nodes.length>=2000)throw Error('The draft may contain at most 2,000 positions.');
 if(recordingDepth(record,parent)>=MAX_GAME_MOVES)throw recordingLimitError();
 const next=structuredClone(record),node=next.nodes[parent],id=next.nodes.length;
 next.nodes.push({parent,move:{side:node.turn,index},children:node.children.slice(),comment:''});
 for(const child of node.children)next.nodes[child].parent=id;
 node.children=[id];return replayEdit(next,id);
}
export function repositionRecordingMove(record,id,index){
 if(!id||!record.nodes[id])throw Error('Select a move to reposition.');
 const next=structuredClone(record);next.nodes[id].move.index=index;
 return replayEdit(next,id);
}
export function setRecordingHandicap(record,count){
 if(record.nodes.length!==1)throw Error('Handicap can be changed only before recording moves.');
 if(!Number.isInteger(count)||count<0||count>9)throw Error('Choose 0–9 handicap stones.');
 const next=structuredClone(record);
 next.nodes[0].board=handicapBoard(count);next.initialPlayer=count>1?'W':'B';next.nodes[0].turn=next.initialPlayer;
 next.rootProperties.HA=[String(count)];
 if(count!==Number(record.rootProperties.HA?.[0]||0))next.komi=defaultRecordingKomi(record.rules,count);
 return next;
}
export function newRecordingSgf(){return '(;GM[1]FF[4]CA[UTF-8]SZ[19]RU[Japanese]KM[6.5]GN[Recorded game]RE[0])';}
export function mainRecordingSgf(source){const record=recordingTree(source);populateRecordingDetails(record);return recordingSgf(record,true);}

// SGF serialization follows child order, which can change after promotion.
// Store the selected node's serialized index rather than its in-memory ID.
export function recordingNodeIndex(record,selected){
 const pending=[0];let index=0;
 while(pending.length){const id=pending.pop();if(id===selected)return index;index++;for(let i=record.nodes[id].children.length-1;i>=0;i--)pending.push(record.nodes[id].children[i]);}
 return 0;
}

export class RecordingNavigation{
 constructor(){this.continuations=new Map();}
 remember(record,selected){for(let id=selected;record.nodes[id].parent!==null;id=record.nodes[id].parent)this.continuations.set(record.nodes[id].parent,id);}
 next(record,id){const children=record.nodes[id].children,preferred=this.continuations.get(id);return children.includes(preferred)?preferred:children[0];}
 step(record,selected,count){let id=selected;for(let i=0;i<Math.abs(count);i++){const next=count<0?record.nodes[id].parent:this.next(record,id);if(next===null||next===undefined)break;id=next;}return id;}
}

// Move depth fixes the column. Each alternative starts a new horizontal lane,
// leaving the shared prefix in place instead of repeating it in a list.
export function recordingTreeLayout(record,selected=0,continuations=new Map()){
 const positions=[],edges=[];let lastLane=0;
 const preferred=new Map(continuations);
 for(let id=selected;record.nodes[id].parent!==null;id=record.nodes[id].parent)preferred.set(record.nodes[id].parent,id);
 const pending=[{id:0,lane:0}];
 while(pending.length){
  const item=pending.pop(),lane=item.lane??++lastLane,node=record.nodes[item.id];
  positions.push({id:item.id,column:node.depth,lane});
  if(node.parent!==null)edges.push({parent:node.parent,child:item.id});
  const child=preferred.get(item.id),children=node.children.includes(child)?[child,...node.children.filter(id=>id!==child)]:node.children;
  for(let i=children.length-1;i>=0;i--)pending.push({id:children[i],lane:i===0?lane:null});
 }
 return {positions,edges,lanes:lastLane+1,columns:Math.max(...positions.map(p=>p.column))+1};
}
