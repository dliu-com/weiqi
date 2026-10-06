import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,mkdtemp} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {recordIndexKey} from '../backend/library-service.js';
const execute=promisify(execFile),bucket=process.argv[2],region='eu-west-1';
if(!bucket)throw Error('Provide the record-library bucket name.');
const directory=await mkdtemp('/private/tmp/weiqi-library-index-');
const list=JSON.parse((await execute('aws',['s3api','list-objects-v2','--bucket',bucket,'--prefix','games/','--region',region],{maxBuffer:4*1024*1024})).stdout);
let count=0;
for(const item of list.Contents||[]){
 if(!item.Key.endsWith('/metadata.json'))continue;
 const metadata=JSON.parse((await execute('aws',['s3','cp','s3://'+bucket+'/'+item.Key,'-','--region',region,'--only-show-errors'])).stdout);
 const filename=directory+'/'+randomUUID();await writeFile(filename,JSON.stringify({id:metadata.id,uploadedAt:metadata.uploadedAt}));
 await execute('aws',['s3api','put-object','--bucket',bucket,'--key',recordIndexKey(metadata),'--body',filename,'--content-type','application/json','--region',region]);count++;
}
console.log('Indexed '+count+' existing game records; original files preserved.');
