import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
// The sitemap lists every public page by its canonical route: no redirects, game IDs, reports, errors, API or files.
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('the sitemap lists every canonical public page and nothing else',()=>{
 const c={};vm.createContext(c);vm.runInContext(read('src/routes.cjs'),c);
 const locs=[...read('src/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
 assert.equal(new Set(locs).size,locs.length);
 for(const loc of locs){
  assert.ok(loc.startsWith('https://weiqi.dliu.com/'),loc);
  const path=new URL(loc).pathname,r=c.handler({request:{uri:path,querystring:{},headers:{}}});
  assert.ok(!r.statusCode,'not a redirect: '+path);
  assert.ok(path==='/'||!/\.|\/game\/|\/api\/|\/share\/|\/health/.test(path),path);
 }
 const aliases=read('src/routes.cjs').match(/aliases=\{([^}]+)\}/)[1],pages=[...aliases.matchAll(/'(\/[^']*)':'\/[^']+\.html'/g)].map(m=>m[1]);
 assert.deepEqual(locs.map(l=>new URL(l).pathname).sort(),['/',...pages].sort());
 assert.match(read('src/robots.txt'),/^Sitemap: https:\/\/weiqi\.dliu\.com\/sitemap\.xml$/m);
 const publish=read('scripts/publish-site.sh');assert.match(publish,/ robots\.txt sitemap\.xml; do/);assert.match(publish,/\*\.xml\) mime='application\/xml; charset=utf-8'/);
});
