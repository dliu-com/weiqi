import html2canvas from 'html2canvas';
import {jsPDF} from 'jspdf';

// A single fixed A4 preset. Front matter, contents and page numbering are shared
// with the preview. Render one sheet at a time to bound memory on mobile.
export async function saveReportPdf(sheets,id,language,progress=()=>{}) {
  if(!sheets.length||!['en','zh'].includes(language))throw Error('Report unavailable');
  await document.fonts.ready;
  const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  pdf.setProperties({title:'Weiqi AI report '+id+' ('+language+')',author:'weiqi.dliu.com',subject:'Game statistics, mathematical methods and key errors'});
  for(const [index,sheet] of sheets.entries()){
    let links=[];
    const canvas=await html2canvas(sheet,{
      scale:2,backgroundColor:'#ffffff',logging:false,windowWidth:1200,windowHeight:1600,scrollX:0,scrollY:0,
      onclone:(doc,clonedSheet)=>{
        const style=doc.createElement('style');
        style.textContent='.report-sheet{width:794px!important;min-height:1123px!important;margin:0!important;padding:45px!important;box-shadow:none!important;background:white!important;display:flex!important;flex-direction:column!important}.report-sheet>*{flex-shrink:0}.report-footer{margin-top:auto!important;padding-top:14px!important}.diagram-pair{grid-template-columns:1fr 1fr!important}.report-table{font-size:12px!important}.report-table td,.report-table th{padding:8px!important}.report-cover h1{font-size:48px!important}.report-cover-name{font-size:14px!important}.report-cover-player{padding:16px 20px!important}.report-cover-player strong{font-size:20px!important}.report-cover-brand{margin-bottom:30px!important}.report-cover-result{font-size:22px!important}.report-contents-list a{font-size:12px!important;padding:9px 0!important;gap:10px!important}.report-tools,#report-status{display:none!important}';
        doc.head.append(style);
        const origin=clonedSheet.getBoundingClientRect();
        links=Array.from(clonedSheet.querySelectorAll('a[href]')).map(link=>{
          const box=link.getBoundingClientRect(),pageNumber=Number(link.dataset.reportPage);
          return {x:box.left-origin.left,y:box.top-origin.top,width:box.width,height:box.height,...(pageNumber?{pageNumber}:{url:new URL(link.getAttribute('href'),'https://weiqi.dliu.com').href})};
        });
      },
    });
    if(index)pdf.addPage();
    const ratio=Math.min(210/canvas.width,297/canvas.height),width=canvas.width*ratio,height=canvas.height*ratio,offsetX=(210-width)/2;
    pdf.addImage(canvas,'PNG',offsetX,0,width,height,undefined,'FAST');
    for(const link of links){
      if(link.width<=0||link.height<=0)continue;
      const destination=link.pageNumber?{pageNumber:link.pageNumber}:{url:link.url};
      pdf.link(offsetX+link.x*2*ratio,link.y*2*ratio,link.width*2*ratio,link.height*2*ratio,destination);
    }
    canvas.width=0;canvas.height=0;
    progress(index+1,sheets.length);
  }
  for(const [index,sheet] of sheets.entries())pdf.outline.add(null,sheet.dataset.reportTitle||'Page '+(index+1),{pageNumber:index+1});
  pdf.save('weiqi-'+id+'-'+language+'.pdf');
}
