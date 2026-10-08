import test from 'node:test';import assert from 'node:assert/strict';
import vm from 'node:vm';import {readFileSync} from 'node:fs';import {inflateSync} from 'node:zlib';
import share from '../backend/share-preview.cjs';
import {readSgf} from '../src/sgf.js';
function pixels(png){
 assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 let i=8,idat=[],width=0;
 while(i<png.length){const n=png.readUInt32BE(i),type=png.toString('ascii',i+4,i+8);if(type==='IHDR')width=png.readUInt32BE(i+8);if(type==='IDAT')idat.push(png.subarray(i+8,i+8+n));i+=12+n;}
 const raw=inflateSync(Buffer.concat(idat));return {width,at:(x,y)=>[...raw.subarray(y*(width*3+1)+1+x*3,y*(width*3+1)+4+x*3)]};
}
test('share image shows the final position after captures',()=>{
 // White captures the black stone at A19 (aa); Black's last stone stays at T1.
 const record=readSgf('(;GM[1]SZ[19];B[aa];W[ba];B[ss];W[ab])'),files=share.shareFiles(record,{id:'2026100899',name:'Test',moves:4});
 assert.deepEqual(files.map(f=>[f.key,f.type]),[['share/2026100899.png','image/png'],['share/2026100899.html','text/html; charset=utf-8']]);
 const img=pixels(files[0].body),cell=img.width/19,center=n=>Math.floor(cell/2+n*cell);
 assert.equal(img.width,600);
 assert.ok(img.at(center(0)+6,center(0)+6)[0]>150,'captured corner is empty wood');
 assert.ok(img.at(center(1),center(0))[0]>235,'white stone');
 assert.ok(img.at(center(18),center(18))[0]<30,'black stone');
});
test('share page escapes SGF text and points previews at the game and final board',()=>{
 const html=share.shareHtml({id:'2026100801',name:'<b>"A&B"</b>',players:{black:'Kim',white:'Lee'},playerRanks:{black:'5d',white:''},date:'2026-10-08',result:'W+R',moves:321});
 assert.doesNotMatch(html,/<b>/);assert.match(html,/&lt;b&gt;&quot;A&amp;B&quot;/);
 assert.match(html,/og:url" content="https:\/\/weiqi.dliu.com\/game\/2026100801"/);
 assert.match(html,/og:image" content="https:\/\/weiqi.dliu.com\/share\/2026100801.png"/);
 assert.match(html,/Kim 5d vs Lee · 2026-10-08 · W\+R · 321 moves/);
});
test('link-preview crawlers get the share page; browsers and reports keep the app',()=>{
 const c={};vm.runInNewContext(readFileSync(new URL('../src/routes.cjs',import.meta.url),'utf8'),c);
 const route=(uri,agent)=>c.handler({request:{uri,querystring:{},headers:agent?{'user-agent':{value:agent}}:{}}}).uri;
 for(const bot of ['WhatsApp/2.23.20.0 A','facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)','TelegramBot (like TwitterBot)','Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'])assert.equal(route('/game/2026100801/',bot),'/share/2026100801.html');
 assert.equal(route('/game/2026100801','Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1'),'/record.html');
 assert.equal(route('/game/2026100801'),'/record.html');
 assert.equal(route('/game/2026100801/report','WhatsApp/2'),'/report.html');
});
