'use strict';
// One-time recovery for deployments uploaded without Git metadata.
// Run from Wisp with: node scripts/repair-git.js
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function repair(){
  if(fs.existsSync(path.join(root,'.git'))){console.log('[repair] Git metadata already exists. No files changed; run node scripts/update.js for normal updates.');return;}
  const git=(args,options={})=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,...options});
  git(['--version']);
  const stage=fs.mkdtempSync(path.join(root,'.onyx-install-'));
  const checkout=path.join(stage,'checkout');
  console.log('[repair] Downloading main from solaristechsvcs/Onyx_store…');
  git(['clone','--branch','main','--single-branch','https://github.com/solaristechsvcs/Onyx_store.git',checkout]);
  const files=git(['ls-files','-z'],{cwd:checkout}).split('\0').filter(Boolean);
  // Never adopt a checkout containing deployment secrets or dependencies.
  for(const file of files){
    if(file.split('/').some(part=>['config.js','.onyx-license-key','.env','node_modules','.git','.onyx-recovery'].includes(part))||file.startsWith('.onyx-install-'))throw Error('Refusing protected repository path: '+file);
    const source=path.join(checkout,file);
    if(!fs.lstatSync(source).isFile())throw Error('Refusing non-regular repository file: '+file);
    const target=path.join(root,file);
    let ancestor=target;
    while(ancestor!==root){
      if(fs.existsSync(ancestor)){
        const stat=fs.lstatSync(ancestor);
        if(stat.isSymbolicLink()||(ancestor===target?!stat.isFile():!stat.isDirectory()))throw Error('Unsafe deployment path: '+file);
      }
      ancestor=path.dirname(ancestor);
    }
  }
  const recovery=path.join(root,'.onyx-recovery');
  if(fs.existsSync(recovery)&&(fs.lstatSync(recovery).isSymbolicLink()||!fs.lstatSync(recovery).isDirectory()))throw Error('Unsafe recovery directory');
  const backup=path.join(recovery,path.basename(stage));
  fs.mkdirSync(backup,{recursive:true});
  const manifest=files.map(file=>({file,existed:fs.existsSync(path.join(root,file))}));
  // Finish all backups before replacing any application files.
  for(const {file,existed} of manifest)if(existed){const destination=path.join(backup,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,file),destination);}
  fs.writeFileSync(path.join(backup,'recovery-manifest.json'),JSON.stringify(manifest,null,2));
  console.log('[repair] Backups saved in '+backup);
  try{
    for(const file of files){const destination=path.join(root,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(checkout,file),destination);}
    // Metadata is installed last, only after application files are in place.
    fs.renameSync(path.join(checkout,'.git'),path.join(root,'.git'));
  }catch(error){
    for(const {file,existed} of manifest){const destination=path.join(root,file);if(existed)fs.copyFileSync(path.join(backup,file),destination);else if(fs.existsSync(destination))fs.unlinkSync(destination);}
    throw error;
  }
  console.log('[repair] Git checkout restored at '+git(['rev-parse','--short','HEAD']).trim()+'. config.js and untracked application data were preserved.');
  console.log('[repair] Restore normal Wisp startup: node scripts/update.js && npm install && node server.js');
  console.log('[repair] Temporary checkout retained at '+stage+'; backups are retained for recovery.');
}
if(require.main===module){try{repair();}catch(error){console.error('[repair] Failed: '+error.message);process.exitCode=1;}}
module.exports=repair;
