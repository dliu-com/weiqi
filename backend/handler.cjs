// The CDK stack prepends the shared engine and game-service code to this handler.
const { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand, TransactWriteItemsCommand } = require('@aws-sdk/client-dynamodb');
const db = new DynamoDBClient({});
const response = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  body: JSON.stringify(body),
});
async function readGame(key = 'current') {
  const data = await db.send(new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: { gameId: { S: key } },
    ConsistentRead: true,
  }));
  if (data.Item) return JSON.parse(data.Item.state.S);
  if (key !== 'current') throw new GameError('页面不存在。', 404);
  return createState();
}
exports.handler = async event => {
  if(event.source==='aws.batch'&&event['detail-type']==='Batch Job State Change')return completedAnalysisReport(event.detail||{});
  const method = event.requestContext?.http?.method;
  const requestPath = event.rawPath || '';
  if(method==='POST'){const headers=event.headers||{};if(headers.origin&&headers.origin!==process.env.SITE_ORIGIN)return response(403,{message:'Invalid request origin.'});if(!headers['content-type']?.toLowerCase().startsWith('application/json'))return response(415,{message:'Use JSON.'});}
  if(requestPath.startsWith('/api/position/'))return positionHandler(event);
  if(method==='POST'&&!event._retry){try{const minute=Math.floor(Date.now()/60000);if(!(await clientAllowance(event,'edit',minute,Number(process.env.CLIENT_EDITS_PER_MINUTE||60),120)))return response(429,{message:'Too many edits from this connection. Please wait one minute and retry.'});if(!(await usageAllowance('site#edit#'+minute,Number(process.env.SITE_EDITS_PER_MINUTE||120),120)))return response(429,{message:'Too many edits. Please wait one minute and retry.'});}catch{return response(503,{message:'The service is busy. Please retry.'});}}
  if(requestPath==='/api/draft')return draftHandler(event);
  if (requestPath === '/api/library' || requestPath.startsWith('/api/library/')) return libraryHandler(event);
  const archiveId = requestPath.startsWith('/api/games/') ? requestPath.slice('/api/games/'.length) : null;
  const key = archiveId ? 'archive#' + archiveId : 'current';
  if (requestPath !== '/api/game' && requestPath !== '/api/games' && !archiveId) return response(404, { message: '页面不存在。' });
  try {
    if (method === 'GET' && requestPath === '/api/games') {
      const cursor = event.queryStringParameters?.cursor;
      if (cursor && (!cursor.startsWith('archive#') && cursor !== 'current')) throw new GameError('请求格式无效。');
      const data = await db.send(new ScanCommand({
        TableName: process.env.TABLE_NAME, Limit: 50, ConsistentRead: true,
        ProjectionExpression: 'gameId, gameName, createdAt, updatedAt',
        ...(cursor ? { ExclusiveStartKey: { gameId: { S: cursor } } } : {}),
      }));
      return response(200, { games: (data.Items || []).filter(i => i.gameId.S.startsWith('archive#')).map(i => ({
        id: i.gameId.S.slice(8), gameName: i.gameName?.S || null, createdAt: i.createdAt?.S, updatedAt: i.updatedAt?.S
      })), cursor: data.LastEvaluatedKey?.gameId.S || null });
    }
    if (method === 'GET') {let state=await readGame(key);if(!archiveId&&state.phase==='ended')state=await publishLiveGame(state);return response(200,{state});}
    if (requestPath === '/api/games') return response(405, { message: '不支持此请求方法。' });
    if (method !== 'POST') return response(405, { message: '不支持此请求方法。' });
    const headers = event.headers || {};
    if (headers.origin && headers.origin !== process.env.SITE_ORIGIN) return response(403, { message: '请求来源无效。' });
    if (!headers['content-type']?.toLowerCase().startsWith('application/json')) return response(415, { message: '请使用 JSON 格式。' });
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
    if (Buffer.byteLength(raw) > 2048) return response(413, { message: '请求过大。' });
    let request;
    try { request = JSON.parse(raw); } catch { return response(400, { message: '请求格式无效。' }); }
    if (archiveId) throw new GameError('当前棋局不能执行此操作。');
    const current = await readGame(key);
    if (current.phase === 'ended') return response(200, { state: await publishLiveGame(current) });
    if (request.action?.type === 'heartbeat' && (current.phase !== 'play' || current.clock?.paused || current.clock?.since === null)) return response(200, { state: current });
    const next = transition(current, request);
    const item = (id, state) => ({
      gameId: { S: id }, revision: { N: String(state.revision) }, clockVersion: { N: String(state.clockVersion || 0) }, state: { S: JSON.stringify(state) },
      gameName: { S: state.gameName || '' }, createdAt: { S: state.createdAt || state.updatedAt || next.updatedAt },
      updatedAt: { S: state.updatedAt || state.createdAt || new Date().toISOString() },
    });
    const save = {
      TableName: process.env.TABLE_NAME, Item: item(key, next),
      ConditionExpression: '(attribute_not_exists(#revision) OR #revision = :expected) AND (attribute_not_exists(#clockVersion) OR #clockVersion = :clockVersion)',
      ExpressionAttributeNames: { '#revision': 'revision', '#clockVersion': 'clockVersion' },
      ExpressionAttributeValues: { ':expected': { N: String(current.revision) }, ':clockVersion': { N: String(current.clockVersion || 0) } },
    };
    await db.send(new PutItemCommand(save));
    return response(200, { state: next.phase==='ended'&&!archiveId?await publishLiveGame(next):next });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException' || error.name === 'TransactionCanceledException' || error.statusCode === 409) {
      if (error.statusCode !== 409 && (event._retry || 0) < 3) return exports.handler({ ...event, _retry: (event._retry || 0) + 1 });
      return response(409, { message: '棋局已更新，已为你同步最新进度。', state: await readGame(key) });
    }
    if (error instanceof GameError) return response(error.statusCode, { message: error.message });
    console.error('Game API failed', { name: error.name, message: error.message });
    return response(500, { message: '棋局暂时无法同步，请稍后重试。' });
  }
};

// Save completed live games through the same idempotent library pipeline as uploads.
async function publishLiveGame(state){
 let libraryId=state.libraryId;
 if(!libraryId&&state.history.length>=MIN_LIBRARY_MOVES){
  const hash=reportHash('sha256').update('live|'+state.createdAt+'|'+(state.generation||0)).digest('hex');
  const uploadId=hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32);
  const source=mainRecordingSgf(sgf(state)),metadata=await uploadRecord(libraryStore,source,'live-game.sgf',uploadId);
  await enqueueSavedRecord(metadata);libraryId=metadata.id;
 }
 const fresh=freshLiveGame(state,libraryId);
 try{await db.send(new PutItemCommand({TableName:process.env.TABLE_NAME,Item:{gameId:{S:'current'},revision:{N:String(fresh.revision)},clockVersion:{N:'0'},state:{S:JSON.stringify(fresh)}},ConditionExpression:'#r = :r AND #c = :c',ExpressionAttributeNames:{'#r':'revision','#c':'clockVersion'},ExpressionAttributeValues:{':r':{N:String(state.revision)},':c':{N:String(state.clockVersion||0)}}}));}catch(e){if(e.name!=='ConditionalCheckFailedException')throw e;return readGame();}
 return fresh;
}
async function readDraft(){
 for(let attempt=0;attempt<3;attempt++){
  const obj=await db.send(new GetItemCommand({TableName:process.env.TABLE_NAME,Key:{gameId:{S:'record-draft'}},ConsistentRead:true})),current=obj.Item?JSON.parse(obj.Item.state.S):createDraft();
  // Clear already-published drafts left by the previous app version too.
  if(current.publication?.status!=='ready'||current.sgf===newRecordingSgf())return current;
  const fresh=freshSavedDraft(current,current.publication.gameId);
  try{await writeDraft(fresh,current.revision);return fresh;}catch(e){if(e.name!=='ConditionalCheckFailedException')throw e;}
 }
 throw Object.assign(Error('The public draft changed. Please retry.'),{statusCode:409});
}
async function writeDraft(next,expected){await db.send(new PutItemCommand({TableName:process.env.TABLE_NAME,Item:{gameId:{S:'record-draft'},revision:{N:String(next.revision)},state:{S:JSON.stringify(next)}},ConditionExpression:'attribute_not_exists(#r) OR #r = :r',ExpressionAttributeNames:{'#r':'revision'},ExpressionAttributeValues:{':r':{N:String(expected)}}}));}
async function draftHandler(event){
 try{
  const method=event.requestContext?.http?.method;if(method==='GET')return response(200,{draft:await readDraft()});if(method!=='POST')return response(405,{message:'Method not allowed.'});
  const headers=event.headers||{};if(headers.origin&&headers.origin!==process.env.SITE_ORIGIN)return response(403,{message:'Invalid request origin.'});if(!headers['content-type']?.toLowerCase().startsWith('application/json'))return response(415,{message:'Use JSON.'});
  const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):event.body||'';if(Buffer.byteLength(raw)>1600000)return response(413,{message:'Draft too large.'});let request;try{request=JSON.parse(raw);}catch{return response(400,{message:'Invalid draft request.'});}
  const current=await readDraft();
  if(request.action==='save'){
   let pending;
   if(current.publication?.id===request.id)pending=current;
   else {if(current.publication?.status==='pending')return response(409,{message:'Another save is still in progress. Reload the draft.'});pending=draftPublication(current,request);await writeDraft(pending,current.revision);}
   if(pending.publication.status==='ready')return response(200,{draft:pending,id:pending.publication.gameId});
   const metadata=await uploadRecord(libraryStore,pending.sgf,'recorded-game.sgf',pending.publication.id);await enqueueSavedRecord(metadata);
   const finished=freshSavedDraft(pending,metadata.id);await writeDraft(finished,pending.revision);return response(200,{draft:finished,id:metadata.id});
  }
  if(request.action!=='update')return response(400,{message:'Invalid draft action.'});
  const next=draftTransition(current,request);await writeDraft(next,current.revision);return response(200,{draft:next});
 }catch(e){if(e.name==='ConditionalCheckFailedException'||e.statusCode===409)return response(409,{message:'The public draft changed on another device. Reload it before editing.',draft:await readDraft()});if(e.statusCode)return response(e.statusCode,{message:e.message});console.error('Draft request failed',{name:e.name});return response(500,{message:'Unable to save the public draft. Please retry.'});}
}

