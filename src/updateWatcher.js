'use strict';
const fs=require('node:fs');
const path=require('node:path');
const update=require('../scripts/update');
const root=path.resolve(__dirname,'..');
function startWatcher(config){
if(config.updater?.enabled!==true){console.log('[updater] Automatic checks disabled; startup updates still run when included in the Wisp startup command');return;}
if(!fs.existsSync(path.join(root,'.git'))){console.warn('[updater] Automatic updates unavailable: deployment is not a Git clone. Check for /home/container/.git');return;}
const minutes=Number(config.updater.checkIntervalMinutes??15);
if(!Number.isFinite(minutes)||minutes<5){console.warn('[updater] Check interval must be at least 5 minutes');return;}
let running=false;
const check=async()=>{
if(running)return;
running=true;
try{
const result=await update({config});
if(result?.status==='updated'){
console.log('[updater] New files downloaded. Exiting for Wisp restart; enable automatic restart and keep npm install in the startup command.');
process.exit(0);
}
}catch(e){console.error('[updater] Update failed: '+e.message);}
finally{running=false;}
};
const timer=setInterval(check,minutes*60000);timer.unref();
console.log('[updater] Applying safe updates now and every '+minutes+' minutes; Wisp must restart the process after an update');
void check();
}
module.exports=startWatcher;
