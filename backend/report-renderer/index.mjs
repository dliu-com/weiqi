import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {readFile} from 'node:fs/promises';
import {prepareReportFiles,reportEvents} from './report-job.mjs';
import {renderReports} from './render.mjs';
const s3=new S3Client({});
const store={
 async json(Bucket,Key){try{const result=await s3.send(new GetObjectCommand({Bucket,Key}));return JSON.parse(await result.Body.transformToString());}catch(e){if(e.name==='NoSuchKey')return null;throw e;}},
 async put(Bucket,Key,Body,ContentType,immutable,ContentDisposition){await s3.send(new PutObjectCommand({Bucket,Key,Body,ContentType,CacheControl:immutable?'public, max-age=31536000, immutable':'no-store',...(ContentDisposition?{ContentDisposition}:{})}));},
};
export async function handler(event){
 const {version}=JSON.parse(await readFile(new URL('./version.json',import.meta.url)));
 const results=[];
 for(const request of reportEvents(event))results.push(await prepareReportFiles(request,{store,render:renderReports,version,libraryBucket:process.env.LIBRARY_BUCKET,siteBucket:process.env.SITE_BUCKET}));
 return {processed:results.length,results};
}
