import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),feature=root+'photo-analysis/',out=root+'src/photo-assets/';
execFileSync(process.execPath,[feature+'node_modules/vite/bin/vite.js','build'],{cwd:feature,stdio:'inherit'});
await mkdir(out+'ort',{recursive:true});await mkdir(out+'tfjs',{recursive:true});
for(const name of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm',])await cp(feature+'node_modules/onnxruntime-web/dist/'+name,out+'ort/'+name);
for(const name of ['tfjs-backend-wasm.wasm','tfjs-backend-wasm-simd.wasm','tfjs-backend-wasm-threaded-simd.wasm'])await cp(feature+'node_modules/@tensorflow/tfjs-backend-wasm/dist/'+name,out+'tfjs/'+name);
await cp(feature+'LICENSE',out+'LICENSE.txt');await cp(feature+'SOURCES.json',out+'SOURCES.json');
let notices='Photo analysis © 2026 DL. AGPL-3.0-only; no warranty.\n\n';for(const [label,file] of [['Kaya board recognition (AGPL-3.0)','LICENSE'],['Web KaTrain (MIT)','vendor/web-katrain/LICENSE'],['KataGo small model (MIT)','vendor/KataGo-LICENSE'],['ONNX Runtime (MIT)','vendor/ONNX-LICENSE'],['TensorFlow.js (Apache-2.0)','vendor/TensorFlow-LICENSE'],['pako (MIT/Zlib)','node_modules/pako/LICENSE']])notices+='\n'+label+'\n'+await readFile(feature+file,'utf8');await writeFile(out+'NOTICES.txt',notices);
// Whitelist source files only. No credentials, photos, private config, models,
// node_modules or build outputs can enter the downloadable source archive.
const stage=root+'photo-analysis/.source-stage/';await rm(stage,{recursive:true,force:true});await mkdir(stage+'photo-analysis',{recursive:true});
for(const name of ['src','vendor','LICENSE','README.md','SOURCES.json','package.json','package-lock.json','vite.config.js'])await cp(feature+name,stage+'photo-analysis/'+name,{recursive:true});
await mkdir(stage+'backend/position',{recursive:true});await cp(root+'backend/position',stage+'backend/position',{recursive:true,filter:p=>!p.includes('__pycache__')});await mkdir(stage+'scripts',{recursive:true});await cp(root+'scripts/build-position-runtime.py',stage+'scripts/build-position-runtime.py');await cp(root+'backend/position-handler.cjs',stage+'backend/position-handler.cjs');
await mkdir(stage+'scripts',{recursive:true});await cp(root+'scripts/build-photo-analysis.mjs',stage+'scripts/build-photo-analysis.mjs');await mkdir(stage+'src');for(const name of ['photo.html','photo.css','analysis-benchmarks.html','site-shell.js','i18n.js','styles.css','site.css'])await cp(root+'src/'+name,stage+'src/'+name);
execFileSync('tar',['-czf',out+'photo-source.tar.gz','-C',stage,'.']);await rm(stage,{recursive:true,force:true});
console.log('Photo feature and corresponding source built. Models remain on upstream hosts.');
