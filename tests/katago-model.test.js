import test from 'node:test';import assert from 'node:assert/strict';
import models from '../backend/katago-model.cjs';
test('uses the pinned official network with its SHA-256, without checking the website',async()=>{
 const name='kata1-tf3-b11c768-s11003M-d5973M-7gres.bin.gz',m=await models.resolveAnalysisModel();
 assert.equal(m.name,name);assert.equal(m.key,'models/'+name);
 assert.equal(m.url,'https://media.katagotraining.org/uploaded/networks/models/kata1/'+name);
 assert.match(m.sha256,/^[0-9a-f]{64}$/);
});
