import {PDFDocument,PDFName} from 'pdf-lib';
export async function finishPdf(bytes,{id,language,pageCount}){
 const pdf=await PDFDocument.load(bytes),pages=pdf.getPages();
 if(pages.length!==pageCount)throw Error('PDF pagination does not match the report contents.');
 for(const page of pages){
  const annotations=page.node.Annots();if(!annotations)continue;
  for(const ref of annotations.asArray()){
   const annotation=pdf.context.lookup(ref),action=annotation.lookup(PDFName.of('A'));
   const uri=action?.lookup(PDFName.of('URI'))?.decodeText?.();if(!uri)continue;
   let url;try{url=new URL(uri);}catch{continue;}
   const match=/^#report-page-(\d+)$/.exec(url.hash);
   if(url.origin!=='https://weiqi.dliu.com'||url.pathname!=='/record/'+id+'/report'||!match)continue;
   const target=Number(match[1]);if(target<1||target>pages.length)throw Error('Invalid PDF contents destination.');
   annotation.delete(PDFName.of('A'));
   annotation.set(PDFName.of('Dest'),pdf.context.obj([pages[target-1].ref,PDFName.of('Fit')]));
  }
 }
 pdf.setTitle('Weiqi AI report '+id+' ('+language+')');pdf.setAuthor('weiqi.dliu.com');
 pdf.setSubject('Game trends, five errors per player and three detailed board reviews each');pdf.setLanguage(language==='zh'?'zh-CN':'en');
 return Buffer.from(await pdf.save());
}
