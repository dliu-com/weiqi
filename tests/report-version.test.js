import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {REPORT_VERSION,REPORT_LOGIC_FINGERPRINT} from '../src/report-version.js';

// Files that decide report content or layout. Changing any of them needs a new report version.
const REPORT_LOGIC_FILES=['src/report-data.js','src/report-insights.js','src/report-highlights.js','src/report-render.js','src/report-stat-charts.js','src/report-game-record.js','src/report-document.js','src/board-diagram.js','src/report.css','backend/report-renderer/render.mjs','backend/report-renderer/render.html','backend/report-renderer/finish-pdf.mjs'];

test('report version has a positive number and an ISO date',()=>{
 assert.ok(Number.isInteger(REPORT_VERSION.number)&&REPORT_VERSION.number>0);
 assert.match(REPORT_VERSION.date,/^\d{4}-\d{2}-\d{2}$/);
});
test('report version changes with the report logic',async()=>{
 const hash=createHash('sha256');
 for(const file of REPORT_LOGIC_FILES)hash.update(file+'\0').update((await readFile(new URL('../'+file,import.meta.url),'utf8')).replace(/\r\n/g,'\n')+'\0');
 const fingerprint=hash.digest('hex').slice(0,16);
 assert.equal(REPORT_LOGIC_FINGERPRINT,fingerprint,'Report logic changed: increase REPORT_VERSION.number, set REPORT_VERSION.date to today and set REPORT_LOGIC_FINGERPRINT to '+fingerprint+' in src/report-version.js.');
});
