const {S3Client,GetObjectCommand,PutObjectCommand,ListObjectsV2Command} = require('@aws-sdk/client-s3');
const {SQSClient,SendMessageCommand} = require('@aws-sdk/client-sqs');
const {createHash:reportHash}=require('node:crypto');
const libraryS3 = new S3Client({}), libraryQueue = new SQSClient({});
const libraryStore = {
  async analysisPaused() {if(!process.env.AI_CONTROL_KEY)return false;try{return JSON.parse(await this.get(process.env.AI_CONTROL_KEY)).paused===true;}catch(e){if(e.name==='NoSuchKey')return false;throw e;}},
  async get(key) {const value=await libraryS3.send(new GetObjectCommand({Bucket:process.env.LIBRARY_BUCKET,Key:key}));return value.Body.transformToString();},
  async create(key,body,type) {try {await libraryS3.send(new PutObjectCommand({Bucket:process.env.LIBRARY_BUCKET,Key:key,Body:body,ContentType:type,IfNoneMatch:'*'}));return true;}catch(e){if(e.$metadata?.httpStatusCode===412)return false;throw e;}}
};
// Versioned reports are prepared by the Batch completion event. The same cache
// path is read-only on user requests; only completion events create reports.
async function storedAiReport(id,prepare=false) {
  const prefix=gamePrefix(id)+'/',metadata=JSON.parse(await libraryStore.get(prefix+'metadata.json'));
  if(metadata.analysis.available==='quick'||metadata.analysis.status!=='ready')throw Object.assign(Error('The report will be available when deep analysis finishes. Refresh the game page to check.'),{statusCode:409});
  const analysis=JSON.parse(await libraryStore.get(prefix+'analysis.json'));
  const hash=reportHash('sha256').update(JSON.stringify([REPORT_SCHEMA_VERSION,analysis.sgfSha256,analysis.modelSha256,analysis.visits,analysis.completedAt])).digest('hex'),key=prefix+'reports/'+hash+'.json';
  try{return {report:JSON.parse(await libraryStore.get(key)),key};}catch(e){if(e.name!=='NoSuchKey')throw e;}
  if(!prepare)throw Object.assign(Error('The report is being prepared in the background. Please refresh later.'),{statusCode:409});
  const source=await libraryStore.get(prefix+'original.sgf');
  if(reportHash('sha256').update(source).digest('hex')!==analysis.sgfSha256)throw Object.assign(Error('Analysis does not match the saved SGF.'),{statusCode:409});
  const report=buildAiReport(source,analysis,metadata);await libraryStore.create(key,JSON.stringify(report),'application/json');
  return {report:JSON.parse(await libraryStore.get(key)),key};
}
async function completedAnalysisReport(job) {
  const match=/^weiqi-(\d{10,14})-a\d+-[a-f0-9]{8}$/.exec(job.jobName||'');
  if(job.status!=='SUCCEEDED'||!match)return {ignored:true};
  const id=match[1],metadata=JSON.parse(await libraryStore.get(gamePrefix(id)+'/metadata.json'));
  if(metadata.analysis.status!=='ready'||metadata.analysis.deep?.status!=='ready'||metadata.analysis.deep.jobId!==job.jobId)return {ignored:true};
  const saved=await storedAiReport(id,true);
  if(process.env.REPORT_QUEUE){await libraryQueue.send(new SendMessageCommand({QueueUrl:process.env.REPORT_QUEUE,MessageGroupId:'reports',MessageDeduplicationId:reportHash('sha256').update(saved.key+'|'+job.jobId).digest('hex'),MessageBody:JSON.stringify({id,reportKey:saved.key,jobId:job.jobId})}));}
  return {id,reportDataReady:true,reportFilesScheduled:Boolean(process.env.REPORT_QUEUE)};
}
async function libraryHandler(event) {
  const method=event.requestContext?.http?.method, path=event.rawPath, id=path.slice('/api/library/'.length);
  try {
    if (!process.env.LIBRARY_BUCKET) return response(503,{message:'Record library is not configured.'});
    if (method==='GET' && path==='/api/library') {
      const cursor=event.queryStringParameters?.cursor;
      if (cursor && cursor.length>2048) return response(400,{message:'Invalid page cursor.'});
      const list=await libraryS3.send(new ListObjectsV2Command({Bucket:process.env.LIBRARY_BUCKET,Prefix:'library-index/',MaxKeys:10,...(cursor?{ContinuationToken:cursor}:{})}));
      const games=await Promise.all((list.Contents || []).map(async p=>{try{const entry=JSON.parse(await libraryStore.get(p.Key));if(!validRecordId(entry.id))return null;return JSON.parse(await libraryStore.get(gamePrefix(entry.id)+'/metadata.json'));}catch(e){if(e.name==='NoSuchKey')return null;throw e;}}));
      const paused=await libraryStore.analysisPaused();
      if(paused)for(const g of games.filter(Boolean))if(!['ready','limited'].includes(g.analysis?.status))g.analysis={...g.analysis,status:'paused',reason:'monthly_budget'};
      return response(200,{games:games.filter(Boolean),cursor:list.NextContinuationToken || null});
    }
    const reportId=path.match(/^\/api\/library\/([^/]+)\/report$/)?.[1];
    if(method==='GET'&&validRecordId(reportId||'')){
      return response(200,(await storedAiReport(reportId)).report);
    }
    if (method==='GET' && validRecordId(id)) {
      const prefix=gamePrefix(id)+'/', metadata=JSON.parse(await libraryStore.get(prefix+'metadata.json'));
      const sgf=await libraryStore.get(prefix+'original.sgf'); let analysis=null;
      if(metadata.analysis.status==='ready'||metadata.analysis.available) analysis=JSON.parse(await libraryStore.get(prefix+(metadata.analysis.available==='quick'?'analysis-quick.json':'analysis.json')));
      await attachQueueStatus(metadata);
      if(!['ready','limited','paused'].includes(metadata.analysis.status)&&await libraryStore.analysisPaused())metadata.analysis={...metadata.analysis,status:'paused',reason:'monthly_budget',quick:metadata.analysis.quick?.status==='ready'?metadata.analysis.quick:undefined,deep:undefined};
      return response(200,{metadata,sgf,analysis});
    }
    if (method!=='POST' || path!=='/api/library') return response(404,{message:'Record not found.'});
    if(event.headers?.origin && event.headers.origin!==process.env.SITE_ORIGIN)return response(403,{message:'Invalid request origin.'});
    if(!event.headers?.['content-type']?.startsWith('application/json'))return response(415,{message:'Use JSON.'});
    const raw=event.isBase64Encoded?Buffer.from(event.body || '', 'base64').toString('utf8'):event.body || '';
    if(Buffer.byteLength(raw)>1600000)return response(413,{message:'Upload too large.'});
    let request;try{request=JSON.parse(raw);}catch{return response(400,{message:'Invalid upload request.'});}
    const metadata=await uploadRecord(libraryStore,request.sgf,request.filename,request.id);
    await enqueueSavedRecord(metadata);
    return response(200,{id:metadata.id});
  } catch(e) {
    if(e.name==='NoSuchKey')return response(404,{message:'Record not found.'});
    if(e.statusCode)return response(e.statusCode,{message:e.message});
    console.error('Library request failed',{name:e.name});return response(500,{message:'The library is unavailable. Please retry.'});
  }
}

async function enqueueSavedRecord(metadata) {
    if(await libraryStore.analysisPaused())return;
    // Only eligible uploads enqueue the quick and deep cloud analyses.
    // Duplicate deliveries are safe: workers reuse complete results and claim jobs.
    if(process.env.ANALYSIS_QUEUE && metadata.analysis.status==='queued') {
      const key=gamePrefix(metadata.id)+'/metadata.json';
      for(let n=0;n<6;n++){
        const obj=await libraryS3.send(new GetObjectCommand({Bucket:process.env.LIBRARY_BUCKET,Key:key})),current=JSON.parse(await obj.Body.transformToString());
        if(current.analysis.enqueuedAt)break;
        current.analysis.enqueuedAt=new Date().toISOString();
        try{await libraryS3.send(new PutObjectCommand({Bucket:process.env.LIBRARY_BUCKET,Key:key,Body:JSON.stringify(current),ContentType:'application/json',IfMatch:obj.ETag}));break;}catch(e){if(![409,412].includes(e.$metadata?.httpStatusCode)||n===5)throw e;}
      }
      await libraryQueue.send(new SendMessageCommand({QueueUrl:process.env.ANALYSIS_QUEUE,MessageBody:JSON.stringify({id:metadata.id})}));
    }
}
