'use strict';
const express=require('express');
const {createService,active}=require('./licenseService');
const {handle}=require('./licenseRoutes');
const {invalid}=require('./catalogValidation');
const keys=require('./licenseKeys');
function createRouter(db,{apiAuth,requireIssue},service=createService(db)){
 const router=express.Router();router.use(apiAuth,(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const keyOk=key=>typeof key==='string'&&key.length>0&&key.length<=200;
 const installationOk=id=>typeof id==='string'&&id.length>=8&&id.length<=200;
 async function lookup(conn,key,lock=false){const [[license]]=await conn.query('SELECT * FROM licenses WHERE license_hash=?'+(lock?' FOR UPDATE':''),[keys.hash(key)]);if(license?.order_item_id){const [[order]]=await conn.query('SELECT o.status FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE oi.id=?',[license.order_item_id]);license.order_status=order?.status||'missing';}return license;}
 const usable=(license,productId)=>active(license)&&(!license.order_item_id||license.order_status==='paid')&&(productId===undefined||String(productId)===String(license.product_id));
 router.post('/issue',requireIssue,handle(async(req,res)=>res.status(201).json(await service.issueExternal(req.body?.productId,req.body?.userId??null,'api:'+req.apiClient.id))));
 router.post('/validate',handle(async(req,res)=>{if(!keyOk(req.body?.key))invalid('Invalid key');const license=await lookup(db,req.body.key);res.json({valid:!!usable(license,req.body.productId),productId:license?.product_id||null,expiresAt:license?.expires_at||null});}));
 router.post('/activate',handle(async(req,res)=>{const {key,installationId,productId}=req.body||{};if(!keyOk(key)||!installationOk(installationId))invalid('Invalid activation details');const result=await service.transaction(async conn=>{const license=await lookup(conn,key,true);if(!usable(license,productId))invalid('License not active for this product',403);const installationHash=keys.hash(installationId);const [[existing]]=await conn.query('SELECT id FROM license_activations WHERE license_id=? AND installation_hash=?',[license.id,installationHash]);if(!existing){const [[count]]=await conn.query('SELECT COUNT(*) AS n FROM license_activations WHERE license_id=?',[license.id]);if(Number(count.n)>=license.activation_limit)invalid('Activation limit reached',409);await conn.query('INSERT INTO license_activations(license_id,installation_hash) VALUES (?,?)',[license.id,installationHash]);await conn.query('UPDATE licenses SET revision=revision+1 WHERE id=?',[license.id]);}return {valid:true,activated:true,expiresAt:license.expires_at};});res.json(result);}));
 router.post('/deactivate',handle(async(req,res)=>{const {key,installationId}=req.body||{};if(!keyOk(key)||!installationOk(installationId))invalid('Invalid activation details');await service.transaction(async conn=>{const license=await lookup(conn,key,true);if(!license)invalid('License not found',404);await conn.query('DELETE FROM license_activations WHERE license_id=? AND installation_hash=?',[license.id,keys.hash(installationId)]);await conn.query('UPDATE licenses SET revision=revision+1 WHERE id=?',[license.id]);});res.json({deactivated:true});}));
 return router;
}
module.exports={createRouter};
