'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'..');
function git(args){return new Promise((resolve,reject)=>{const p=spawn('git',args,{cwd:root,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',c=>c===0?resolve(out.trim()):reject(new Error(err.trim())));});}
function startWatcher(config){
if(config.updater?.enabled!==true)return;
if(!fs.existsSync(path.join(root,'.git'))){console.warn('[updater] Auto-check disabled: deployment is not a Git clone');return;}
const minutes=Number(config.updater.checkIntervalMinutes||15);
if(!Number.isFinite(minutes)||minutes<5){console.warn('[updater] Check interval must be at least 5 minutes');return;}
let running=false;
const check=async()=>{if(running)return;running=true;try{
const branch=config.updater.branch||'main';
if(!/^[a-zA-Z0-9._/-]+$/.test(branch)||branch.includes('..'))throw Error('Invalid branch');
const currentBranch=await git(['branch','--show-current']);
if(currentBranch!==branch)return;
const dirty=await git(['status','--porcelain','--untracked-files=no']);
if(dirty){console.warn('[updater] Tracked files modified; auto-restart skipped');return;}
const origin=await git(['remote','get-url','origin']);
if(!/^(https:\/\/github\.com\/solaristechsvcs\/Onyx_store(?:\.git)?|git@github\.com:solaristechsvcs\/Onyx_store(?:\.git)?)$/i.test(origin))return;
const local=await git(['rev-parse','HEAD']);
const remote=await git(['ls-remote','origin','refs/heads/'+branch]);
const sha=remote.split(/\s+/)[0];
if(!/^[a-f0-9]{40}$/.test(sha))throw Error('Unable to read remote branch');
if(sha!==local){console.log('[updater] New commit detected; exiting for Wisp restart and startup update');process.exit(0);}
}catch(e){console.error('[updater] Check failed: '+e.message);}finally{running=false;}};
const timer=setInterval(check,minutes*60000);timer.unref();
console.log('[updater] Checking GitHub every '+minutes+' minutes; Wisp auto-restart must be enabled');
}
module.exports=startWatcher;
