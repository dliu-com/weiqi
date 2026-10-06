import {readSgf,parseSgf} from './sgf.js';
import {play} from './engine.js';
export function recordingTree(source){const record=readSgf(source);record.rootProperties=structuredClone(parseSgf(source).nodes[0]);delete record.rootProperties.B;delete record.rootProperties.W;return record;}
export function recordingSgf(record,mainOnly=false){
 const escape=value=>String(value).replace(/\\/g,'\\\\').replace(/\]/g,'\\]').replace(/\r\n?/g,'\n');
 const coord=i=>String.fromCharCode(97+i%19,97+Math.floor(i/19));
 const props={...record.rootProperties,GM:['1'],FF:['4'],CA:['UTF-8'],SZ:['19'],KM:[String(record.komi)],RU:[record.rules||'Japanese'],GN:[record.name||'Recorded game'],PB:[record.players.black],PW:[record.players.white],DT:[record.date],RE:[mainOnly&&!/^(?:[BW]\+|0$|Draw$|Jigo$)/i.test(record.result||'')?'0':record.result||'0'],PL:[record.initialPlayer]};
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
 if(record.nodes.length>=2000)throw Error('The draft may contain at most 2,000 positions.');
 const history=[];for(let n=parent;n!==null;n=record.nodes[n].parent)history.push(record.nodes[n].board);
 const board=index===null?node.board:play(node.board,index,node.turn==='B'?'black':'white',19,history).board;
 const id=record.nodes.length;record.nodes.push({parent,board,depth:node.depth+1,move:{side:node.turn,index},turn:node.turn==='B'?'W':'B',children:[],comment:''});node.children.push(id);updateMainLine(record);return id;
}
export function updateMainLine(record){record.mainLine=[0];let n=0;while(record.nodes[n].children.length){n=record.nodes[n].children[0];record.mainLine.push(n);}return record;}
export function promoteRecordingBranch(record,id){if(!record.nodes[id])throw Error('Invalid move.');for(let n=id;record.nodes[n].parent!==null;n=record.nodes[n].parent){const parent=record.nodes[record.nodes[n].parent];parent.children=[n,...parent.children.filter(c=>c!==n)];}return updateMainLine(record);}
export function deleteRecordingBranch(record,id){if(!id||!record.nodes[id])throw Error('Select a move to delete.');const parent=record.nodes[id].parent;record.nodes[parent].children=record.nodes[parent].children.filter(c=>c!==id);const next=recordingTree(recordingSgf(record));const path=[];for(let n=parent;n!==0;n=record.nodes[n].parent)path.unshift(record.nodes[record.nodes[n].parent].children.indexOf(n));let selected=0;for(const child of path)selected=next.nodes[selected].children[child];return {record:next,selected};}
export function newRecordingSgf(){return '(;GM[1]FF[4]CA[UTF-8]SZ[19]RU[Japanese]KM[6.5]GN[Recorded game]RE[0])';}
export function mainRecordingSgf(source){return recordingSgf(recordingTree(source),true);}
