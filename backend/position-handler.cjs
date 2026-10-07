// Called only behind the site's IAM-protected CloudFront origin.
const {LambdaClient:PositionLambdaClient,InvokeCommand:PositionInvokeCommand}=require('@aws-sdk/client-lambda');
const {UpdateItemCommand:PositionUpdateItemCommand}=require('@aws-sdk/client-dynamodb');
const {createHash:positionHash}=require('node:crypto');
const positionLambda=new PositionLambdaClient({});
const positionReply=(code,message)=>response(code,{message});
async function positionHandler(event){
 const route=event.rawPath,kind=route==='/api/position/recognize'?'recognize':route==='/api/position/analyze'?'analyze':null;
 if(!kind||event.requestContext?.http?.method!=='POST')return positionReply(404,'Unknown position service.');
 if(!process.env.POSITION_USAGE_TABLE)return positionReply(503,'Position analysis is not configured.');
 let request;try{if(event.isBase64Encoded||!event.body||event.body.length>1500000)throw Error();request=JSON.parse(event.body);if(!/^[a-f0-9-]{36}$/.test(request.requestId||''))throw Error();
  if(kind==='recognize'){if(typeof request.image!=='string'||request.image.length>1467000||!request.image.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(request.image))throw Error();}
  else{if(typeof request.initialBoard!=='string'||!/^[.BW]{361}$/.test(request.initialBoard)||!['B','W'].includes(request.side)||!['B','W'].includes(request.initialSide)||!['japanese','chinese','korean','aga'].includes(request.rules)||!Number.isFinite(request.komi)||Math.abs(request.komi)>100||!Array.isArray(request.moves)||request.moves.length>512)throw Error();let side=request.initialSide;for(const m of request.moves){if(m.side!==side||m.index!==null&&(!Number.isInteger(m.index)||m.index<0||m.index>360))throw Error();side=side==='B'?'W':'B';}if(request.moves.length&&side!==request.side)throw Error();}
 }catch{return positionReply(400,'Invalid photo or position.');}
 try{if(await libraryStore.analysisPaused())return positionReply(503,'AI is paused by the project spending safeguard.');}catch{return positionReply(503,'The spending safeguard is unavailable. Retry later.');}
 const table=process.env.POSITION_USAGE_TABLE,now=Math.floor(Date.now()/1000),day=new Date().toISOString().slice(0,10),units=Number(process.env.POSITION_REQUEST_MICROS||3000),cap=Number(process.env.POSITION_DAILY_MICROS||3000000),hash=positionHash('sha256').update(JSON.stringify([kind,request])).digest('hex');
 try{await db.send(new TransactWriteItemsCommand({TransactItems:[{Put:{TableName:table,Item:{id:{S:'request#'+request.requestId},hash:{S:hash},expires:{N:String(now+86400)}},ConditionExpression:'attribute_not_exists(id)'}},{Update:{TableName:table,Key:{id:{S:'day#'+day}},UpdateExpression:'ADD reservedMicros :units SET expires = :expires',ConditionExpression:'attribute_not_exists(reservedMicros) OR reservedMicros <= :available',ExpressionAttributeValues:{':units':{N:String(units)},':available':{N:String(cap-units)},':expires':{N:String(now+172800)}}}}]}));}
 catch(e){if(e.name==='TransactionCanceledException')return positionReply(429,'This request was already used, or today’s public analysis allowance is exhausted.');console.error('Position usage safeguard:',e.name,e.message);return positionReply(503,'The usage safeguard is unavailable. Retry later.');}
 let slot;
 for(let i=0;i<2;i++)try{const key='lease#'+i;await db.send(new PositionUpdateItemCommand({TableName:table,Key:{id:{S:key}},UpdateExpression:'SET #owner = :owner, expires = :expires',ConditionExpression:'attribute_not_exists(expires) OR expires < :now',ExpressionAttributeNames:{'#owner':'owner'},ExpressionAttributeValues:{':owner':{S:request.requestId},':expires':{N:String(now+35)},':now':{N:String(now)}}}));slot=key;break;}catch(e){if(e.name!=='ConditionalCheckFailedException')return positionReply(503,'The concurrency safeguard is unavailable.');}
 if(!slot)return positionReply(429,'Two positions are being processed. Wait a few seconds and try again.');
 const started=Date.now();
 try{const o=await positionLambda.send(new PositionInvokeCommand({FunctionName:kind==='recognize'?process.env.POSITION_RECOGNIZER:process.env.POSITION_ENGINE,Payload:Buffer.from(JSON.stringify(request))}));const result=JSON.parse(Buffer.from(o.Payload).toString());if(o.FunctionError)return positionReply(422,kind==='recognize'?'Could not reliably detect the whole board. Try a closer photo with every grid edge visible.':'Could not analyse this position. Check the stones and next player.');return response(200,{...result,serverMs:Date.now()-started});}
 catch{return positionReply(503,'The position service could not finish. Try again shortly.');}
 finally{try{await db.send(new PositionUpdateItemCommand({TableName:table,Key:{id:{S:slot}},UpdateExpression:'SET expires = :zero',ConditionExpression:'#owner = :owner',ExpressionAttributeNames:{'#owner':'owner'},ExpressionAttributeValues:{':zero':{N:'0'},':owner':{S:request.requestId}}}));}catch{}}
}
