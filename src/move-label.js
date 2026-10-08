// "Move N", then the stone colour and point of that move. Shared by the recording editor and the replay.
export const pointName=(index,size=19)=>'ABCDEFGHJKLMNOPQRST'[index%size]+(size-Math.floor(index/size));

export function renderMoveLabel(element,{depth,move,t,size=19,mode=''}){
 const main=document.createElement('span');main.className='move-main';main.append(t('第 '+depth+' 手','Move '+depth));
 if(move){
  const black=move.side==='B',stone=document.createElement('span');
  stone.className='move-stone '+(black?'black':'white');stone.setAttribute('role','img');stone.setAttribute('aria-label',black?t('黑','Black'):t('白','White'));
  main.append(stone,move.index===null?t('停一手','Pass'):pointName(move.index,size));
 }
 const parts=[main];
 if(mode){const tag=document.createElement('span');tag.className='move-mode';tag.textContent=mode;parts.unshift(tag);}
 element.replaceChildren(...parts);
}
