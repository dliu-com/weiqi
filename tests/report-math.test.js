import test from 'node:test';
import assert from 'node:assert/strict';
import {texToMathML} from '../src/report-math.js';

test('report formulas become MathML with scripts, limits, fractions and escaped text',()=>{
 assert.equal(texToMathML('L_i = \\max(0, s_i(S^*_i - S_i))'),'<math><mrow><msub><mi>L</mi><mi>i</mi></msub><mo>=</mo><mi mathvariant="normal">max</mi><mo stretchy="false">(</mo><mn>0</mn><mo>,</mo><msub><mi>s</mi><mi>i</mi></msub><mo stretchy="false">(</mo><msubsup><mi>S</mi><mi>i</mi><mo>*</mo></msubsup><mo>−</mo><msub><mi>S</mi><mi>i</mi></msub><mo stretchy="false">)</mo><mo stretchy="false">)</mo></mrow></math>');
 assert.equal(texToMathML('\\sum_{k=1}^{5} x',{display:true}),'<math display="block"><mrow><munderover><mo movablelimits="false">∑</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mn>5</mn></munderover><mi>x</mi></mrow></math>');
 assert.equal(texToMathML('\\frac{1}{N}'),'<math><mfrac><mn>1</mn><mi>N</mi></mfrac></math>');
 assert.equal(texToMathML('\\bar L \\quad \\text{a < b & c}'),'<math><mrow><mrow class="report-math-bar"><mi>L</mi></mrow><mspace width="1em"/><mtext>a &lt; b &amp; c</mtext></mrow></math>');
 assert.equal(texToMathML('\\{ i : 0.9 \\}'),'<math><mrow><mo stretchy="false">{</mo><mi>i</mi><mo>:</mo><mn>0.9</mn><mo stretchy="false">}</mo></mrow></math>');
 assert.equal(texToMathML('\\text{when }m'),'<math><mrow><mtext>when </mtext><mi>m</mi></mrow></math>');
 assert.equal(texToMathML('\\max_{t} y'),'<math><mrow><munder><mi mathvariant="normal">max</mi><mi>t</mi></munder><mi>y</mi></mrow></math>');
 assert.equal(texToMathML("S'_i"),'<math><msubsup><mi>S</mi><mi>i</mi><mo>′</mo></msubsup></math>');
});
test('malformed report formulas fail loudly',()=>{
 for(const bad of ['x_','{x','x}','\\unknown','x_1_2','\\frac{1}'])assert.throws(()=>texToMathML(bad),/Formula/);
});
