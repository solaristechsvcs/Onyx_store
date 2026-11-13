const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('worker processes recorded orders, advances past failures, wraps and stops',async()=>{
 const batches=[[{id:10}],[{id:20}],[],[{id:10}]];const cursors=[],fulfilled=[];let interval,cleared=false;
 const db={query:async(sql,args)=>{assert.match(sql,/o\.status='paid'/);assert.match(sql,/refunded/);cursors.push(args[0]);return [batches.shift()||[]];}};
 const context={module:{exports:{}},require:id=>id==='./licenseService'?{createService:()=>({fulfillOrder:async id=>{fulfilled.push(id);if(id===10)throw Error('Temporary order error');}})}:require(id),setInterval:callback=>{interval=callback;return {unref(){}};},clearInterval:()=>cleared=true,console:{error(){}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/licenseFulfillment.js'),'utf8'),context);
 const stop=context.module.exports(db);await new Promise(resolve=>setImmediate(resolve));await interval();await interval();await interval();
 assert.deepEqual(cursors,[0,10,20,0]);assert.deepEqual(fulfilled,[10,20,10]);stop();await interval();assert.equal(cleared,true);assert.equal(cursors.length,4);
});
