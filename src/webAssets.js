'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const express=require('express');

// Public URLs change with the bytes, even when a proxy ignores query strings.
// Retain the matching bytes in memory so an updater cannot change an asset
// underneath a running process while its HTML still references the old digest.
function createWebAssets(publicRoot){
 const router=express.Router();
 const urls=new Map();
 for(const filename of ['onyx-icon.svg','store.css','store.js','store-scene.svg','staff.css','staff.js','staff-licenses.js','customer-licenses.js']){
  const bytes=fs.readFileSync(path.join(publicRoot,filename));
  const digest=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16);
  const ext=path.extname(filename);
  const versioned=filename.slice(0,-ext.length)+'.'+digest+ext;
  urls.set('/assets/'+filename,'/assets/'+versioned);
  const serve=cache=>(_req,res)=>res.set('Cache-Control',cache).type(ext).send(bytes);
  router.get('/'+versioned,serve('public, max-age=31536000, immutable'));
  // Legacy URLs are still usable, but must not be reused without validation.
  router.get('/'+filename,serve('no-store'));
 }
 const pages=new Map();
 for(const filename of ['index.html','staff.html']){
  let html=fs.readFileSync(path.join(publicRoot,filename),'utf8');
  for(const [original,versioned] of urls)html=html.replaceAll('"'+original+'"','"'+versioned+'"');
  pages.set(filename,html);
 }
 function page(filename){if(!pages.has(filename))throw Error('Unknown public page: '+filename);return (_req,res)=>res.set('Cache-Control','no-store').type('html').send(pages.get(filename));}
 return {router,page};
}
module.exports=createWebAssets;
