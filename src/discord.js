const router=require('express').Router();
const crypto=require('node:crypto');
const db=require('./db');
const config=require('../config');
const {createSession}=require('./auth');
const {hash}=require('./security');
const {cookies}=require('./auth');
const dc=config.discord||{};
function callback(){return new URL('/api/accounts/discord/callback',config.server.publicUrl).toString();}
router.get('/login',async(req,res,next)=>{try{
if(!dc.clientId||!dc.clientSecret||!config.server.publicUrl)return res.status(503).json({error:'Discord login not configured'});
const state=crypto.randomBytes(32).toString('base64url');
await db.query('INSERT INTO oauth_states(state_hash,expires_at) VALUES (?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE))',[hash(state)]);
res.cookie('onyx_oauth',state,{httpOnly:true,secure:config.session.secureCookies===true,sameSite:'lax',maxAge:600000,path:'/api/accounts/discord'});
res.redirect('https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:dc.clientId,redirect_uri:callback(),response_type:'code',scope:'identify email',state}));
}catch(e){next(e)}});
router.get('/callback',async(req,res,next)=>{try{
const {code,state}=req.query;
if(typeof code!=='string'||typeof state!=='string'||state.length>200||cookies(req).onyx_oauth!==state)return res.status(400).send('Invalid OAuth response');
res.clearCookie('onyx_oauth',{path:'/api/accounts/discord'});
const [removed]=await db.query('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>UTC_TIMESTAMP()',[hash(state)]);
if(!removed.affectedRows)return res.status(400).send('Invalid or expired OAuth state');
const response=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:dc.clientId,client_secret:dc.clientSecret,grant_type:'authorization_code',code,redirect_uri:callback()}),signal:AbortSignal.timeout(10000)});
if(!response.ok)return res.status(502).send('Discord token exchange failed');
const tokens=await response.json();
const userResponse=await fetch('https://discord.com/api/users/@me',{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(10000)});
if(!userResponse.ok)return res.status(502).send('Discord profile unavailable');
const profile=await userResponse.json();
if(!/^\d{15,25}$/.test(profile.id))return res.status(400).send('Invalid Discord identity');
let [[user]]=await db.query('SELECT id FROM users WHERE discord_id=?',[profile.id]);
if(!user){
const email=profile.verified&&profile.email?profile.email.trim().toLowerCase():null;
if(!email)return res.status(403).send('A verified Discord email is required');
const [[existing]]=await db.query('SELECT id FROM users WHERE email=?',[email]);
if(existing)return res.status(409).send('An account with this email exists. Sign in with your site account first; account linking will be added separately.');
const [result]=await db.query('INSERT INTO users(email,password_hash,display_name,discord_id) VALUES (?,?,?,?)',[email,null,(profile.global_name||profile.username||'Discord User').slice(0,120),profile.id]);
user={id:result.insertId};
}
await createSession(res,user.id);res.redirect('/');
}catch(e){next(e)}});
module.exports=router;
