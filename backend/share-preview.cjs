// Link previews: messaging apps read Open Graph tags from /share/<id>.html and show the final board PNG.
const SHARE_ORIGIN='https://weiqi.dliu.com',SHARE_IMAGE_PX=600;
const shareCrcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function shareCrc(bytes){let c=0xffffffff;for(const b of bytes)c=shareCrcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function shareChunk(type,data){
 const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);out.write(type,4,'ascii');data.copy(out,8);
 out.writeUInt32BE(shareCrc(out.subarray(4,8+data.length)),8+data.length);return out;
}
// board: one character per point ('B', 'W' or '.'), row by row from the top-left corner.
function boardPng(board,size=19,px=SHARE_IMAGE_PX){
 if(typeof board!=='string'||board.length!==size*size)throw Error('Invalid board.');
 const cell=px/size,margin=cell/2,radius=cell*.47,star=Math.max(2,cell*.11),line=Math.max(1,px/600);
 const wood=[220,179,92],ink=[40,30,15],black=[17,17,17],white=[246,246,246],edge=[60,60,60];
 const stars=new Set(size===19?[3,9,15].flatMap(y=>[3,9,15].map(x=>y*size+x)):[]);
 const mix=(a,b,t)=>t<=0?a:t>=1?b:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
 const cover=(edgeDistance)=>Math.max(0,Math.min(1,edgeDistance+.5));
 const raw=Buffer.alloc((px*3+1)*px),lo=margin-line/2,hi=px-margin+line/2;
 for(let y=0;y<px;y++){
  const row=y*(px*3+1);raw[row]=0;const cy=y+.5,iy=Math.min(size-1,Math.max(0,Math.round((cy-margin)/cell))),gy=margin+iy*cell;
  for(let x=0;x<px;x++){
   const cx=x+.5,ix=Math.min(size-1,Math.max(0,Math.round((cx-margin)/cell))),gx=margin+ix*cell;
   let color=wood;
   if(cy>=lo&&cy<=hi&&cx>=lo&&cx<=hi)color=mix(color,ink,Math.max(cover(line/2-Math.abs(cx-gx)),cover(line/2-Math.abs(cy-gy)))*.85);
   const d=Math.hypot(cx-gx,cy-gy),point=iy*size+ix,s=board[point];
   if(s==='.'&&stars.has(point))color=mix(color,ink,cover(star-d));
   if(s==='B')color=mix(color,black,cover(radius-d));
   if(s==='W')color=mix(mix(color,edge,cover(radius-d)),white,cover(radius-line*1.2-d));
   const o=row+1+x*3;raw[o]=Math.round(color[0]);raw[o+1]=Math.round(color[1]);raw[o+2]=Math.round(color[2]);
  }
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(px,0);header.writeUInt32BE(px,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),shareChunk('IHDR',header),shareChunk('IDAT',require('node:zlib').deflateSync(raw,{level:9})),shareChunk('IEND',Buffer.alloc(0))]);
}
const shareEscape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function sharePlayer(name,rank,fallback){return (name||fallback)+(rank?' '+rank:'');}
function shareText(metadata){
 const p=metadata.players||{},r=metadata.playerRanks||{};
 const players=p.black||p.white?sharePlayer(p.black,r.black,'Black')+' vs '+sharePlayer(p.white,r.white,'White'):'';
 const title=metadata.name||players||'Go game';
 const details=[players&&players!==title?players:'',metadata.date,metadata.result,Number.isInteger(metadata.moves)?metadata.moves+' moves · '+metadata.moves+' 手':''].filter(Boolean);
 return {title,description:details.join(' · ')||'Go game record · 围棋棋谱'};
}
function shareHtml(metadata,px=SHARE_IMAGE_PX){
 const id=metadata.id,url=SHARE_ORIGIN+'/game/'+id,image=SHARE_ORIGIN+'/share/'+id+'.png',{title,description}=shareText(metadata);
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${shareEscape(title)} · DL Weiqi</title><meta name="description" content="${shareEscape(description)}"><link rel="canonical" href="${url}"><meta property="og:site_name" content="DL Weiqi"><meta property="og:type" content="website"><meta property="og:title" content="${shareEscape(title)}"><meta property="og:description" content="${shareEscape(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${image}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="${px}"><meta property="og:image:height" content="${px}"><meta property="og:image:alt" content="Final position · 终局"><meta name="twitter:card" content="summary"></head><body><h1>${shareEscape(title)}</h1><p>${shareEscape(description)}</p><p><a href="${url}"><img src="${image}" width="${px}" height="${px}" alt="Final position · 终局"></a></p><p><a href="${url}">${url}</a></p></body></html>`;
}
// record comes from readSgf(); the image shows the final main-line position.
function shareFiles(record,metadata){
 const final=record.nodes[record.mainLine[record.mainLine.length-1]].board;
 return [{key:'share/'+metadata.id+'.png',body:boardPng(final,record.size),type:'image/png'},{key:'share/'+metadata.id+'.html',body:shareHtml(metadata),type:'text/html; charset=utf-8'}];
}
module.exports={boardPng,shareHtml,shareFiles};
