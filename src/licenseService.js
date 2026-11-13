'use strict';
const keys=require('./licenseKeys');
const {invalid,id,integer}=require('./catalogValidation');
const active=license=>license&&license.status==='active'&&(!license.expires_at||new Date(license.expires_at).getTime()>Date.now());
const publicFields='l.id,l.product_id,l.user_id,l.order_item_id,l.origin,l.license_prefix,l.status,l.activation_limit,l.expires_at,l.created_at,l.revision,p.name AS product_name,p.slug AS product_slug,p.is_published,u.email,u.display_name,(SELECT COUNT(*) FROM license_activations a WHERE a.license_id=l.id) AS activation_count';
function expiry(value){if(value===null||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))invalid('Expiry must be a valid UTC date or null');const date=new Date(value);if(date.toISOString().slice(0,19)!==value.slice(0,19))invalid('Expiry must be a valid calendar date');return date;}
function createService(db,codec=keys){
 const audit=(conn,actor,action,entity)=>conn.query('INSERT INTO audit_logs(actor,action,entity_id) VALUES (?,?,?)',[actor,action,String(entity)]);
 async function transaction(fn){const conn=await db.getConnection();try{await conn.beginTransaction();const result=await fn(conn);await conn.commit();return result;}catch(error){await conn.rollback();throw error;}finally{conn.release();}}
 async function locked(conn,licenseId,userId){const [[license]]=await conn.query('SELECT * FROM licenses WHERE id=? FOR UPDATE',[id(licenseId)]);if(!license||(userId!==undefined&&String(license.user_id)!==String(userId)))invalid('License not found',404);return license;}
 async function usable(conn,license){if(!active(license))invalid('Only active, unexpired licenses can perform this action.',403);if(license.order_item_id){const [[order]]=await conn.query('SELECT o.status FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE oi.id=?',[license.order_item_id]);if(!order||order.status!=='paid')invalid('This purchase is not currently paid.',403);}}
 function checkRevision(license,revision){integer(revision,'Revision',1,2147483646);if(license.revision!==revision)invalid('This license changed. Reload before trying again.',409);}
 async function insert(conn,{product,userId,origin,orderItemId=null,issuanceId=null,limit,expiresAt,actor}){
  const key=codec.generate();
  const [result]=await conn.query('INSERT INTO licenses(product_id,user_id,order_item_id,origin,license_prefix,license_hash,license_secret,activation_limit,expires_at,issuance_id) VALUES (?,?,?,?,?,?,?,?,?,?)',[product.id,userId,orderItemId,origin,key.slice(0,13),codec.hash(key),codec.encrypt(key),limit??product.activation_limit,expiresAt===undefined?(product.license_duration_days?new Date(Date.now()+product.license_duration_days*86400000):null):expiresAt,issuanceId]);
  await audit(conn,actor,'license.issue.'+origin,result.insertId);return {id:String(result.insertId),key};
 }
 async function assign(body,actor){
  if(!body||typeof body!=='object')invalid('Assignment details required');
  const productId=id(body.productId,'product'),userId=id(body.userId,'user');
  if(typeof body.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(body.requestId))invalid('A valid assignment request ID is required');
  const limit=body.activationLimit===undefined?undefined:integer(body.activationLimit,'Activation limit',1,1000000),expiresAt=body.expiresAt===undefined?undefined:expiry(body.expiresAt);
  return transaction(async conn=>{
   const [[user]]=await conn.query('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);if(!user)invalid('Customer not found',404);
   const [[existing]]=await conn.query('SELECT id,product_id,user_id FROM licenses WHERE issuance_id=?',['manual:'+body.requestId]);
   if(existing){if(String(existing.user_id)!==userId||String(existing.product_id)!==productId)invalid('Assignment request already used for another product or customer',409);return {id:String(existing.id),existing:true};}
   const [[product]]=await conn.query('SELECT id,activation_limit,license_duration_days FROM products WHERE id=? AND is_digital=1',[productId]);if(!product)invalid('Digital product not found',404);
   return insert(conn,{product,userId,origin:'manual',issuanceId:'manual:'+body.requestId,limit,expiresAt,actor});
  });
 }
 async function update(licenseId,body,actor){
  if(!body||typeof body!=='object')invalid('License details required');
  if(!['active','suspended','revoked'].includes(body.status))invalid('Invalid license status');
  const limit=integer(body.activationLimit,'Activation limit',1,1000000),expiresAt=expiry(body.expiresAt);
  return transaction(async conn=>{const license=await locked(conn,licenseId);checkRevision(license,body.revision);const [[{total}]]=await conn.query('SELECT COUNT(*) AS total FROM license_activations WHERE license_id=?',[license.id]);if(Number(total)>limit)invalid('Reset activations before reducing the limit below current usage.',409);
   if(body.status==='active'&&license.order_item_id){const [[order]]=await conn.query('SELECT o.status FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE oi.id=?',[license.order_item_id]);if(!order||order.status!=='paid')invalid('A license for an unpaid, refunded or cancelled order cannot be activated.',409);}
   await conn.query('UPDATE licenses SET status=?,activation_limit=?,expires_at=?,revision=revision+1 WHERE id=?',[body.status,limit,expiresAt,license.id]);if(body.status==='revoked')await conn.query('DELETE FROM license_activations WHERE license_id=?',[license.id]);await audit(conn,actor,'license.update.'+body.status,license.id);return {ok:true};});
 }
 async function rotate(licenseId,revision,actor,userId){return transaction(async conn=>{const license=await locked(conn,licenseId,userId);checkRevision(license,revision);if(userId!==undefined)await usable(conn,license);const key=codec.generate();await conn.query('UPDATE licenses SET license_hash=?,license_prefix=?,license_secret=?,revision=revision+1 WHERE id=?',[codec.hash(key),key.slice(0,13),codec.encrypt(key),license.id]);await conn.query('DELETE FROM license_activations WHERE license_id=?',[license.id]);await audit(conn,actor,'license.rotate',license.id);return {key};});}
 async function reveal(licenseId,actor,userId){return transaction(async conn=>{const license=await locked(conn,licenseId,userId);if(userId!==undefined)await usable(conn,license);if(!license.license_secret)invalid('This legacy key cannot be recovered. Generate a replacement key.',409);let key;try{key=codec.decrypt(license.license_secret);}catch{invalid('Unable to decrypt the key. Restore the original .onyx-license-key file from backup.',503);}await audit(conn,actor,'license.reveal',license.id);return {key};});}
 async function reset(licenseId,revision,actor,userId,activationId){return transaction(async conn=>{const license=await locked(conn,licenseId,userId);checkRevision(license,revision);if(userId!==undefined)await usable(conn,license);if(activationId)await conn.query('DELETE FROM license_activations WHERE id=? AND license_id=?',[id(activationId),license.id]);else await conn.query('DELETE FROM license_activations WHERE license_id=?',[license.id]);await conn.query('UPDATE licenses SET revision=revision+1 WHERE id=?',[license.id]);await audit(conn,actor,activationId?'license.activation.remove':'license.activations.reset',license.id);return {ok:true};});}
 async function detail(licenseId,userId){const args=[id(licenseId)];let where=' WHERE l.id=?';if(userId!==undefined){where+=' AND l.user_id=?';args.push(userId);}const [[license]]=await db.query('SELECT '+publicFields+' FROM licenses l JOIN products p ON p.id=l.product_id LEFT JOIN users u ON u.id=l.user_id'+where,args);if(!license)invalid('License not found',404);const [activations]=await db.query('SELECT id,created_at FROM license_activations WHERE license_id=? ORDER BY id',[license.id]);return {...license,activations};}
 async function fulfillOrder(orderId,actor='system:licenses'){
  return transaction(async conn=>{
   const [[order]]=await conn.query('SELECT id,user_id,status FROM orders WHERE id=? FOR UPDATE',[id(orderId,'order')]);if(!order)invalid('Order not found',404);
   const [items]=await conn.query('SELECT oi.id,oi.product_id,oi.quantity,COALESCE(oi.is_digital,p.is_digital) AS is_digital,COALESCE(oi.activation_limit,p.activation_limit) AS activation_limit,CASE WHEN oi.is_digital IS NULL THEN p.license_duration_days ELSE oi.license_duration_days END AS license_duration_days FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=? ORDER BY oi.id',[order.id]);
   if(['refunded','cancelled'].includes(order.status)){for(const item of items){const [licenses]=await conn.query("SELECT id FROM licenses WHERE order_item_id=? AND origin='store' AND status<>'revoked' FOR UPDATE",[item.id]);for(const license of licenses){await conn.query("UPDATE licenses SET status='revoked',revision=revision+1 WHERE id=?",[license.id]);await conn.query('DELETE FROM license_activations WHERE license_id=?',[license.id]);await audit(conn,actor,'license.order.revoke',license.id);}}return {issued:0,revoked:true};}
   if(order.status!=='paid')invalid('Licenses can only be issued for orders recorded as paid.',409);
   let issued=0;for(const item of items){if(!item.is_digital)continue;integer(item.quantity,'Order quantity',1,1000);const [existing]=await conn.query("SELECT id,issuance_id FROM licenses WHERE order_item_id=? AND origin='store' ORDER BY id FOR UPDATE",[item.id]);
    // Retain earlier store-issued licenses instead of duplicating legacy grants.
    for(let unit=existing.length;unit<item.quantity;unit++){await insert(conn,{product:{...item,id:item.product_id},userId:order.user_id,origin:'store',orderItemId:item.id,issuanceId:'order:'+item.id+':unit:'+unit,actor});issued++;}
   }return {issued};
  });
 }
 async function issueExternal(productId,userId,actor){productId=id(productId,'product');if(userId!==null)userId=id(userId,'user');return transaction(async conn=>{if(userId!==null){const [[user]]=await conn.query('SELECT id FROM users WHERE id=?',[userId]);if(!user)invalid('Customer not found',404);}const [[product]]=await conn.query('SELECT id,activation_limit,license_duration_days FROM products WHERE id=? AND is_digital=1',[productId]);if(!product)invalid('Digital product not found',404);const result=await insert(conn,{product,userId,origin:'external',actor});return {...result,activationLimit:product.activation_limit,expiresAt:product.license_duration_days?new Date(Date.now()+product.license_duration_days*86400000):null};});}
 return {assign,update,rotate,reveal,reset,detail,fulfillOrder,transaction,issueExternal};
}
module.exports={createService,active,publicFields,expiry};
