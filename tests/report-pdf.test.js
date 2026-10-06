import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {finishPdf} from '../backend/report-renderer/finish-pdf.mjs';
const require=createRequire(new URL('../backend/report-renderer/index.mjs',import.meta.url));
const {PDFDocument,PDFName}=require('pdf-lib');
test('PDF contents links target actual pages and preserve external game links',async()=>{
 const pdf=await PDFDocument.create(),first=pdf.addPage(),second=pdf.addPage();
 const link=uri=>pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[0,0,10,10],A:{S:'URI',URI:uri}}));
 first.node.set(PDFName.of('Annots'),pdf.context.obj([link('https://weiqi.dliu.com/record/2026100620/report?lang=en#report-page-2'),link('https://weiqi.dliu.com/record/2026100620')]));
 const original=await pdf.save(),saved=await finishPdf(original,{id:'2026100620',language:'en',pageCount:2}),r=await PDFDocument.load(saved);
 const annotations=r.getPage(0).node.Annots().asArray().map(ref=>r.context.lookup(ref));
 assert.equal(annotations[0].has(PDFName.of('A')),false);
 assert.equal(annotations[0].lookup(PDFName.of('Dest')).get(0).toString(),r.getPage(1).ref.toString());
 assert.equal(annotations[1].lookup(PDFName.of('A')).lookup(PDFName.of('URI')).decodeText(),'https://weiqi.dliu.com/record/2026100620');
 assert.equal(r.getTitle(),'Weiqi AI report 2026100620 (en)');
 await assert.rejects(finishPdf(original,{id:'2026100620',language:'en',pageCount:3}),/pagination/);
});
