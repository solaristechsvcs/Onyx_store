'use strict';
const express=require('express');
const {id,integer,invalid}=require('./catalogValidation');
const {createService,publicFields}=require('./licenseService');
const codec=require('./licenseKeys');
const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){if(error.status)return res.status(error.status).json({error:error.message});if(error.code==='ER_DUP_ENTRY')return res.status(409).json({error:'This assignment already exists. Reload before retrying.'});if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code))return res.status(409).json({error:'Another license update is in progress. Please retry.'});next(error);}};
function createRouters(db,{admin,signedIn},service=createService(db)){
 const staff=express.Router(),customer=express.Router();
 const noCache=(_req,res,next)=>{res.set('Cache-Control','no-store');next();};
 staff.use(noCache);
 staff.use(['/licenses','/license-options','/license-orders','/license-api-clients'],admin);
 customer.use(signedIn,noCache);
 const actor=req=>'user:'+req.user.id;
 async function list(req,res,owner){
  const page=req.query.page===undefined?1:Number(req.query.page);integer(page,'Page',1,1000000);
  const args=[];let where=' WHERE 1=1';if(owner!==undefined){where+=' AND l.user_id=?';args.push(owner);}
  const q=typeof req.query.q==='string'?req.query.q.trim():'';if(q.length>180)invalid('Search is too long');if(q){where+=' AND (p.name LIKE ? OR u.email LIKE ? OR l.license_prefix LIKE ?)';const term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';args.push(term,term,term);}
  if(req.query.status&&req.query.status!=='all'){if(!['active','suspended','revoked'].includes(req.query.status))invalid('Invalid status');where+=' AND l.status=?';args.push(req.query.status);}
  const joins=' FROM licenses l JOIN products p ON p.id=l.product_id LEFT JOIN users u ON u.id=l.user_id';
  const [[{total}]]=await db.query('SELECT COUNT(*) AS total'+joins+where,args);
  const [items]=await db.query('SELECT '+publicFields+joins+where+' ORDER BY l.id DESC LIMIT 25 OFFSET ?',[...args,(page-1)*25]);res.json({items,total:Number(total),page,pageSize:25});
 }
 staff.get('/licenses',handle((req,res)=>list(req,res)));
 staff.get('/license-options',handle(async(req,res)=>{const q=typeof req.query.q==='string'?req.query.q.trim():'';if(q.length>180)invalid('Search is too long');const term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';let rows;if(req.query.kind==='users')[rows]=await db.query('SELECT id,email,display_name FROM users WHERE email LIKE ? OR display_name LIKE ? ORDER BY id DESC LIMIT 30',[term,term]);else if(req.query.kind==='products')[rows]=await db.query('SELECT id,name,is_published,activation_limit,license_duration_days FROM products WHERE is_digital=1 AND (name LIKE ? OR slug LIKE ?) ORDER BY id DESC LIMIT 30',[term,term]);else invalid('Choose users or products');res.json(rows);}));
 staff.post('/licenses',handle(async(req,res)=>res.status(201).json(await service.assign(req.body,actor(req)))));
 staff.get('/licenses/:id',handle(async(req,res)=>res.json(await service.detail(req.params.id))));
 staff.patch('/licenses/:id',handle(async(req,res)=>res.json(await service.update(req.params.id,req.body,actor(req)))));
 for(const [route,method] of [['rotate','rotate'],['reveal','reveal'],['reset-activations','reset']])staff.post('/licenses/:id/'+route,handle(async(req,res)=>res.json(await (method==='reveal'?service.reveal(req.params.id,actor(req)):service[method](req.params.id,req.body?.revision,actor(req))))));
 staff.delete('/licenses/:id/activations/:activationId',handle(async(req,res)=>res.json(await service.reset(req.params.id,req.body?.revision,actor(req),undefined,req.params.activationId))));
 staff.post('/license-orders/:id/fulfill',handle(async(req,res)=>res.json(await service.fulfillOrder(req.params.id,actor(req)))));
 staff.get('/license-api-clients',handle(async(_req,res)=>{const [rows]=await db.query('SELECT id,name,scope,is_active,created_at FROM api_clients ORDER BY id DESC LIMIT 100');res.json(rows);}));
 staff.post('/license-api-clients',handle(async(req,res)=>{const name=typeof req.body?.name==='string'?req.body.name.trim():'',scope=req.body?.scope;if(typeof name!=='string'||!name||name.length>120||!['validate','issue'].includes(scope))invalid('Provide a name and valid scope');const token='ONYX_API_'+require('node:crypto').randomBytes(32).toString('base64url');await service.transaction(async conn=>{const [row]=await conn.query('INSERT INTO api_clients(name,token_hash,scope) VALUES (?,?,?)',[name,codec.hash(token),scope]);await conn.query('INSERT INTO audit_logs(actor,action,entity_id) VALUES (?,?,?)',[actor(req),'license.api.create',String(row.insertId)]);});res.status(201).json({token});}));
 staff.patch('/license-api-clients/:id',handle(async(req,res)=>{if(typeof req.body?.is_active!=='boolean')invalid('is_active must be true or false');await service.transaction(async conn=>{const [row]=await conn.query('UPDATE api_clients SET is_active=? WHERE id=?',[req.body.is_active,id(req.params.id)]);if(!row.affectedRows)invalid('API client not found',404);await conn.query('INSERT INTO audit_logs(actor,action,entity_id) VALUES (?,?,?)',[actor(req),'license.api.'+(req.body.is_active?'enable':'disable'),req.params.id]);});res.json({ok:true});}));
 customer.get('/',handle((req,res)=>list(req,res,req.user.id)));
 customer.get('/:id',handle(async(req,res)=>res.json(await service.detail(req.params.id,req.user.id))));
 customer.post('/:id/reveal',handle(async(req,res)=>res.json(await service.reveal(req.params.id,actor(req),req.user.id))));
 customer.post('/:id/rotate',handle(async(req,res)=>res.json(await service.rotate(req.params.id,req.body?.revision,actor(req),req.user.id))));
 customer.post('/:id/reset-activations',handle(async(req,res)=>res.json(await service.reset(req.params.id,req.body?.revision,actor(req),req.user.id))));
 customer.delete('/:id/activations/:activationId',handle(async(req,res)=>res.json(await service.reset(req.params.id,req.body?.revision,actor(req),req.user.id,req.params.activationId))));
 return {staff,customer};
}
module.exports={createRouters,handle};
