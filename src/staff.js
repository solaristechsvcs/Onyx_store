const router=require('express').Router();
const db=require('./db');
const {staff,admin}=require('./auth');
router.use(staff);
router.use(require('./catalogAdmin').createRouter(db,{admin}));
router.get('/users',async(req,res,next)=>{try{const [rows]=await db.query('SELECT id,email,display_name,role,created_at FROM users ORDER BY id DESC LIMIT 200');res.json(rows);}catch(e){next(e)}});
router.patch('/users/:id/role',admin,async(req,res,next)=>{try{
const id=Number(req.params.id),role=req.body?.role;
if(!Number.isSafeInteger(id)||id<1||!['customer','staff','admin'].includes(role))return res.status(400).json({error:'Invalid user or role'});
if(String(req.user.id)===String(id))return res.status(403).json({error:'Cannot change your own role'});
const [[target]]=await db.query('SELECT role FROM users WHERE id=?',[id]);
if(!target)return res.status(404).json({error:'User not found'});
if(target.role==='owner')return res.status(403).json({error:'Owner role is protected'});
if(req.user.role!=='owner'&&(target.role==='admin'||role==='admin'))return res.status(403).json({error:'Only owner may manage administrators'});
await db.query('UPDATE users SET role=? WHERE id=?',[role,id]);
await db.query('INSERT INTO audit_logs(actor,action,entity_id) VALUES (?,?,?)',['user:'+req.user.id,'user.role.'+role,String(id)]);
res.json({id,role});
}catch(e){next(e)}});
module.exports=router;

