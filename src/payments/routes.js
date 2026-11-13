'use strict';
const express=require('express');
function createRouters(config,service,{currentUser,signedIn,admin}){
 const router=express.Router(),webhooks=express.Router();
 const handle=fn=>async(req,res,next)=>{try{res.set('Cache-Control','no-store');await fn(req,res);}catch(error){if(error.status)return res.status(error.status).json({error:error.message});if(['ER_DUP_ENTRY','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code))return res.status(409).json({error:'A matching payment update is in progress. Retry without changing the checkout request.'});next(error);}};
 for(const provider of ['stripe','paypal'])webhooks.post('/'+provider,express.raw({type:'application/json',limit:'1mb'}),handle(async(req,res)=>res.json(await service.webhook(provider,req.body,req.headers))));
 router.get('/config',handle(async(_req,res)=>res.json({enabled:config.enabled,mode:config.mode,providers:config.ready,defaultProvider:config.defaultProvider,allowFreeOrders:config.allowFreeOrders,currencies:config.currencies})));
 router.use(currentUser,signedIn);
 const attempts=new Map();
 const checkoutLimit=(req,res,next)=>{const now=Date.now(),key=String(req.user.id);let entry=attempts.get(key);if(!entry||entry.until<=now){entry={until:now+60000,count:0};attempts.set(key,entry);}if(++entry.count>10){res.set('Retry-After',String(Math.ceil((entry.until-now)/1000)));return res.status(429).json({error:'Too many checkout attempts. Wait a minute and retry.'});}if(attempts.size>10000)for(const [id,value]of attempts)if(value.until<=now)attempts.delete(id);next();};
 router.post('/checkout',checkoutLimit,handle(async(req,res)=>res.status(201).json(await service.create(req.user.id,req.body))));
 router.get('/orders',handle(async(req,res)=>res.json(await service.list(req.user.id,req.query.page===undefined?1:Number(req.query.page)))));
 router.get('/orders/:id',handle(async(req,res)=>res.json(await service.detail(req.params.id,req.user.id))));
 router.post('/orders/:id/refresh',handle(async(req,res)=>{await service.refresh(req.params.id,req.user.id,false);res.json(await service.detail(req.params.id,req.user.id));}));
 router.post('/orders/:id/capture',handle(async(req,res)=>{await service.refresh(req.params.id,req.user.id,true);res.json(await service.detail(req.params.id,req.user.id));}));
 router.get('/staff/orders',admin,handle(async(req,res)=>res.json(await service.list(undefined,req.query.page===undefined?1:Number(req.query.page)))));
 router.get('/staff/orders/:id',admin,handle(async(req,res)=>res.json(await service.detail(req.params.id))));
 router.post('/staff/orders/:id/refresh',admin,handle(async(req,res)=>{await service.refresh(req.params.id,undefined,false);res.json(await service.detail(req.params.id));}));
 return {router,webhooks};
}
module.exports={createRouters};
