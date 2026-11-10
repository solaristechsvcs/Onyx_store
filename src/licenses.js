const crypto=require('node:crypto');
const db=require('./db');
const {hash,newToken,apiAuth,requireIssue}=require('./security');
const router=require('express').Router();
router.use(apiAuth);
router.post('/issue',requireIssue,async(req,res,next)=>{try{
 const productId=Number(req.body.productId),userId=req.body.userId==null?null:Number(req.body.userId);
 if(!Number.isSafeInteger(productId)||productId<1||userId!==null&&(!Number.isSafeInteger(userId)||userId<1))return res.status(400).json({error:'Invalid productId or userId'});
 const [[product]]=await db.query('SELECT id,activation_limit,license_duration_days FROM products WHERE id=? AND is_digital=1',[productId]);
 if(!product)return res.status(404).json({error:'Digital product not found'});
 const key=newToken('ONYX-'),limit=product.activation_limit;
 const expiry=product.license_duration_days?new Date(Date.now()+product.license_duration_days*86400000):null;
 const [result]=await db.query('INSERT INTO licenses(product_id,user_id,origin,license_prefix,license_hash,activation_limit,expires_at) VALUES (?,?,"external",?,?,?,?)',[productId,userId,key.slice(0,13),hash(key),limit,expiry]);
 await db.query('INSERT INTO audit_logs(actor,action,entity_id) VALUES (?,?,?)',['api:'+req.apiClient.id,'license.issue',String(result.insertId)]);
 res.status(201).json({id:result.insertId,key,expiresAt:expiry,activationLimit:limit});
}catch(e){next(e)}});
async function lookup(key){const [[license]]=await db.query('SELECT id,product_id,status,expires_at,activation_limit FROM licenses WHERE license_hash=?',[hash(key)]);return license;}
const active=l=>l&&l.status==='active'&&(!l.expires_at||new Date(l.expires_at).getTime()>Date.now());
router.post('/validate',async(req,res,next)=>{try{if(typeof req.body.key!=='string'||req.body.key.length>200)return res.status(400).json({error:'Invalid key'});const l=await lookup(req.body.key);res.json({valid:!!active(l),productId:l?.product_id||null,expiresAt:l?.expires_at||null});}catch(e){next(e)}});
router.post('/activate',async(req,res,next)=>{let connection;try{
 const {key,installationId}=req.body;
 if(typeof key!=='string'||key.length>200||typeof installationId!=='string'||installationId.length<8||installationId.length>200)return res.status(400).json({error:'Invalid activation details'});
 connection=await db.getConnection();await connection.beginTransaction();
 const [[l]]=await connection.query('SELECT id,status,expires_at,activation_limit FROM licenses WHERE license_hash=? FOR UPDATE',[hash(key)]);
 if(!active(l)){await connection.rollback();return res.status(403).json({error:'License not active'});}
 const installationHash=hash(installationId);
 const [[existing]]=await connection.query('SELECT id FROM license_activations WHERE license_id=? AND installation_hash=?',[l.id,installationHash]);
 if(!existing){const [[count]]=await connection.query('SELECT COUNT(*) AS n FROM license_activations WHERE license_id=?',[l.id]);if(count.n>=l.activation_limit){await connection.rollback();return res.status(409).json({error:'Activation limit reached'});}await connection.query('INSERT INTO license_activations(license_id,installation_hash) VALUES (?,?)',[l.id,installationHash]);}
 await connection.commit();res.json({valid:true,activated:true,expiresAt:l.expires_at});
}catch(e){if(connection)await connection.rollback();next(e)}finally{connection?.release()}});
router.post('/deactivate',async(req,res,next)=>{try{const {key,installationId}=req.body;if(typeof key!=='string'||typeof installationId!=='string')return res.status(400).json({error:'Invalid details'});const l=await lookup(key);if(!l)return res.status(404).json({error:'License not found'});await db.query('DELETE FROM license_activations WHERE license_id=? AND installation_hash=?',[l.id,hash(installationId)]);res.json({deactivated:true});}catch(e){next(e)}});
module.exports=router;
