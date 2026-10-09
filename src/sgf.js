import { play, opposite } from './engine.js';
export const MAX_SGF_BYTES = 256 * 1024;
export class SgfError extends Error { constructor(message) { super(message); this.statusCode = 400; } }
const fail = message => { throw new SgfError(message); };
export function parseSgf(source) {
  if (typeof source !== 'string' || !source.trim() || new TextEncoder().encode(source).length > MAX_SGF_BYTES) fail('Upload an SGF file no larger than 256 KB.');
  const text = source.replace(/^\uFEFF/, ''); let at = 0, count = 0;
  const space = () => { while (at < text.length && /\s/.test(text[at])) at++; };
  function value() {
    at++; let out = '';
    while (at < text.length) {
      let c = text[at++]; if (c === ']') return out;
      if (c === '\\') {
        if (at === text.length) fail('Invalid SGF escape.');
        c = text[at++]; if (c === '\n' || c === '\r') { if ((c === '\r' && text[at] === '\n') || (c === '\n' && text[at] === '\r')) at++; continue; }
      }
      out += c;
    }
    fail('Unclosed SGF property.');
  }
  function tree(depth = 0) {
    if (depth > 100) fail('Too many nested variations.');
    space(); if (text[at++] !== '(') fail('Invalid SGF game tree.');
    const nodes = [], branches = []; space();
    while (text[at] === ';') {
      at++; if (++count > 2000) fail('An SGF may contain at most 2,000 nodes.');
      const props = Object.create(null); space();
      while (/[A-Z]/.test(text[at] || '')) {
        let key = ''; while (/[A-Z]/.test(text[at] || '')) key += text[at++];
        space(); if (text[at] !== '[') fail('Invalid SGF property: ' + key);
        // Some apps repeat a property, e.g. AP[a]AP[b]; merge the values.
        props[key] ??= []; while (text[at] === '[') { props[key].push(value()); space(); }
      }
      nodes.push(props); space();
    }
    if (!nodes.length) fail('Empty SGF game tree.');
    while (text[at] === '(') { branches.push(tree(depth + 1)); space(); }
    if (text[at++] !== ')') fail('Unclosed SGF game tree.');
    return {nodes, branches};
  }
  const parsed = tree(); space(); if (at !== text.length) fail('Upload one game per file, without trailing text.');
  return parsed;
}
export function readSgfPlayerRanks(source) {
 const root=parseSgf(source).nodes[0],clean=value=>(value||'').replace(/\s+/g,' ').trim().slice(0,200);
 return {black:clean(root.BR?.[0]),white:clean(root.WR?.[0])};
}
export function readSgf(source) {
  const parsed = parseSgf(source), root = parsed.nodes[0];
  const one = (props,key) => { if (new Set(props[key]).size > 1) fail('Invalid SGF property: ' + key); return props[key]?.[0]; };
  if ((one(root,'GM') || '1') !== '1') fail('Only Go records are supported.');
  if (root.CA && !/^(UTF-?8|ASCII)$/i.test(one(root,'CA'))) fail('Please convert this SGF file to UTF-8.');
  const mainSeconds=Number(one(root,'TM')||0);if(!Number.isFinite(mainSeconds)||mainSeconds<0||mainSeconds>864000)fail('Invalid main time.');
  const size = Number(one(root,'SZ') || 19); if (size !== 19) fail('Only 19 × 19 SGF records are supported.');
  const komi = Number(one(root,'KM') ?? 0); if (!Number.isFinite(komi) || Math.abs(komi) > 400) fail('Invalid komi.');
  const point = value => {
    if (!/^[a-z]{2}$/.test(value)) fail('Invalid SGF coordinate.');
    const x = value.charCodeAt(0) - 97, y = value.charCodeAt(1) - 97; if (x >= size || y >= size) fail('SGF coordinate outside board.'); return y * size + x;
  };
  const initial = Array(size * size).fill('.');
  for (const [key,color] of [['AB','B'],['AW','W'],['AE','.']]) for (const value of root[key] || []) {
    const parts = value.split(':'); if (parts.length > 2) fail('Invalid setup range.');
    const a = point(parts[0]), b = point(parts[1] || parts[0]);
    if (a % size > b % size || Math.floor(a / size) > Math.floor(b / size)) fail('Invalid setup range.');
    for (let y = Math.floor(a / size); y <= Math.floor(b / size); y++) for (let x = a % size; x <= b % size; x++) {
      if (color !== '.' && initial[y*size+x] !== '.') fail('Overlapping setup stones.'); initial[y*size+x] = color;
    }
  }
  const pl = one(root,'PL'); if (pl && !['B','W'].includes(pl)) fail('Invalid player to move.');
  const initialPlayer = pl || (Number(one(root,'HA') || 0) > 1 ? 'W' : 'B');
  const nodes = [{parent:null,board:initial.join(''),depth:0,move:null,turn:initialPlayer,children:[],comment:root.C?.join('\n') || ''}], mainLine = [0];
  function visit(item,parent,main) {
    for (const props of item.nodes) {
      if (props === root && !props.B && !props.W) continue;
      if (props !== root && ['AB','AW','AE','PL'].some(key => props[key])) fail('Setup changes after the initial position are not supported.');
      if (props.B && props.W) fail('An SGF node cannot have two moves.');
      const side = props.B ? 'B' : props.W ? 'W' : null;
      if (!side) continue;
      if (['AB','AW','AE','PL'].some(key => props[key])) fail('Setup and moves cannot share a node.');
      const value = one(props,side), index = value === '' || (size <= 19 && value === 'tt') ? null : point(value);
      const before = nodes[parent]; let board = before.board;
      if (index !== null) { try { board = play(board,index,side === 'B' ? 'black' : 'white',size).board; } catch { fail('Illegal move at SGF position ' + (before.depth + 1) + '.'); } }
      const id = nodes.length; nodes.push({parent,board,depth:before.depth+1,move:{side,index},turn:side === 'B' ? 'W' : 'B',children:[],comment:props.C?.join('\n') || ''}); before.children.push(id); parent = id;
      if (main) mainLine.push(id);
    }
    item.branches.forEach((child,i) => visit(child,parent,main && i === 0));
  }
  visit(parsed,0,true);
  const clean = text => (text || '').replace(/\s+/g,' ').trim().slice(0,200);
  return {size,komi,rules:clean(one(root,'RU')),date:clean(one(root,'DT')),venue:clean(one(root,'PC')),result:clean(one(root,'RE')),name:clean(one(root,'GN')),players:{black:clean(one(root,'PB')),white:clean(one(root,'PW'))},playerRanks:{black:clean(one(root,'BR')),white:clean(one(root,'WR'))},timeControl:root.TM||root.OT?{mainSeconds,overtime:clean(one(root,'OT'))}:null,initialPlayer,nodes,mainLine};
}
export function kataQuery(record, id, visits = 1000) {
  const rules = record.rules.toLowerCase(); let normalized;
  if (!rules) normalized = 'japanese';
  else if (/chinese|中国|中國/.test(rules)) normalized = 'chinese';
  else if (/japanese|日本/.test(rules)) normalized = 'japanese';
  else if (/korean|韩国|韓國/.test(rules)) normalized = 'korean';
  else if (/aga/.test(rules)) normalized = 'aga';
  else if (/tromp/.test(rules)) normalized = 'tromp-taylor';
  else if (/new zealand|nz/.test(rules)) normalized = 'new-zealand';
  else fail('Unsupported analysis rules: ' + record.rules);
  const coord = i => 'ABCDEFGHJKLMNOPQRST'[i % record.size] + (record.size - Math.floor(i / record.size));
  return {id,boardXSize:record.size,boardYSize:record.size,komi:record.komi,rules:normalized,initialPlayer:record.initialPlayer,
    initialStones:[...record.nodes[0].board].flatMap((v,i) => v === '.' ? [] : [[v,coord(i)]]),
    moves:record.mainLine.slice(1).map(n => {const m=record.nodes[n].move;return [m.side,m.index === null ? 'pass' : coord(m.index)];}),
    analyzeTurns:record.mainLine.map((_,i) => i),maxVisits:visits,analysisPVLen:11};
}

// Keep the engine's ranking, rather than sorting noisy, low-visit score estimates.
export function kataCandidates(moveInfos, playedMove) {
  const validMove=m=>typeof m==='string'&&/^(?:pass|[A-HJ-T](?:[1-9]|1[0-9]))$/i.test(m);
  const candidates=(Array.isArray(moveInfos)?moveInfos:[]).filter(m=>m&&validMove(m.move)&&Number.isInteger(m.order)&&m.order>=0&&Number.isFinite(m.scoreLead)&&Number.isFinite(m.winrate)&&m.winrate>=0&&m.winrate<=1&&Number.isFinite(m.visits)&&m.visits>0).sort((a,b)=>a.order-b.order);
  const retained=candidates.slice(0,8),played=candidates.find(m=>m.move.toLowerCase()===playedMove?.toLowerCase());
  if(played&&!retained.includes(played))retained.push(played);
  return retained.map(m=>{
    const pv=[];
    for(const p of (Array.isArray(m.pv)?m.pv:[]).slice(0,12)){if(!validMove(p))break;pv.push(p.toLowerCase()==='pass'?'pass':p.toUpperCase());}
    return {move:m.move.toLowerCase()==='pass'?'pass':m.move.toUpperCase(),order:m.order,blackLead:m.scoreLead,blackWinrate:m.winrate,visits:m.visits,pv};
  });
}
