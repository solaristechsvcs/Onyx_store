'use strict';
// Safe startup updater for a Git-cloned Wisp deployment.
// Never overwrites local tracked edits, never force-resets, never touches ignored config.js.
const {spawn}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:root,stdio:['ignore','pipe','pipe'],shell:false});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>code===0?resolve(stdout.trim()):reject(new Error(command+' '+args.join(' ')+' failed: '+stderr.trim())));});}
async function update(options={}){
const fs=require('node:fs');
if(!fs.existsSync(path.join(root,'.git'))){console.log('[updater] No .git directory: skipped (deploy with git clone for updates)');return {status:'skipped'};}
const config=options.config||(fs.existsSync(path.join(root,'config.js'))?require(path.join(root,'config.js')):{});
const branch=process.env.ONYX_UPDATE_BRANCH||config.updater?.branch||'main';
if(!/^[a-zA-Z0-9._/-]+$/.test(branch)||branch.includes('..'))throw Error('Invalid update branch');
const remote=process.env.ONYX_UPDATE_REMOTE||'origin';
if(!/^[a-zA-Z0-9._-]+$/.test(remote))throw Error('Invalid update remote');
const status=await run('git',['status','--porcelain','--untracked-files=no']);
if(status){console.log('[updater] Tracked files have local changes; skipping to protect your work');return {status:'skipped'};}
const currentBranch=await run('git',['branch','--show-current']);
if(currentBranch!==branch){console.log('[updater] Current branch is '+currentBranch+'; expected '+branch+'. Skipping');return {status:'skipped'};}
const remoteUrl=await run('git',['remote','get-url',remote]);
if(!/^(https:\/\/github\.com\/solaristechsvcs\/Onyx_store(?:\.git)?|git@github\.com:solaristechsvcs\/Onyx_store(?:\.git)?)$/i.test(remoteUrl)){console.log('[updater] Unexpected remote repository; refusing update');return {status:'skipped'};}
await run('git',['fetch','--no-tags',remote,branch]);
const oldSha=await run('git',['rev-parse','HEAD']);
const nextSha=await run('git',['rev-parse','FETCH_HEAD']);
if(oldSha===nextSha){console.log('[updater] Already up to date: '+oldSha.slice(0,8));return {status:'current'};}
const ancestor=await run('git',['merge-base',oldSha,nextSha]);
if(ancestor!==oldSha){console.log('[updater] Branch diverged; refusing non-fast-forward update');return {status:'skipped'};}
await run('git',['merge','--ff-only',nextSha]);
console.log('[updater] Updated '+oldSha.slice(0,8)+' -> '+nextSha.slice(0,8));
return {status:'updated',oldSha,nextSha};
}
if(require.main===module)update().catch(e=>{console.error('[updater] '+e.message);process.exitCode=1;});
module.exports=update;
