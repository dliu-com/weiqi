import test from 'node:test';
import assert from 'node:assert/strict';
import {reportPagination} from '../src/report-document.js';
test('contents pages reserve cover and contents and match every section destination',()=>{
 const titles=['Game summary','All move statistics','Black 1 · Move 107','White 1 · Move 184'],plan=reportPagination(titles);
 assert.equal(plan.pageCount,6);assert.deepEqual(plan.contents.map(e=>e.page),[3,4,5,6]);
 assert.deepEqual(plan.contents.map(e=>e.target),['report-page-3','report-page-4','report-page-5','report-page-6']);assert.deepEqual(plan.contents.map(e=>e.title),titles);
});
test('contents follow the actual available sections in either language',()=>{
 const english=reportPagination(Array.from({length:22},(_,n)=>'Section '+n)),chinese=reportPagination(['棋局概览','着法统计','黑方失误']);
 assert.equal(english.pageCount,24);assert.equal(english.contents.at(-1).page,24);assert.equal(chinese.pageCount,5);assert.equal(chinese.contents.at(-1).page,5);assert.equal(chinese.contents[0].title,'棋局概览');
 assert.throws(()=>reportPagination(['']),/titles/);assert.throws(()=>reportPagination(null),/titles/);
});
