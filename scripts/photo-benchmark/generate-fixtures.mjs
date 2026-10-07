// Creates exact references from legal SGF positions, including captures.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readSgf} from '../../src/sgf.js';
const [source,destination,python='python3']=process.argv.slice(2);
if(!source||!destination)throw Error('Usage: node generate-fixtures.mjs source.sgf output-directory [python]');
const sgf=await readFile(source,'utf8'),record=readSgf(sgf),last=record.mainLine.length-1;
const depths=[...new Set([20,80,160,last].map(n=>Math.min(n,last)))];
await mkdir(destination,{recursive:true});
await writeFile(destination+'/positions.json',JSON.stringify({name:record.name,size:record.size,source:'SGF main line; captures replayed by the game engine',positions:depths.map(depth=>({depth,board:record.nodes[record.mainLine[depth]].board}))},null,2));
const result=spawnSync(python,[fileURLToPath(new URL('./render-fixtures.py',import.meta.url)),destination],{stdio:'inherit'});
process.exitCode=result.status??1;
