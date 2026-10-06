import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {finishPdf} from './finish-pdf.mjs';
const directory=fileURLToPath(new URL('.',import.meta.url));
const fontStyle="@font-face{font-family:ReportNoto;src:url('/report-font.otf') format('opentype');font-display:swap}:root{font-family:ReportNoto,Arial,sans-serif}.report-formula{font-family:ReportNoto,monospace}";
export async function renderReports(report,{htmlOnly=false}={}){
 const local=process.env.CHROME_EXECUTABLE;
 const browser=await puppeteer.launch({executablePath:local||await chromium.executablePath(),args:local?['--no-sandbox']:chromium.args,headless:local?true:'shell',protocolTimeout:240000});
 try{
  const output={};
  for(const language of ['en','zh']){
   const page=await browser.newPage();await page.setViewport({width:1200,height:1600,deviceScaleFactor:1});await page.emulateTimezone('UTC');await page.setRequestInterception(true);
   page.on('request',async request=>{
    try{
     const url=new URL(request.url());if(['data:','blob:'].includes(url.protocol)){await request.continue();return;}if(url.origin!=='https://weiqi.dliu.com'){await request.abort();return;}
     if(url.pathname==='/api/library/'+report.id+'/report'){await request.respond({status:200,contentType:'application/json',body:JSON.stringify(report)});return;}
     if(url.pathname==='/record/'+report.id+'/report'){await request.respond({status:200,contentType:'text/html',body:await readFile(directory+'render.html')});return;}
     const file=url.pathname.slice(1);if(!/^[a-z0-9.-]+$/.test(file)){await request.abort();return;}
     const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.otf')?'font/otf':'text/plain';
     await request.respond({status:200,contentType:type,body:await readFile(directory+'assets/'+file)});
    }catch{if(!request.isInterceptResolutionHandled())await request.abort();}
   });
   page.on('pageerror',error=>console.error('Report rendering error:',error.message));
   await page.goto('https://weiqi.dliu.com/record/'+report.id+'/report?lang='+language,{waitUntil:'networkidle0',timeout:45000});
   await page.waitForFunction(()=>document.querySelectorAll('.report-sheet').length>0,{timeout:45000});
   await page.addStyleTag({content:fontStyle});await page.evaluate(()=>document.fonts.ready);
   const content=await page.evaluate(()=>{const main=document.querySelector('main').cloneNode(true);for(const a of main.querySelectorAll('a[href]'))a.setAttribute('href',a.dataset.reportPage?'#report-page-'+a.dataset.reportPage:new URL(a.getAttribute('href'),location.origin).href);return {html:main.outerHTML,pages:main.querySelectorAll('.report-sheet').length};});
   const css=await readFile(directory+'assets/report.css','utf8');
   const html='<!doctype html><html lang="'+(language==='zh'?'zh-CN':'en')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weiqi '+report.id+'</title><style>'+css+'\n'+fontStyle+'</style></head><body>'+content.html+'</body></html>';
   let pdf=null;
   if(!htmlOnly){
    await page.emulateMediaType('print');
    await page.addStyleTag({content:'@page{size:A4 portrait;margin:12mm}.report-sheet{width:186mm!important;height:270mm!important;min-height:0!important;margin:0!important;padding:0!important;box-shadow:none!important;display:flex!important;flex-direction:column!important;break-after:page!important}.report-sheet:last-child{break-after:auto!important}.report-sheet>*{flex-shrink:0}.report-footer{margin-top:auto!important;padding-top:14px!important}.report-cover{border-top:5px solid #26343d;padding-top:16px!important}.report-cover h1{font-size:36px!important}.report-stat-card>svg{width:100%!important;height:auto!important}.report-chart svg{width:100%!important;height:auto!important;max-height:none!important}.diagram-pair{grid-template-columns:1fr 1fr!important}'});
    await page.evaluate(()=>document.fonts.ready);
    // Fit each document section to one page while keeping SVG and text vector.
    // A fixed paper width also avoids SVGs inheriting the wider screen viewport.
    await page.evaluate(()=>{
     for(const sheet of document.querySelectorAll('.report-sheet')){
      const footer=sheet.querySelector('.report-footer'),outer=document.createElement('div'),inner=document.createElement('div');
      inner.style.width=sheet.clientWidth+'px';inner.style.display='flow-root';
      for(const child of [...sheet.children])if(child!==footer)inner.append(child);
      outer.append(inner);sheet.prepend(outer);
      const css=getComputedStyle(sheet),available=sheet.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom)-(footer?.getBoundingClientRect().height||0)-12;
      const height=inner.getBoundingClientRect().height,scale=Math.min(1,available/height);
      // zoom participates in print pagination; transforms only alter painting
      // and can leave a paragraph fragmented onto the following page.
      inner.style.zoom=String(scale);outer.style.height=height*scale+'px';
     }
    });
    pdf=await finishPdf(await page.pdf({preferCSSPageSize:true,printBackground:true,outline:true,tagged:true,timeout:60000}),{id:report.id,language,pageCount:content.pages});
   }
   output[language]={pdf,html,pageCount:content.pages};await page.close();
  }
  return output;
 }finally{await browser.close();}
}
