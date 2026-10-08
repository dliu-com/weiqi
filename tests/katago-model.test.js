import test from 'node:test';import assert from 'node:assert/strict';
import models from '../backend/katago-model.cjs';
const dir='https://media.katagotraining.org/uploaded/networks/models/kata1/';
const latest='kata1-tf3-b11c768-s12252M-d6398M.bin.gz',strongest='kata1-tf3-b11c768-s11003M-d5973M-7gres.bin.gz';
test('selects the strongest confidently-rated official network',async()=>{
 const m=await models.resolveAnalysisModel(async()=>`Latest network:</span> <a href="${dir+latest}">latest</a> Strongest confidently-rated network:</span> <a href="${dir+strongest}">strongest</a>`);
 assert.equal(m.name,strongest);assert.equal(m.key,'models/'+strongest);assert.equal(m.url,dir+strongest);
});
test('falls back to the latest official network when the strongest entry is missing',async()=>{
 const m=await models.resolveAnalysisModel(async()=>`Latest network:</span> <a href="${dir+latest}">latest</a>`);
 assert.equal(m.name,latest);assert.equal(m.url,dir+latest);
});
test('rejects changed markup and URLs outside the official model directory',async()=>{
 for(const html of ['Changed page',`Latest network:</span> <a href="https://example.com/model.bin.gz">latest</a> Strongest confidently-rated network:</span> <a href="https://example.com/s.bin.gz">s</a>`])await assert.rejects(models.resolveAnalysisModel(async()=>html),/could not be identified/);
});
test('does not silently fall back to a stale model when the lookup fails',async()=>{
 await assert.rejects(models.resolveAnalysisModel(async()=>{throw Error('Offline');}),/Offline/);
});
