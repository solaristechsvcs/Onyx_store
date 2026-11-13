'use strict';
const express=require('express');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const validation=require('./catalogValidation');
const imageRoot=path.join(__dirname,'..','uploads','product-images');
function imageType(buffer){
 if(!Buffer.isBuffer(buffer))return null;
 if(buffer.length>=24&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&buffer.toString('ascii',12,16)==='IHDR')return {ext:'png',mime:'image/png'};
 if(buffer.length>=12&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255&&buffer[buffer.length-2]===255&&buffer[buffer.length-1]===217)return {ext:'jpg',mime:'image/jpeg'};
 if(buffer.length>=20&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(buffer.toString('ascii',12,16)))return {ext:'webp',mime:'image/webp'};
 return null;
}
function createRouter(db,{admin}){
 const router=express.Router();
 const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){if(error.status)return res.status(error.status).json({error:error.message});if(error.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That URL slug is already in use. Choose another.'});if(['ER_ROW_IS_REFERENCED_2','ER_NO_REFERENCED_ROW_2'].includes(error.code))return res.status(409).json({error:'This record is referenced by other records. Unpublish or remove its associations first.'});if(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code))return res.status(409).json({error:'Another catalog edit is in progress. Please retry.'});next(error);}};
 async function transaction(fn){const conn=await db.getConnection();try{await conn.beginTransaction();const result=await fn(conn);await conn.commit();return result;}catch(error){await conn.rollback();throw error;}finally{conn.release();}}
 const audit=(conn,req,action,entity)=>conn.query('INSERT INTO audit_logs(actor,action,entity_id) VALUES (?,?,?)',['user:'+req.user.id,action,String(entity)]);
 async function getProduct(conn,id,lock=false){const [[row]]=await conn.query('SELECT * FROM products WHERE id=?'+(lock?' FOR UPDATE':''),[id]);if(!row)validation.invalid('Product not found',404);return row;}
 router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 router.get('/summary',handle(async(_req,res)=>{const [[row]]=await db.query('SELECT (SELECT COUNT(*) FROM products) AS products,(SELECT COUNT(*) FROM products WHERE is_published=1) AS published,(SELECT COUNT(*) FROM categories) AS categories,(SELECT COUNT(*) FROM users) AS users');res.json(row);}));
 router.get('/products',handle(async(req,res)=>{
  const page=req.query.page===undefined?1:Number(req.query.page);validation.integer(page,'Page',1,1000000);
  const q=typeof req.query.q==='string'?req.query.q.trim():'';if(q.length>180)validation.invalid('Search is too long');
  const status=req.query.status||'all';if(!['all','published','draft'].includes(status))validation.invalid('Invalid status');
  let where=' WHERE 1=1';const args=[];
  if(q){where+=' AND (p.name LIKE ? OR p.slug LIKE ?)';const like='%'+q.replace(/[\\%_]/g,'\\$&')+'%';args.push(like,like);}
  if(status!=='all'){where+=' AND p.is_published=?';args.push(status==='published'?1:0);}
  if(req.query.category){where+=' AND EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id=p.id AND pc.category_id=?)';args.push(validation.id(req.query.category,'category'));}
  const [[{total}]]=await db.query('SELECT COUNT(*) AS total FROM products p'+where,args);
  const [items]=await db.query('SELECT p.id,p.name,p.slug,p.price_cents,p.currency,p.is_published,p.is_digital,p.image_path,p.revision FROM products p'+where+' ORDER BY p.id DESC LIMIT 25 OFFSET ?',[...args,(page-1)*25]);res.json({items,total:Number(total),page,pageSize:25});
 }));
 router.get('/products/:id',handle(async(req,res)=>{const id=validation.id(req.params.id);const item=await getProduct(db,id);const [categories]=await db.query('SELECT category_id FROM product_categories WHERE product_id=?',[id]);res.json({...item,category_ids:categories.map(c=>String(c.category_id))});}));
 async function saveProduct(req,res,editing){
  const value=validation.product(req.body);const id=editing?validation.id(req.params.id):null;
  const revision=editing?validation.integer(req.body.revision,'Revision',1,2147483646):null;
  if(value.image_path){try{await fs.access(path.join(imageRoot,path.basename(value.image_path)));}catch{validation.invalid('Product image is missing. Upload it again.');}}
  const result=await transaction(async conn=>{
   // Lock the graph before products, matching category deletion's lock order.
   const [categories]=await conn.query('SELECT id,parent_id FROM categories ORDER BY id FOR UPDATE');
   const known=new Set(categories.map(c=>String(c.id)));if(value.category_ids.some(c=>!known.has(c)))validation.invalid('One or more categories no longer exist');
   if(editing){const current=await getProduct(conn,id,true);if(current.revision!==revision)validation.invalid('Someone else edited this product. Reload it before saving.',409);}
   const fields=['name','slug','description','price_cents','currency','is_digital','activation_limit','license_duration_days','is_published','image_path'];
   let productId=id;
   if(editing)await conn.query('UPDATE products SET '+fields.map(f=>f+'=?').join(',')+',revision=revision+1 WHERE id=?',[...fields.map(f=>value[f]),id]);
   else {const [insert]=await conn.query('INSERT INTO products ('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')',fields.map(f=>value[f]));productId=String(insert.insertId);}
   await conn.query('DELETE FROM product_categories WHERE product_id=?',[productId]);
   for(const categoryId of value.category_ids)await conn.query('INSERT INTO product_categories(product_id,category_id) VALUES (?,?)',[productId,categoryId]);
   await audit(conn,req,editing?'product.update':'product.create',productId);
   return {id:productId,revision:editing?revision+1:1};
  });res.status(editing?200:201).json(result);
 }
 router.post('/products',admin,handle((req,res)=>saveProduct(req,res,false)));
 router.put('/products/:id',admin,handle((req,res)=>saveProduct(req,res,true)));
 router.delete('/products/:id',admin,handle(async(req,res)=>{const id=validation.id(req.params.id);const revision=validation.integer(req.body?.revision,'Revision',1,2147483646);await transaction(async conn=>{const item=await getProduct(conn,id,true);if(item.revision!==revision)validation.invalid('Product changed. Reload before deleting.',409);if(item.is_published)validation.invalid('Unpublish this product before deleting it.',409);await conn.query('DELETE FROM products WHERE id=?',[id]);await audit(conn,req,'product.delete',id);});res.json({ok:true});}));
 router.get('/categories',handle(async(_req,res)=>{const [rows]=await db.query('SELECT c.*,(SELECT COUNT(*) FROM product_categories pc WHERE pc.category_id=c.id) AS product_count FROM categories c ORDER BY c.sort_order,c.name');res.json(rows);}));
 async function saveCategory(req,res,editing){const value=validation.category(req.body),id=editing?validation.id(req.params.id):null;const revision=editing?validation.integer(req.body.revision,'Revision',1,2147483646):null;const result=await transaction(async conn=>{const [rows]=await conn.query('SELECT id,parent_id,revision FROM categories ORDER BY id FOR UPDATE');const current=rows.find(c=>String(c.id)===id);if(editing&&!current)validation.invalid('Category not found',404);if(editing&&current.revision!==revision)validation.invalid('Category changed. Reload it before saving.',409);validation.parentCheck(rows,id,value.parent_id);const fields=['name','slug','description','parent_id','sort_order','is_visible'];let categoryId=id;if(editing)await conn.query('UPDATE categories SET '+fields.map(f=>f+'=?').join(',')+',revision=revision+1 WHERE id=?',[...fields.map(f=>value[f]),id]);else{const [insert]=await conn.query('INSERT INTO categories ('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')',fields.map(f=>value[f]));categoryId=String(insert.insertId);}await audit(conn,req,editing?'category.update':'category.create',categoryId);return {id:categoryId,revision:editing?revision+1:1};});res.status(editing?200:201).json(result);}
 router.post('/categories',admin,handle((req,res)=>saveCategory(req,res,false)));
 router.put('/categories/:id',admin,handle((req,res)=>saveCategory(req,res,true)));
 router.delete('/categories/:id',admin,handle(async(req,res)=>{const id=validation.id(req.params.id),revision=validation.integer(req.body?.revision,'Revision',1,2147483646);await transaction(async conn=>{const [rows]=await conn.query('SELECT id,parent_id,revision FROM categories ORDER BY id FOR UPDATE');const current=rows.find(c=>String(c.id)===id);if(!current)validation.invalid('Category not found',404);if(current.revision!==revision)validation.invalid('Category changed. Reload before deleting.',409);if(rows.some(c=>String(c.parent_id)===id))validation.invalid('Move or delete subcategories first.',409);const [[{total}]]=await conn.query('SELECT COUNT(*) AS total FROM product_categories WHERE category_id=?',[id]);if(Number(total))validation.invalid('Remove products from this category before deleting it.',409);await conn.query('DELETE FROM categories WHERE id=?',[id]);await audit(conn,req,'category.delete',id);});res.json({ok:true});}));
 router.post('/images',admin,express.raw({type:['image/png','image/jpeg','image/webp'],limit:'5mb'}),handle(async(req,res)=>{const type=imageType(req.body);if(!type||req.get('content-type')?.split(';')[0]!==type.mime)validation.invalid('Upload a PNG, JPEG or WebP image, at most 5 MB. SVG and other formats are not accepted.');await fs.mkdir(imageRoot,{recursive:true});const filename=crypto.randomBytes(24).toString('hex')+'.'+type.ext;await fs.writeFile(path.join(imageRoot,filename),req.body,{flag:'wx'});res.status(201).json({image_path:'/media/products/'+filename});}));
 router.get('/audit',admin,handle(async(_req,res)=>{const [items]=await db.query("SELECT id,actor,action,entity_id,created_at FROM audit_logs WHERE action LIKE 'product.%' OR action LIKE 'category.%' OR action LIKE 'user.role.%' OR action LIKE 'license.%' OR action LIKE 'payment.%' ORDER BY id DESC LIMIT 100");res.json(items);}));
 return router;
}
module.exports={createRouter,imageType,imageRoot};
