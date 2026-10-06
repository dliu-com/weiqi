import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonLayout,compositionLayout} from '../src/report-stat-charts.js';
test('comparison bars share a zero origin and preserve missing values separately from zero',()=>{
 const chart=comparisonLayout([{label:'Mean',values:[0,null]},{label:'90th',values:[1.5,2.4]}]);
 assert.equal(chart.extent,5);assert.deepEqual(chart.rows[0].fractions,[0,null]);assert.deepEqual(chart.rows[1].fractions,[.3,.48]);
 const rates=comparisonLayout([{values:[25,75]}],100);assert.deepEqual(rates.rows[0].fractions,[.25,.75]);assert.equal(comparisonLayout([{values:[NaN,undefined]}]).extent,1);
 assert.throws(()=>comparisonLayout([],0),/positive/);
});
test('quality composition uses each group denominator and cumulative non-overlapping segments',()=>{
 const groups=compositionLayout([{label:'Black',counts:{best:3,good:1}},{label:'White',counts:{best:1,good:1}},{label:'Empty',counts:{best:0,good:0}}],['best','good']);
 assert.equal(groups[0].total,4);assert.equal(groups[1].total,2);assert.deepEqual(groups[0].segments.map(s=>[s.offset,s.fraction]),[[0,.75],[.75,.25]]);assert.deepEqual(groups[1].segments.map(s=>s.fraction),[.5,.5]);assert.equal(groups[2].segments[0].fraction,0);
 assert.ok(groups.slice(0,2).every(g=>g.segments.reduce((n,s)=>n+s.fraction,0)===1));
});
