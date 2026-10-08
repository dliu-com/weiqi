// Shared by the API handler and position handler; the CDK stack concatenates it before both.
const {UpdateItemCommand:ClientUpdateItemCommand}=require('@aws-sdk/client-dynamodb');
const {createHash:clientHash}=require('node:crypto');
// CloudFront stamps x-weiqi-viewer from the real connection. Only a hashed bucket of the network is stored and rows expire by TTL.
function clientBucket(event){
 const ip=String(event.headers?.['x-weiqi-viewer']||'').trim().toLowerCase();if(!ip)return null;let network=ip;
 if(ip.includes(':')){const [head,tail]=ip.split('::'),a=head?head.split(':'):[],b=tail?tail.split(':'):[],full=tail===undefined?a:[...a,...Array(Math.max(0,8-a.length-b.length)).fill('0'),...b];network=full.slice(0,4).map(h=>parseInt(h||'0',16).toString(16)).join(':');}
 return clientHash('sha256').update(network).digest().readUInt32BE(0)%4096;
}
async function clientAllowance(event,scope,period,limit,seconds){
 const bucket=clientBucket(event);if(bucket===null||!process.env.POSITION_USAGE_TABLE||!(limit>0))return true;
 try{await db.send(new ClientUpdateItemCommand({TableName:process.env.POSITION_USAGE_TABLE,Key:{id:{S:'client#'+scope+'#'+period+'#'+bucket}},UpdateExpression:'ADD used :one SET expires = :expires',ConditionExpression:'attribute_not_exists(used) OR used < :limit',ExpressionAttributeValues:{':one':{N:'1'},':limit':{N:String(limit)},':expires':{N:String(Math.floor(Date.now()/1000)+seconds)}}}));return true;}
 catch(e){if(e.name==='ConditionalCheckFailedException')return false;throw e;}
}
