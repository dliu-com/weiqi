import test from 'node:test';import vm from 'node:vm';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
// Guards the shared dliu.com look (https://files.dliu.com/dliu.com/README.md): dl.css first, weiqi's own logo in the header, the DL logo in the footer.
const src=new URL('../src/',import.meta.url),read=file=>readFileSync(new URL(file,src),'utf8');
const DL_CSS='<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl.css">',DL_DOCS_CSS='<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl-docs.css">';
const pages=readdirSync(src).filter(file=>file.endsWith('.html'));
const docsPages=['about.html','how-to-use.html'];

test('every page loads the shared stylesheet before its own and uses the weiqi logo as favicon',()=>{
 assert.ok(pages.length>=10);
 for(const file of pages){const page=read(file),own=page.search(/<link rel="stylesheet" href="(?!https:)/);
  assert.ok(page.includes(DL_CSS),file);assert.ok(own===-1||page.indexOf(DL_CSS)<own,file);
  assert.ok(page.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml">'),file);}
});

test('every page has the shared page frame and a footer that starts with the DL logo',()=>{
 for(const file of pages){const page=read(file);
  assert.match(page,/<body class="dl-page[" ]/,file);assert.ok(page.includes('<header class="dl-header">'),file);assert.match(page,/<main [^>]*class="dl-main[" ]/,file);
  assert.ok(page.includes('<footer class="dl-footer"><a class="dl-footer-logo" href="https://dliu.com" aria-label="dliu.com"><img src="https://files.dliu.com/dliu.com/favicon.png" alt="" width="24" height="24"></a><a href="https://dliu.com">dliu.com</a>'),file);}
});

test('docs pages load the shared docs stylesheet',()=>{
 for(const file of docsPages){const page=read(file);assert.ok(page.includes(DL_DOCS_CSS),file);assert.ok(page.indexOf(DL_CSS)<page.indexOf(DL_DOCS_CSS),file);assert.match(page,/<main class="dl-main dl-docs-main[" ]/,file);}
});

test('the header script draws the shared header markup with weiqi\'s own logo and the collapsible menu',()=>{
 const shell=read('site-shell.js');
 for(const piece of ["className='dl-brand'","brand.href='/'","className='dl-logo'","src='/favicon.svg'","className='dl-button dl-menu-toggle'","'aria-controls','dl-menu'","nav.id='dl-menu'","className='dl-nav dl-nav-collapsible'","'dl-nav-link'","className='dl-language'","className='dl-button dl-language-toggle'","className='dl-languages'","className='dl-tabs'"])assert.ok(shell.includes(piece),piece);
 assert.doesNotMatch(shell,/site-header|info-tabs|menu-button/);
});

test('dialogs and choice groups use the shared components',()=>{
 for(const file of ['play.html','editor.html']){const page=read(file);for(const dialog of page.match(/<dialog[^>]*>/g)||[])assert.match(dialog,/class="dl-dialog[" ]/,file+' '+dialog);}
 assert.match(read('play.html'),/class="dl-segmented[" ]/);assert.match(read('photo.html'),/class="dl-segmented[" ]/);
});

test('the app stylesheets leave the header, buttons and palette to the shared stylesheet',()=>{
 for(const file of ['styles.css','site.css','photo.css']){const css=read(file);
  assert.doesNotMatch(css,/\.site-header|\.info-tabs|\.menu-button|button\.primary|--gold|--accent:|--line:|--muted:/,file);
  assert.doesNotMatch(css,/(^|[},])\s*button\s*\{/,file);}
});

test('/docs is one page with a hash per tab, like the other dliu.com sites; old tab paths 301 there',()=>{
 const c={};vm.runInNewContext(read('routes.cjs'),c);const route=(uri,querystring={})=>c.handler({request:{uri,querystring}});
 assert.equal(route('/docs').uri,'/about.html');
 for(const file of ['cost.html','security.html','benchmarks.html','photo-recognition.html'])assert.ok(!pages.includes(file),file);
 for(const [uri,to] of [['/about','/docs'],['/about/','/docs'],['/cost','/docs#cost'],['/docs/cost','/docs#cost'],['/docs/performance','/docs#performance'],['/performance','/docs#performance'],['/security.html','/docs#security'],['/docs/security','/docs#security'],['/benchmarks','/docs#benchmarks'],['/docs/benchmarks','/docs#benchmarks'],['/photo-recognition','/docs#photo-recognition'],['/docs/photo-recognition','/docs#photo-recognition'],['/docs/api','/docs#api'],['/docs/health','/docs#health']]){const r=route(uri);assert.equal(r.statusCode,301,uri);assert.equal(r.headers.location.value,to,uri);}
 // The query string goes before the hash, or the browser would treat it as part of the hash.
 assert.equal(route('/docs/cost',{lang:{value:'en'}}).headers.location.value,'/docs?lang=en#cost');
 const shell=read('site-shell.js');
 assert.ok(shell.includes("['/docs','文档','Docs']")&&shell.includes("href==='/docs'?'dl-button':'dl-nav-link'"));
 const box={location:{hash:''}};vm.runInNewContext(shell.match(/export const DOCS_TABS=[^\n]+/)[0].replace('export const DOCS_TABS=','globalThis.DOCS_TABS=')+'\n'+shell.match(/export function docsTab[^\n]+/)[0].replace('export ',''),box);
 assert.deepEqual([...box.DOCS_TABS].map(([id])=>id),['architecture','cost','security','benchmarks','photo-recognition','performance','api','health']);
 for(const [hash,tab] of [['','architecture'],['#cost','cost'],['#api','api'],['#health','health'],['#run-2026-10-01','benchmarks'],['#bench-runs','benchmarks'],['#performance','performance'],['#perf-server','performance'],['#nope','architecture'],['#%E0','architecture']])assert.equal(box.docsTab(hash),tab,hash);
 assert.ok(shell.includes("a.href='/docs#'+id"));
 for(const file of pages)assert.ok(read(file).includes('<a href="/docs" data-zh="文档" data-en="Docs">文档</a></footer>'),file);
 for(const file of pages)assert.doesNotMatch(read(file),/href="\/docs\/(cost|security|benchmarks|photo-recognition)"/,file);
 for(const file of ['about.js','documents.js','benchmarks.js'])assert.doesNotMatch(read(file),/'\/docs\/(cost|security|benchmarks|photo-recognition)['#]/,file);
 assert.doesNotMatch(read('about.html'),/(src|href)="(?![\/#]|https?:)/);
});

test('a publish never pairs a new page with an old script: assets first, edge cleared, then pages',()=>{
  const s=readFileSync(new URL('../scripts/publish-site.sh',import.meta.url),'utf8');
  assert.match(s,/for pass in assets pages; do/);
  assert.match(s,/assets:\*\.html\|pages:\*\.js\|pages:\*\.css\|pages:\*\.json/);
  assert.match(s,/if \[ "\$pass" = assets \]; then invalidate; fi/);
  const lastInvalidate=s.lastIndexOf('\ninvalidate\n'),index=s.indexOf('/index.html"');
  assert.ok(index>0&&lastInvalidate>index,'index.html uploads before the final invalidation');
  assert.match(s,/MODULE_CACHE='public, max-age=0, must-revalidate/);
});

test('the Architecture tab starts with a link to the source code',()=>{
 const about=read('about.js');
 assert.match(about,/p\.className='dl-docs-repo';label\.textContent=t\('源代码：','Source code:'\);a\.href='https:\/\/github\.com\/dliu-com\/weiqi';a\.textContent='github\.com\/dliu-com\/weiqi'/);
 assert.match(about,/fragment\.append\(repoLink\(\),stats\(/);
 assert.ok(read('about.html').includes(DL_DOCS_CSS));
});

test('guests never ask for an admin session; the header says "Admin sign in" and admin tools stay hidden for guests',async()=>{
 const shell=read('site-shell.js'),expr=shell.match(/export const adminSession=([\s\S]*?Promise\.resolve\(\{signedIn:false\}\));/)[1];
 const run=async(cookie,reply)=>{const calls=[];const session=await vm.runInNewContext(expr,{document:{cookie},fetch:async url=>{calls.push(url);return {ok:true,json:async()=>reply};}});return JSON.stringify({calls,session});};
 for(const cookie of ['','weiqi_owner=0','xweiqi_owner=1','a=1; weiqi_owner_x=1'])assert.equal(await run(cookie,{signedIn:true,name:'x'}),JSON.stringify({calls:[],session:{signedIn:false}}),cookie);
 assert.equal(await run('a=1; weiqi_owner=1',{signedIn:true,name:'Dewei',user:'d@x'}),JSON.stringify({calls:['/api/owner/session'],session:{signedIn:true,name:'Dewei'}}));
 // The hint cookie is not trusted: without a valid session the server answers signedIn:false, so no admin tools appear.
 assert.equal(await run('weiqi_owner=1',{signedIn:false}),JSON.stringify({calls:['/api/owner/session'],session:{signedIn:false}}));
 for(const piece of ["t('管理员登录','Admin sign in')","signIn.className='dl-button dl-signin'","name.className='dl-account'","out.href='/auth/logout'"])assert.ok(shell.includes(piece),piece);
 const record=read('record.html'),script=read('record.js');
 assert.match(record,/<section id="admin-tools"[^>]* hidden>/);for(const dialog of record.match(/<dialog[^>]*>/g))assert.match(dialog,/class="dl-dialog[" ]/,dialog);
 assert.ok(script.includes("$('admin-tools').hidden=!admin||!data"));
 assert.deepEqual(script.match(/\/api\/owner\/[^']*/g).sort(),['/api/owner/library/','/api/owner/library/']);
});
