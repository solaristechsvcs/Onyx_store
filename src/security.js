const crypto=require('node:crypto');
const db=require('./db');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const newToken=(prefix)=>prefix+crypto.randomBytes(32).toString('base64url');
function passwordHash(password){const salt=crypto.randomBytes(16);return 'scrypt:'+salt.toString('hex')+':'+crypto.scryptSync(password,salt,64).toString('hex');}
function verifyPassword(password,encoded){try{const [alg,salt,expected]=encoded.split(':');if(alg!=='scrypt')return false;return crypto.timingSafeEqual(crypto.scryptSync(password,Buffer.from(salt,'hex'),64),Buffer.from(expected,'hex'));}catch{return false;}}
async function apiAuth(req,res,next){const token=(req.get('authorization')||'').replace(/^Bearer /i,'');if(!token)return res.status(401).json({error:'API token required'});const [[client]]=await db.query('SELECT id,name,scope FROM api_clients WHERE token_hash=? AND is_active=1',[hash(token)]);if(!client)return res.status(401).json({error:'Invalid API token'});req.apiClient=client;next();}
function requireIssue(req,res,next){if(req.apiClient.scope!=='issue')return res.status(403).json({error:'Issue permission required'});next();}
module.exports={hash,newToken,passwordHash,verifyPassword,apiAuth,requireIssue};
