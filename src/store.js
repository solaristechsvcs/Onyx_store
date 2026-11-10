const express=require('express');
const db=require('./db');
const router=express.Router();
const slugOk=s=>typeof s==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)&&s.length<=190;
router.get('/categories',async(req,res,next)=>{try{const [rows]=await db.query('SELECT id,parent_id,name,slug,description,sort_order FROM categories WHERE is_visible=1 ORDER BY sort_order,name');res.json(rows);}catch(e){next(e)}});
router.get('/products',async(req,res,next)=>{try{const category=req.query.category;let sql='SELECT DISTINCT p.id,p.name,p.slug,p.description,p.price_cents,p.currency,p.is_digital FROM products p';const args=[];if(category){if(!slugOk(category))return res.status(400).json({error:'Invalid category'});sql+=' JOIN product_categories pc ON pc.product_id=p.id JOIN categories c ON c.id=pc.category_id WHERE p.is_published=1 AND c.slug=?';args.push(category);}else sql+=' WHERE p.is_published=1';sql+=' ORDER BY p.id DESC LIMIT 100';const [rows]=await db.query(sql,args);res.json(rows);}catch(e){next(e)}});
router.get('/products/:slug',async(req,res,next)=>{try{if(!slugOk(req.params.slug))return res.status(400).json({error:'Invalid slug'});const [[p]]=await db.query('SELECT id,name,slug,description,price_cents,currency,is_digital,activation_limit,license_duration_days FROM products WHERE slug=? AND is_published=1',[req.params.slug]);if(!p)return res.status(404).json({error:'Product not found'});res.json(p);}catch(e){next(e)}});
module.exports=router;
