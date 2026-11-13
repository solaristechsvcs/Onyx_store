const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
test('repair preserves config/data and backs up overwritten code before adopting Git',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onyx-repair-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'config.js'),'private config');
  fs.writeFileSync(path.join(root,'server.js'),'old server');
  fs.writeFileSync(path.join(root,'customer-data.txt'),'retain');
  const mockExec=(command,args)=>{
    if(args[0]==='--version')return 'git version test';
    if(args[0]==='clone'){const checkout=args.at(-1);fs.mkdirSync(path.join(checkout,'.git'),{recursive:true});fs.writeFileSync(path.join(checkout,'server.js'),'new server');fs.writeFileSync(path.join(checkout,'new.js'),'new file');return '';}
    if(args[0]==='ls-files')return 'server.js\0new.js\0';
    return 'abc1234';
  };
  const context={require:id=>id==='node:child_process'?{execFileSync:mockExec}:require(id),module:{exports:{}},__dirname:path.join(root,'scripts'),console:{log(){},error(){}}};
  vm.runInNewContext(read('scripts/repair-git.js'),context);context.module.exports();
  assert.equal(fs.readFileSync(path.join(root,'config.js'),'utf8'),'private config');
  assert.equal(fs.readFileSync(path.join(root,'customer-data.txt'),'utf8'),'retain');
  assert.equal(fs.readFileSync(path.join(root,'server.js'),'utf8'),'new server');
  assert.ok(fs.existsSync(path.join(root,'.git')));
  const backup=path.join(root,'.onyx-recovery',fs.readdirSync(path.join(root,'.onyx-recovery'))[0]);
  assert.equal(fs.readFileSync(path.join(backup,'server.js'),'utf8'),'old server');
  context.module.exports(); // Existing Git is a no-op.
});
test('repair refuses a repository that would overwrite local secrets',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onyx-secret-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'config.js'),'secret');
  const context={require:id=>id==='node:child_process'?{execFileSync:(_cmd,args)=>args[0]==='ls-files'?'config.js\0':''}:require(id),module:{exports:{}},__dirname:path.join(root,'scripts'),console:{log(){}}};
  vm.runInNewContext(read('scripts/repair-git.js'),context);
  assert.throws(()=>context.module.exports(),/protected repository path/);
  assert.equal(fs.readFileSync(path.join(root,'config.js'),'utf8'),'secret');
  assert.equal(fs.existsSync(path.join(root,'.git')),false);
});
async function updater({dirty=false,diverged=false}={}){
  const calls=[];const local='a'.repeat(40),remote='b'.repeat(40);
  function spawn(_command,args){calls.push(args);const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();queueMicrotask(()=>{let out='';switch(args[0]){case 'status':out=dirty?' M server.js':'';break;case 'branch':out='release';break;case 'remote':out='https://github.com/solaristechsvcs/Onyx_store.git';break;case 'rev-parse':out=args[1]==='HEAD'?local:remote;break;case 'merge-base':out=diverged?'c'.repeat(40):local;break;}child.stdout.emit('data',out);child.emit('close',0);});return child;}
  const context={require:id=>id==='node:child_process'?{spawn}:id==='node:fs'?{existsSync:()=>true}:require(id),module:{exports:{}},__dirname:path.join(__dirname,'../scripts'),process:{env:{}},console:{log(){}}};
  vm.runInNewContext(read('scripts/update.js'),context);
  const result=await context.module.exports({config:{updater:{branch:'release'}}});return {calls,result};
}
test('updater respects configured branch and merges only a fast-forward',async()=>{const p=await updater();assert.equal(p.result.status,'updated');assert.ok(p.calls.some(args=>args.join(' ')==='fetch --no-tags origin release'));assert.ok(p.calls.some(args=>args[0]==='merge'&&args[1]==='--ff-only'));});
test('updater protects local edits and diverged history',async()=>{for(const options of [{dirty:true},{diverged:true}]){const p=await updater(options);assert.equal(p.result.status,'skipped');assert.equal(p.calls.some(args=>args[0]==='merge'),false);}});
test('watcher applies updates immediately, then requests restart only after changes',async()=>{
  for(const status of ['updated','current','skipped']){let updates=0,exits=0;const context={require:id=>id==='node:fs'?{existsSync:()=>true}:id==='../scripts/update'?async()=>{updates++;return {status};}:require(id),module:{exports:{}},__dirname:path.join(__dirname,'../src'),setInterval:()=>({unref(){}}),process:{exit:()=>exits++},console:{log(){},warn(){},error(){}}};vm.runInNewContext(read('src/updateWatcher.js'),context);context.module.exports({updater:{enabled:true,checkIntervalMinutes:5}});await new Promise(resolve=>setImmediate(resolve));assert.equal(updates,1);assert.equal(exits,status==='updated'?1:0);}
});
