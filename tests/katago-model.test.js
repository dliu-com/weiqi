import test from 'node:test';import assert from 'node:assert/strict';
import models from '../backend/katago-model.cjs';
const latest='kata1-tf3-b11c768-s12252M-d6398M.bin.gz',url='https://media.katagotraining.org/uploaded/networks/models/kata1/'+latest;
test('selects the latest official network rather than an older highest-rated network',async()=>{
 const m=await models.resolveLatestModel(async()=>`Latest network:</span> <a href="${url}">latest</a> Strongest confidently-rated network: <a href="https://media.katagotraining.org/older.bin.gz">strongest</a>`);
 assert.equal(m.name,latest);assert.equal(m.key,'models/'+latest);assert.equal(m.url,url);
});
test('rejects changed markup and URLs outside the official model directory',async()=>{
 for(const html of ['Changed page',`Latest network:</span> <a href="https://example.com/model.bin.gz">latest</a>`])await assert.rejects(models.resolveLatestModel(async()=>html),/could not be identified/);
});
test('does not silently fall back to a stale model when the latest lookup fails',async()=>{
 await assert.rejects(models.resolveLatestModel(async()=>{throw Error('Offline');}),/Offline/);
});
