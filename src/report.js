// Interaction retrieves files already prepared after deep analysis. No report/PDF generation.
const $=id=>document.getElementById(id),id=location.pathname.match(/^\/record\/([^/]+)\/report\/?$/)?.[1];
let language=new URLSearchParams(location.search).get('lang')==='zh'?'zh':'en',manifest=null;
const t=(zh,en)=>language==='zh'?zh:en;
const cache=new Map();
function labels(){
 document.documentElement.lang=language==='zh'?'zh-CN':'en';
 document.title=t('AI 棋局报告','AI game report')+' · DL';
 $('back-record').textContent=t('返回棋局','Return to game');$('back-record').href='/record/'+id;
 $('save-report').textContent=t('保存 PDF','Save PDF');
 for(const value of ['en','zh'])$('report-'+value).setAttribute('aria-pressed',String(language===value));
}
function assetPath(path){if(typeof path!=='string'||!path.startsWith('/prepared-reports/'+id+'/')||path.includes('..')||path.includes('?')||path.includes('#'))throw Error('Invalid report file.');return path;}
async function show(){
 labels();$('save-report').removeAttribute('href');$('save-report').setAttribute('aria-disabled','true');
 if(!manifest||manifest.status!=='ready')return;
 $('report-status').textContent=t('正在打开已生成的报告…','Opening the prepared report…');
 const selected=language,files=manifest.languages[selected];
 try{
  const path=assetPath(files.html);
  if(!cache.has(path)){const response=await fetch(path,{cache:'force-cache'});if(!response.ok)throw Error('Report file unavailable.');cache.set(path,await response.text());}
  if(selected!==language)return;
  const doc=new DOMParser().parseFromString(cache.get(path),'text/html'),content=doc.querySelector('main'),style=doc.querySelector('style');
  if(!content||doc.querySelector('script'))throw Error('Invalid report view.');
  let current=$('prepared-report-style');if(!current){current=document.createElement('style');current.id='prepared-report-style';document.head.append(current);}current.textContent=style?.textContent||'';
  for(const a of content.querySelectorAll('a[href]'))if(a.getAttribute('href').startsWith('#'))a.setAttribute('href',location.pathname+location.search+a.getAttribute('href'));
  $('report-content').replaceChildren(...content.childNodes);
  $('save-report').href=assetPath(files.pdf);$('save-report').download='weiqi-'+id+'-'+selected+'.pdf';$('save-report').setAttribute('aria-disabled','false');$('report-status').textContent='';
 }catch(e){console.error(e);$('report-status').textContent=t('无法打开已生成的报告，请刷新重试。','Unable to open the prepared report. Refresh to try again.');}
}
for(const value of ['en','zh'])$('report-'+value).onclick=()=>{language=value;const url=new URL(location.href);url.searchParams.set('lang',value);history.replaceState(null,'',url);show();};
$('save-report').onclick=e=>{if($('save-report').getAttribute('aria-disabled')==='true')e.preventDefault();};
labels();
try{
 if(!id)throw Error('Missing record ID.');
 const response=await fetch('/prepared-reports/'+id+'/index.json',{cache:'no-store'});
 if(response.status===404){$('report-status').textContent=t('深度分析完成后，系统将在后台准备报告文件。稍后刷新本页查看。','Report files are prepared in the background after deep analysis. Refresh this page shortly.');}
 else{
  if(!response.ok)throw Error('Report status unavailable.');manifest=await response.json();
  if(manifest.status==='ready')await show();
  else $('report-status').textContent=manifest.status==='failed'?t('报告文件准备失败。请稍后刷新查看；棋谱和分析结果不受影响。','Report preparation failed. Refresh later; your game and analysis are still available.'):t('报告和 PDF 正在后台生成，完成后即可直接查看和下载。请稍后刷新。','The report and PDFs are being prepared in the background. Refresh shortly to view and download the finished files.');
 }
}catch(e){console.error(e);$('report-status').textContent=t('报告状态暂时无法读取，请刷新重试。','Report status is temporarily unavailable. Refresh to try again.');}
