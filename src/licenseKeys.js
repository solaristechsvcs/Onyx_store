'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const keyFile=path.join(__dirname,'..','.onyx-license-key');
let encryptionKey;
function storageKey(){
 if(encryptionKey)return encryptionKey;
 if(!fs.existsSync(keyFile)){const secret=crypto.randomBytes(32).toString('hex');try{fs.writeFileSync(keyFile,secret+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}}
 const encoded=fs.readFileSync(keyFile,'utf8').trim();
 if(!/^[a-f0-9]{64}$/.test(encoded))throw Error('Invalid .onyx-license-key. Restore the original key file from backup.');
 encryptionKey=Buffer.from(encoded,'hex');return encryptionKey;
}
function createCodec(keyProvider=storageKey){
 return {
  generate(){return 'ONYX-'+crypto.randomBytes(32).toString('base64url');},
  hash(value){return crypto.createHash('sha256').update(value).digest('hex');},
  encrypt(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',keyProvider(),iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return ['v1',iv.toString('hex'),cipher.getAuthTag().toString('hex'),encrypted.toString('hex')].join(':');},
  decrypt(value){if(!value)return null;const [version,iv,tag,data]=value.split(':');if(version!=='v1'||!iv||!tag||!data)throw Error('Invalid encrypted license');const decipher=crypto.createDecipheriv('aes-256-gcm',keyProvider(),Buffer.from(iv,'hex'));decipher.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(data,'hex')),decipher.final()]).toString('utf8');}
 };
}
async function initialize(db){const [[row]]=await db.query('SELECT COUNT(*) AS total FROM licenses WHERE license_secret IS NOT NULL');if(Number(row.total)>0&&!fs.existsSync(keyFile))throw Error('Missing .onyx-license-key: restore the original key file from backup before starting.');storageKey();}
module.exports={...createCodec(),createCodec,initialize};
