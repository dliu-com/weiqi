import test from 'node:test';import assert from 'node:assert/strict';import {gameResult} from '../src/game-result.js';
test('SGF result names the winner and distinguishes points, resignation and timeout',()=>{
 assert.equal(gameResult('W+8.5').en,'White won by 8.5 points');assert.equal(gameResult('W+8.5').winner,'W');
 for(const reason of ['Res','res','R','Resignation'])assert.equal(gameResult('B+'+reason).en,'Black won by resignation');
 assert.equal(gameResult('W+timeout').en,'White won on time');assert.equal(gameResult('0').en,'Draw');
 assert.equal(gameResult('Void').en,'Void');assert.equal(gameResult(''),null);
});
