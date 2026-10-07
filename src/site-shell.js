import {t,language,setLanguage} from './i18n.js';
export class AppShell {
 constructor(){
  this.header=document.querySelector('body>header')||document.body.prepend(document.createElement('header'));
  this.header=document.querySelector('body>header');
  const extra=this.header.querySelector('#save-report');
  this.header.replaceChildren();this.header.className='site-header';
  const logo=document.createElement('a');logo.className='logo';logo.href='https://dliu.com';logo.setAttribute('aria-label','dliu.com');
  const img=document.createElement('img');img.src='https://files.dliu.com/dliu.com/favicon.png';img.width=36;img.height=36;img.alt='DL';logo.append(img);
  this.brand=document.createElement('a');this.brand.className='brand';this.brand.href='/';
  this.menuButton=document.createElement('button');this.menuButton.className='menu-toggle';this.menuButton.type='button';this.menuButton.textContent='☰';this.menuButton.setAttribute('aria-controls','site-menu');this.menuButton.setAttribute('aria-expanded','false');
  this.menu=document.createElement('nav');this.menu.id='site-menu';this.menu.className='site-menu';
  this.links=[['/play','现场对弈','Play live game'],['/record','记录棋局','Record game'],['/analysis','快速 AI 分析','Quick AI analysis'],['/game','棋谱库','Game library'],['/guide','使用指南','User guide'],['/about','关于','About']].filter(([href])=>href!=='/guide'||!['/','/index.html'].includes(location.pathname)).map(([href,zh,en])=>{const a=document.createElement('a');a.href=href;a.dataset.zh=zh;a.dataset.en=en;this.menu.append(a);return a;});
  this.languageToggle=document.createElement('button');this.languageToggle.type='button';this.languageToggle.className='language-toggle';this.languageToggle.textContent='文/A';this.languageToggle.setAttribute('aria-controls','site-languages');this.languageToggle.setAttribute('aria-expanded','false');
  this.languages=document.createElement('div');this.languages.id='site-languages';this.languages.className='languages';this.languages.setAttribute('role','group');this.languages.setAttribute('aria-label','Language / 语言');
  for(const [value,label] of [['zh','中文'],['en','English']]){const b=document.createElement('button');b.type='button';b.dataset.language=value;b.lang=value;b.textContent=label;b.id='report-'+value;b.addEventListener('click',()=>{setLanguage(value);this.render();this.languages.classList.remove('is-open');this.languageToggle.setAttribute('aria-expanded','false');window.dispatchEvent(new CustomEvent('site-language-change',{detail:value}));});this.languages.append(b);}
  this.menuButton.onclick=()=>{const open=this.menu.classList.toggle('is-open');this.menuButton.setAttribute('aria-expanded',String(open));};
  this.languageToggle.onclick=()=>{const open=this.languages.classList.toggle('is-open');this.languageToggle.setAttribute('aria-expanded',String(open));};
  this.header.append(logo,this.brand,this.menuButton,this.menu);if(extra)this.header.append(extra);this.header.append(this.languageToggle,this.languages);this.render();
  const measure=()=>document.documentElement.style.setProperty('--record-header-height',this.header.getBoundingClientRect().height+'px');
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(measure).observe(this.header);measure();
 }
 render(){this.brand.textContent=t('DL 围棋','DL Weiqi');this.menu.setAttribute('aria-label',t('主菜单','Main menu'));this.menuButton.setAttribute('aria-label',t('菜单','Menu'));this.languageToggle.setAttribute('aria-label',t('语言','Language'));for(const a of this.links){a.textContent=t(a.dataset.zh,a.dataset.en);if(location.pathname===a.getAttribute('href')||a.getAttribute('href')==='/game'&&location.pathname.startsWith('/game/'))a.setAttribute('aria-current','page');}for(const b of this.languages.children)b.setAttribute('aria-pressed',String(language===b.dataset.language));}
}
export const appShell=new AppShell();
