import {createHash} from 'node:crypto';
export function reportEvents(event){return event?.Records?event.Records.map(record=>JSON.parse(record.body)):[event];}
export async function prepareReportFiles(event,{store,render,version,libraryBucket,siteBucket,now=()=>new Date().toISOString()}){
 const {id,reportKey,jobId}=event;
 if(!/^\d{10,14}$/.test(id||'')||!new RegExp('^games/'+id+'/reports/[a-f0-9]{64}\\.json$').test(reportKey||'')||!jobId)throw Error('Invalid report preparation request.');
 const current=async()=>{const metadata=await store.json(libraryBucket,'games/'+id+'/metadata.json');return metadata?.analysis?.deep?.status==='ready'&&metadata.analysis.deep.jobId===jobId;};
 if(!await current())return {ignored:true};
 const indexKey='prepared-reports/'+id+'/index.json',previous=await store.json(siteBucket,indexKey);
 if(previous?.status==='ready'&&previous.sourceReportKey===reportKey&&previous.renderVersion===version)return {id,alreadyPrepared:true};
 const report=await store.json(libraryBucket,reportKey);if(report?.id!==id)throw Error('Saved report does not match record.');
 const hash=createHash('sha256').update(reportKey+'|'+version).digest('hex'),prefix='prepared-reports/'+id+'/'+hash+'/',base={id,sourceReportKey:reportKey,renderVersion:version};
 await store.put(siteBucket,indexKey,JSON.stringify({...base,status:'preparing',startedAt:now()}),'application/json',false);
 try{
  const results=await render(report),languages={};
  for(const language of ['en','zh']){
   const output=results[language];if(!output?.pdf?.length||!output.html||output.pageCount<1)throw Error('Incomplete prepared report.');
   const pdfKey=prefix+language+'.pdf',htmlKey=prefix+language+'.html';
   await Promise.all([store.put(siteBucket,pdfKey,output.pdf,'application/pdf',true,'attachment; filename="weiqi-'+id+'-'+language+'.pdf"'),store.put(siteBucket,htmlKey,output.html,'text/html; charset=utf-8',true)]);
   languages[language]={pdf:'/'+pdfKey,html:'/'+htmlKey,pages:output.pageCount};
  }
  if(!await current())return {ignored:true};
  await store.put(siteBucket,indexKey,JSON.stringify({...base,status:'ready',generatedAt:now(),languages}),'application/json',false);
  return {id,prepared:true,languages};
 }catch(error){if(await current())await store.put(siteBucket,indexKey,JSON.stringify({...base,status:'failed',failedAt:now(),message:'Report preparation failed.'}),'application/json',false);throw error;}
}
