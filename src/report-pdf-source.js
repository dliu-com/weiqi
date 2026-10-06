import html2canvas from 'html2canvas';
import {jsPDF} from 'jspdf';

// A single fixed A4 preset. The language is the version currently being viewed.
// Render one sheet at a time to bound memory on mobile devices. Fonts and SVG
// diagrams use the browser's existing rendering, including Chinese characters.
export async function saveReportPdf(sheets,id,language,progress=()=>{}) {
  if(!sheets.length||!['en','zh'].includes(language))throw Error('Report unavailable');
  await document.fonts.ready;
  const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  pdf.setProperties({title:'Weiqi AI report '+id+' ('+language+')',author:'weiqi.dliu.com'});
  for(const [index,sheet] of sheets.entries()){
    const canvas=await html2canvas(sheet,{
      scale:2,backgroundColor:'#ffffff',logging:false,windowWidth:1200,windowHeight:1600,scrollX:0,scrollY:0,
      onclone:doc=>{
        const style=doc.createElement('style');
        style.textContent='.report-sheet{width:794px!important;min-height:1123px!important;margin:0!important;padding:45px!important;box-shadow:none!important;background:white!important}.diagram-pair{grid-template-columns:1fr 1fr!important}.report-table{font-size:12px!important}.report-table td,.report-table th{padding:8px!important}.report-tools,#report-status{display:none!important}';
        doc.head.append(style);
      },
    });
    if(index)pdf.addPage();
    const ratio=Math.min(210/canvas.width,297/canvas.height),width=canvas.width*ratio,height=canvas.height*ratio;
    pdf.addImage(canvas,'PNG',(210-width)/2,0,width,height,undefined,'FAST');
    canvas.width=0;canvas.height=0;
    progress(index+1,sheets.length);
  }
  pdf.save('weiqi-'+id+'-'+language+'.pdf');
}
