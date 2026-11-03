import test from 'node:test';import vm from 'node:vm';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
// Guards the shared dliu.com look (https://files.dliu.com/dliu.com/README.md): dl.css first, weiqi's own logo in the header, the DL logo in the footer.
const src=new URL('../src/',import.meta.url),read=file=>readFileSync(new URL(file,src),'utf8');
const DL_CSS='<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl.css">',DL_DOCS_CSS='<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl-docs.css">';
const pages=readdirSync(src).filter(file=>file.endsWith('.html'));
const docsPages=['about.html','how-to-use.html','benchmarks.html','cost.html','security.html','photo-recognition.html','site-health.html'];

test('every page loads the shared stylesheet before its own and uses the weiqi logo as favicon',()=>{
 assert.ok(pages.length>=14);
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

test('/docs holds architecture, cost and security; the menu and footer link to it',()=>{
 const c={};vm.runInNewContext(read('routes.cjs'),c);const route=(uri,querystring={})=>c.handler({request:{uri,querystring}});
 for(const [uri,file] of [['/docs','/about.html'],['/docs/cost','/cost.html'],['/docs/security','/security.html']])assert.equal(route(uri).uri,file);
 for(const [uri,to] of [['/about','/docs'],['/about/','/docs'],['/cost','/docs/cost'],['/security.html','/docs/security'],['/benchmarks','/docs/benchmarks'],['/photo-recognition','/docs/photo-recognition']]){const r=route(uri);assert.equal(r.statusCode,301,uri);assert.equal(r.headers.location.value,to,uri);}
 assert.equal(route('/cost',{lang:{value:'en'}}).headers.location.value,'/docs/cost?lang=en');
 const shell=read('site-shell.js');
 assert.ok(shell.includes("['/docs','文档','Docs']")&&shell.includes("href==='/docs'?'dl-button':'dl-nav-link'"));
 for(const tab of ["['/docs','技术架构','Technical architecture']","['/docs/cost','运行成本','Cost']","['/docs/security','安全','Security']"])assert.ok(shell.includes(tab),tab);
 for(const file of pages)assert.ok(read(file).includes('<a href="/docs" data-zh="文档" data-en="Docs">文档</a></footer>'),file);
 // Docs pages are served below /docs/, so their own files must be linked from the site root.
 for(const file of ['about.html','cost.html','security.html','benchmarks.html','photo-recognition.html'])assert.doesNotMatch(read(file),/(src|href)="(?![\/#]|https?:)/,file);
});
