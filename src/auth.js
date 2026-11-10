const crypto=require('node:crypto');
const db=require('./db');
const config=require('../config');
const {hash}=require('./security');
const cookieName='onyx_session';
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=').map(decodeURIComponent)).filter(p=>p.length===2));}
function setCookie(res,token){res.cookie(cookieName,token,{httpOnly:true,secure:config.session.secureCookies===true,sameSite:'lax',path:'/',maxAge:7*86400000});}
async function createSession(res,userId){const token=crypto.randomBytes(32).toString('base64url');await db.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 7 DAY))',[hash(token),userId]);setCookie(res,token);}
async function currentUser(req,res,next){try{const token=cookies(req)[cookieName];if(!token)return next();const [[u]]=await db.query('SELECT u.id,u.email,u.display_name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP()',[hash(token)]);req.user=u||null;next();}catch(e){next(e);}}
function signedIn(req,res,next){if(!req.user)return res.status(401).json({error:'Login required'});next();}
function staff(req,res,next){if(!req.user||!['staff','admin','owner'].includes(req.user.role))return res.status(403).json({error:'Staff access required'});next();}
function admin(req,res,next){if(!req.user||!['admin','owner'].includes(req.user.role))return res.status(403).json({error:'Admin access required'});next();}
module.exports={cookies,cookieName,createSession,currentUser,signedIn,staff,admin};
