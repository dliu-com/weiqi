// Uses the S3 SDK installed for the report renderer; no new infrastructure.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {gamePrefix} from '../backend/library-service.js';
const require=createRequire(new URL('../backend/report-renderer/package.json',import.meta.url));
const {S3Client,ListObjectsV2Command,GetObjectCommand,CopyObjectCommand,DeleteObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const [phase,bucket,manifestFile,siteBucket]=process.argv.slice(2);
if(!['copy','finish'].includes(phase)||!bucket||!manifestFile)throw Error('Use copy|finish BUCKET MANIFEST_FILE.');
const client=new S3Client({region:'eu-west-1'});
const get=async(Bucket,Key)=>{const object=await client.send(new GetObjectCommand({Bucket,Key}));return {body:Buffer.from(await object.Body.transformToByteArray()),etag:object.ETag};};
const hash=body=>createHash('sha256').update(body).digest('hex');
async function parallel(items,run){let position=0,completed=0;await Promise.all(Array.from({length:4},async()=>{while(position<items.length){const item=items[position++];await run(item);if(++completed%20===0||completed===items.length)console.log(`${phase}: ${completed}/${items.length} objects`);}}));}
if(phase==='copy'){
 const keys=[];let token;
 do{const page=await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:'games/',ContinuationToken:token}));keys.push(...(page.Contents||[]).map(item=>item.Key));token=page.NextContinuationToken;}while(token);
 const records=keys.map(oldKey=>{const match=/^games\/(\d{10,14})\/(.+)$/.exec(oldKey);return match?{oldKey,newKey:gamePrefix(match[1])+'/'+match[2],id:match[1]}:null;}).filter(Boolean);
 await parallel(records,async item=>{
  const original=await get(bucket,item.oldKey);item.sha256=hash(original.body);item.oldETag=original.etag;item.size=original.body.length;
  let existing;try{existing=await get(bucket,item.newKey);}catch(error){if(error.name!=='NoSuchKey')throw error;}
  if(existing){if(hash(existing.body)!==item.sha256)throw Error('Destination differs; refusing overwrite: '+item.newKey);}
  else await client.send(new CopyObjectCommand({Bucket:bucket,Key:item.newKey,CopySource:bucket+'/'+item.oldKey,CopySourceIfMatch:item.oldETag,MetadataDirective:'COPY'}));
  if(hash((await get(bucket,item.newKey)).body)!==item.sha256)throw Error('Verification failed: '+item.newKey);
 });
 await writeFile(manifestFile,JSON.stringify({bucket,region:'eu-west-1',createdAt:new Date().toISOString(),records},null,2));
 console.log(JSON.stringify({phase,verifiedObjects:records.length,games:new Set(records.map(item=>item.id)).size,manifestFile}));
}else{
 const manifest=JSON.parse(await readFile(manifestFile));if(manifest.bucket!==bucket||manifest.region!=='eu-west-1')throw Error('Manifest does not match migration.');
 // Validate every copy again before removing any old key. Abort if a source
 // changed while the application was being deployed.
 await parallel(manifest.records,async item=>{
  if(hash((await get(bucket,item.newKey)).body)!==item.sha256)throw Error('Destination changed: '+item.newKey);
  let original;try{original=await get(bucket,item.oldKey);}catch(error){if(error.name==='NoSuchKey'){item.alreadyRemoved=true;return;}throw error;}
  if(hash(original.body)!==item.sha256||original.etag!==item.oldETag)throw Error('Source changed: '+item.oldKey);
 });
 await parallel(manifest.records.filter(item=>!item.alreadyRemoved),item=>client.send(new DeleteObjectCommand({Bucket:bucket,Key:item.oldKey,IfMatch:item.oldETag})));
 let reportsUpdated=0;
 if(siteBucket)for(const id of new Set(manifest.records.map(item=>item.id))){
  const key='prepared-reports/'+id+'/index.json';let current;
  try{current=await get(siteBucket,key);}catch(error){if(error.name==='NoSuchKey')continue;throw error;}
  const index=JSON.parse(current.body),match=/^games\/(\d{10,14})\/(.+)$/.exec(index.sourceReportKey||'');
  if(!match)continue;index.sourceReportKey=gamePrefix(match[1])+'/'+match[2];
  await client.send(new PutObjectCommand({Bucket:siteBucket,Key:key,Body:JSON.stringify(index),ContentType:'application/json',CacheControl:'no-cache',IfMatch:current.etag}));reportsUpdated++;
 }
 console.log(JSON.stringify({phase,removedOldObjects:manifest.records.length,reportsUpdated}));
}
