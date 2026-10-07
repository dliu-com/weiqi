// Builds the licence files and corresponding source archive for Quick AI analysis.
// The page itself is plain ES modules in src/, so there is no bundling step.
import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),feature=root+'photo-analysis/',out=root+'src/photo-assets/';
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await cp(feature+'LICENSE',out+'LICENSE.txt');await cp(feature+'SOURCES.json',out+'SOURCES.json');
let notices='Quick AI analysis © 2026 DL. AGPL-3.0-only; no warranty.\n\n';
for(const [label,file] of [['Kaya board recognition (AGPL-3.0)','LICENSE'],['KataGo small model (MIT)','vendor/KataGo-LICENSE'],['ONNX Runtime (MIT)','vendor/ONNX-LICENSE']])notices+='\n'+label+'\n'+await readFile(feature+file,'utf8');
await writeFile(out+'NOTICES.txt',notices);
// Whitelist source files only. No credentials, photos, private config, models,
// node_modules or build outputs can enter the downloadable source archive.
const stage=root+'photo-analysis/.source-stage/';await rm(stage,{recursive:true,force:true});await mkdir(stage+'photo-analysis',{recursive:true});
for(const name of ['vendor','LICENSE','README.md','SOURCES.json'])await cp(feature+name,stage+'photo-analysis/'+name,{recursive:true});
await mkdir(stage+'backend/position',{recursive:true});await cp(root+'backend/position',stage+'backend/position',{recursive:true,filter:p=>!p.includes('__pycache__')});
await cp(root+'backend/position-handler.cjs',stage+'backend/position-handler.cjs');
await mkdir(stage+'scripts',{recursive:true});for(const name of ['build-position-runtime.py','build-photo-analysis.mjs'])await cp(root+'scripts/'+name,stage+'scripts/'+name);
await mkdir(stage+'src');
for(const name of ['photo.html','photo.css','analysis.js','analysis-position.js','position-api.js','board-view.js','board-geometry.js','sgf.js','engine.js','site-shell.js','i18n.js','styles.css','site.css'])await cp(root+'src/'+name,stage+'src/'+name);
execFileSync('tar',['-czf',out+'photo-source.tar.gz','-C',stage,'.']);await rm(stage,{recursive:true,force:true});
console.log('Quick AI analysis licences and corresponding source built. Models remain on upstream hosts.');
