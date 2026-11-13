'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const helmet=require('helmet');
const createWebAssets=require('../src/webAssets');

async function serve(t,assets){
 const app=express();app.use(helmet());app.get('/staff',assets.page('staff.html'));app.get('/',assets.page('index.html'));app.use('/assets',assets.router);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 return suffix=>fetch('http://127.0.0.1:'+server.address().port+suffix);
}
function copyPublic(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'onyx-assets-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const filename of ['index.html','staff.html','staff.css','staff.js','store.css','store.js','store-scene.svg','staff-licenses.js','customer-licenses.js'])fs.copyFileSync(path.join(__dirname,'../public',filename),path.join(root,filename));return root;}
function urls(html){return [...html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map(match=>match[1]);}

test('staff and store HTML reference content-versioned assets with correct MIME types',async t=>{
 const get=await serve(t,createWebAssets(path.join(__dirname,'../public')));
 for(const page of ['/staff','/']){
  const response=await get(page);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  const references=urls(await response.text());assert.equal(references.length,page==='/'?4:3);
  for(const url of references){assert.match(url,/^\/assets\/(staff|store|store-scene|staff-licenses|customer-licenses)\.[a-f0-9]{16}\.(css|js|svg)$/);const asset=await get(url);assert.equal(asset.status,200);assert.match(asset.headers.get('cache-control'),/immutable/);assert.equal(asset.headers.get('x-content-type-options'),'nosniff');assert.match(asset.headers.get('content-type'),url.endsWith('.css')?/text\/css/:url.endsWith('.svg')?/image\/svg\+xml/:/(application|text)\/javascript/);assert.ok((await asset.text()).length>100);}
 }
});
test('changing asset contents changes its URL without changing unchanged assets',async t=>{
 const root=copyPublic(t);const first=await serve(t,createWebAssets(root));const firstUrls=urls(await (await first('/staff')).text());
 fs.appendFileSync(path.join(root,'staff.js'),'\n// Changed release\n');
 const second=await serve(t,createWebAssets(root));const secondUrls=urls(await (await second('/staff')).text());
 const before=firstUrls.find(u=>/\/staff\.[a-f0-9]+\.js$/.test(u)),after=secondUrls.find(u=>/\/staff\.[a-f0-9]+\.js$/.test(u));
 assert.equal(firstUrls[0],secondUrls[0]);assert.notEqual(before,after);
 assert.doesNotMatch(await (await first(before)).text(),/Changed release/);assert.match(await (await second(after)).text(),/Changed release/);
});
test('unversioned compatibility assets do not cache and unknown files are not exposed',async t=>{
 const get=await serve(t,createWebAssets(path.join(__dirname,'../public')));
 for(const file of ['staff.js','staff.css','store.js','store.css']){const response=await get('/assets/'+file);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');}
 for(const file of ['config.js','staff.html','staff.0000000000000000.js'])assert.equal((await get('/assets/'+file)).status,404);
});
