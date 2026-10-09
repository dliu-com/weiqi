// Full rows away from the points tests use, so no stone is ever captured.
const letters=[...'abcdefghijklmnopqrs'],black=['j','h'].flatMap(y=>letters.map(x=>x+y)),white=['l','n'].flatMap(y=>letters.map(x=>x+y));
export function padPoints(count=50,first='B'){const out=[];let b=0,w=0;for(let n=0;n<count;n++){const side=(n%2===0)===(first==='B')?'B':'W',point=side==='B'?black[b++]:white[w++];out.push({side,point,index:(point.charCodeAt(1)-97)*19+point.charCodeAt(0)-97});}return out;}
export const padMoves=(count=50,first='B')=>padPoints(count,first).map(m=>';'+m.side+'['+m.point+']').join('');
export const withMoves=(sgf,count=50,first='B')=>sgf.replace(/\)\s*$/,padMoves(count,first)+')');
