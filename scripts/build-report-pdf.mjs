import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await build({entryPoints:[root+'src/report-pdf-source.js'],outfile:root+'src/report-pdf.js',bundle:true,format:'esm',platform:'browser',target:['es2020'],minify:true,legalComments:'linked'});
