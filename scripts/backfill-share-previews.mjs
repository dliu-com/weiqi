// Writes link-preview images and pages for games saved before previews existed.
// Usage: node scripts/backfill-share-previews.mjs LIBRARY_BUCKET SITE_BUCKET
import {createRequire} from 'node:module';
import {readSgf} from '../src/sgf.js';
const local=createRequire(import.meta.url),{shareFiles}=local('../backend/share-preview.cjs');
const require=createRequire(new URL('../backend/report-renderer/package.json',import.meta.url));
const {S3Client,ListObjectsV2Command,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const [libraryBucket,siteBucket]=process.argv.slice(2);
if(!libraryBucket||!siteBucket)throw Error('Use LIBRARY_BUCKET SITE_BUCKET.');
const client=new S3Client({region:'eu-west-1'});
const text=async Key=>(await (await client.send(new GetObjectCommand({Bucket:libraryBucket,Key}))).Body.transformToString());
const prefixes=[];let token;
do{const page=await client.send(new ListObjectsV2Command({Bucket:libraryBucket,Prefix:'games/',ContinuationToken:token}));prefixes.push(...(page.Contents||[]).map(item=>item.Key).filter(key=>key.endsWith('/metadata.json')).map(key=>key.slice(0,-'metadata.json'.length)));token=page.NextContinuationToken;}while(token);
let written=0,failed=0;
for(const prefix of prefixes){
 try{
  const metadata=JSON.parse(await text(prefix+'metadata.json'));
  for(const file of shareFiles(readSgf(await text(prefix+'original.sgf')),metadata))await client.send(new PutObjectCommand({Bucket:siteBucket,Key:file.key,Body:file.body,ContentType:file.type,CacheControl:'public, max-age=86400'}));
  written++;
 }catch(error){failed++;console.error(prefix,error.name,error.message);}
}
console.log(JSON.stringify({games:prefixes.length,written,failed}));
