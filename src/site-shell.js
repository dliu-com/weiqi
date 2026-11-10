import {t,language,setLanguage} from './i18n.js';
// /docs is one page with a tab per hash, like the other dliu.com sites: /docs#cost, /docs#api, ...
// /docs on its own is Architecture. Benchmark rows (#run-…, #bench-…) belong to the Benchmarks tab, #perf-… sections to Performance.
export const DOCS_TABS=[['architecture','架构','Architecture'],['cost','运行成本','Cost'],['security','安全','Security'],['benchmarks','基准实验','Benchmarks'],['photo-recognition','照片识别','Photo recognition'],['performance','性能','Performance'],['api','API','API'],['health','健康','Health']];
export function docsTab(hash=location.hash){let id='';try{id=decodeURIComponent(hash.slice(1));}catch{}if(/^(run|bench)-/.test(id))return 'benchmarks';if(/^perf-/.test(id))return 'performance';return DOCS_TABS.some(([tab])=>tab===id)?id:'architecture';}
// Only the site admin signs in (Microsoft). Guests use the whole site without an account, so the button says "Admin sign in".
// Pages ask /api/owner/session only when the weiqi_owner hint cookie is set, so a guest's page never calls it.
// The hint is not trusted: the server checks the signed session cookie on every admin request.
export const adminSession=/(?:^|;\s*)weiqi_owner=1(?:;|$)/.test(document.cookie)
 ?fetch('/api/owner/session',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(s=>s?.signedIn===true?{signedIn:true,name:String(s.name||s.user||'')}:{signedIn:false}).catch(()=>({signedIn:false}))
 :Promise.resolve({signedIn:false});
export const adminSignInUrl=()=>'/auth/login?return='+encodeURIComponent(location.pathname+location.search+location.hash);
// Draws the shared dliu.com header (dl.css): weiqi logo and name, collapsible nav, page action, language switcher.
export class AppShell {
 constructor(){
  this.header=document.querySelector('body>header')||document.body.prepend(document.createElement('header'));
  this.header=document.querySelector('body>header');
  const extra=this.header.querySelector('#save-report');
  this.header.replaceChildren();this.header.className='dl-header';
  this.brand=document.createElement('a');this.brand.className='dl-brand';this.brand.href='/';
  const logo=document.createElement('img');logo.className='dl-logo';logo.src='/favicon.svg';logo.alt='';logo.width=32;logo.height=32;
  this.brandName=document.createElement('span');this.brand.append(logo,this.brandName);
  this.menuToggle=document.createElement('button');this.menuToggle.type='button';this.menuToggle.className='dl-button dl-menu-toggle';this.menuToggle.textContent='☰';this.menuToggle.setAttribute('aria-controls','dl-menu');this.menuToggle.setAttribute('aria-expanded','false');
  this.nav=document.createElement('nav');this.nav.id='dl-menu';this.nav.className='dl-nav dl-nav-collapsible';
  this.links=[['/play','对弈','Play game'],['/record','记录棋局','Record game'],['/analysis','AI 分析','AI analysis'],['/game','棋谱库','Game library'],['/guide','使用指南','User guide'],['/docs','文档','Docs']].map(([href,zh,en])=>{const a=document.createElement('a');a.className=href==='/docs'?'dl-button':'dl-nav-link';a.href=href;a.dataset.zh=zh;a.dataset.en=en;this.nav.append(a);return a;});
  if(extra)this.nav.append(extra);
  // Docs, then Admin sign in (or the admin's name and Sign out), then the language switcher, as on the other dliu.com sites.
  this.account=document.createElement('span');this.account.className='weiqi-account';this.account.style.display='contents';this.nav.append(this.account);this.admin={signedIn:false};adminSession.then(admin=>{this.admin=admin;this.render();});
  const switcher=document.createElement('div');switcher.className='dl-language';
  this.languageToggle=document.createElement('button');this.languageToggle.type='button';this.languageToggle.className='dl-button dl-language-toggle';this.languageToggle.textContent='文/A';this.languageToggle.setAttribute('aria-controls','dl-languages');this.languageToggle.setAttribute('aria-expanded','false');this.languageToggle.setAttribute('aria-label','Language / 语言');
  this.languages=document.createElement('div');this.languages.id='dl-languages';this.languages.className='dl-languages';this.languages.setAttribute('role','group');this.languages.setAttribute('aria-label','Language / 语言');
  for(const [value,label,lang] of [['zh','中文','zh-CN'],['en','English','en']]){const b=document.createElement('button');b.type='button';b.dataset.language=value;b.lang=lang;b.textContent=label;b.id='report-'+value;b.addEventListener('click',()=>{setLanguage(value);this.render();this.closePopups();window.dispatchEvent(new CustomEvent('site-language-change',{detail:value}));});this.languages.append(b);}
  switcher.append(this.languageToggle,this.languages);this.nav.append(switcher);
  // Narrow screens: the nav opens from the ☰ button, the language list from the 文/A button.
  const popups=[[this.menuToggle,this.nav],[this.languageToggle,this.languages]];
  const isOpen=([,panel])=>panel.classList.contains('is-open');
  const setOpen=([toggle,panel],open)=>{panel.classList.toggle('is-open',open);toggle.setAttribute('aria-expanded',String(open));};
  const anyOpen=()=>popups.some(isOpen);
  this.closePopups=()=>{for(const popup of popups)if(isOpen(popup))setOpen(popup,false);};
  for(const popup of popups)popup[0].onclick=()=>setOpen(popup,!isOpen(popup));
  // A tap outside an open menu only closes it, so it cannot also place a stone or press a button underneath.
  let swallowClick=false;
  document.addEventListener('pointerdown',event=>{swallowClick=false;if(!anyOpen()||this.header.contains(event.target))return;this.closePopups();swallowClick=true;},true);
  document.addEventListener('click',event=>{if(!swallowClick)return;swallowClick=false;event.preventDefault();event.stopPropagation();},true);
  document.addEventListener('keydown',event=>{swallowClick=false;if(event.key!=='Escape'||!anyOpen())return;event.preventDefault();event.stopPropagation();const toggle=isOpen(popups[1])&&getComputedStyle(this.languageToggle).display!=='none'?this.languageToggle:this.menuToggle;this.closePopups();toggle.focus();},true);
  document.addEventListener('focusin',event=>{if(anyOpen()&&!this.header.contains(event.target))this.closePopups();});
  this.header.append(this.brand,this.menuToggle,this.nav);
  // The /docs page has a tab bar at the top of main; each tab is a hash (DOCS_TABS).
  this.path=location.pathname.length>1?location.pathname.replace(/\/$/,''):location.pathname;
  const main=document.querySelector('main');
  if(main&&this.path==='/docs'){this.infoTabs=document.createElement('nav');this.infoTabs.className='dl-tabs';main.prepend(this.infoTabs);window.addEventListener('hashchange',()=>this.render());}
  this.footerLinks=[...document.querySelectorAll('.dl-footer a[data-zh]')];
  this.render();
  const measure=()=>document.documentElement.style.setProperty('--record-header-height',this.header.getBoundingClientRect().height+'px');
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(measure).observe(this.header);measure();
 }
 render(){this.brandName.textContent=t('DL 围棋','DL Weiqi');this.nav.setAttribute('aria-label',t('网站','Site'));this.menuToggle.setAttribute('aria-label',t('菜单','Menu'));for(const a of [...this.links,...this.footerLinks])a.textContent=t(a.dataset.zh,a.dataset.en);for(const a of this.links)if(this.path===a.getAttribute('href')||a.getAttribute('href')==='/game'&&location.pathname.startsWith('/game/'))a.setAttribute('aria-current','page');for(const b of this.languages.children)b.setAttribute('aria-pressed',String(language===b.dataset.language));
  if(this.admin.signedIn){const name=document.createElement('span');name.className='dl-account';name.textContent=this.admin.name;const out=document.createElement('a');out.className='dl-button';out.href='/auth/logout';out.textContent=t('退出登录','Sign out');this.account.replaceChildren(name,out);}
  else{const signIn=document.createElement('a');signIn.className='dl-button dl-signin';signIn.href=adminSignInUrl();signIn.textContent=t('管理员登录','Admin sign in');signIn.title=t('仅供网站管理员使用。其他人无需登录即可使用本网站的全部功能。','For the site admin only. Everyone else can use the whole site without signing in.');this.account.replaceChildren(signIn);}
  if(this.infoTabs){const here=docsTab();this.infoTabs.setAttribute('aria-label',t('文档章节','Docs sections'));this.infoTabs.replaceChildren(...DOCS_TABS.map(([id,zh,en])=>{const a=document.createElement('a');a.href='/docs#'+id;a.textContent=t(zh,en);if(here===id)a.setAttribute('aria-current','page');return a;}));const docs=this.links.find(a=>a.getAttribute('href')==='/docs');if(docs)docs.setAttribute('aria-current','page');
   // On phones the tabs scroll sideways: keep the current tab visible.
   const current=this.infoTabs.querySelector('[aria-current]'),box=this.infoTabs.getBoundingClientRect(),r=current?.getBoundingClientRect();if(r&&r.right>box.right)this.infoTabs.scrollLeft+=r.right-box.right+16;}
 }
}
export const appShell=new AppShell();
