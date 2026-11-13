const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/staff.js'),'utf8');
async function workspace(role='owner'){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',hidden:true,addEventListener(){}});return nodes.get(id);};
 const context=vm.createContext({document:{getElementById:node,querySelectorAll:()=>[],addEventListener(){}},location:{hash:'',pathname:'/staff'},window:{addEventListener(){}},setTimeout:()=>0,clearTimeout(){},URLSearchParams,Intl,FormData,confirm:()=>true,fetch:async endpoint=>({ok:true,json:async()=>endpoint==='/api/accounts/me'?{user:role?{id:1,role,display_name:'<Owner>'}:null}:{products:3,published:2,categories:1,users:5}})});
 vm.runInContext(source,context);for(let i=0;i<20;i++)await Promise.resolve();return {nodes,context};
}
test('opening /staff without a hash loads the overview',async()=>{const w=await workspace();assert.match(w.nodes.get('content').innerHTML,/Store overview/);assert.doesNotMatch(w.nodes.get('content').innerHTML,/Page not found/);});
test('staff UI offers read-only access and unauthenticated users get sign-in',async()=>{const staff=await workspace('staff');assert.match(staff.nodes.get('content').innerHTML,/read-only catalog access/);assert.equal(staff.nodes.get('audit-link').hidden,true);const guest=await workspace(null);assert.match(guest.nodes.get('content').innerHTML,/Staff access required/);});
test('editor converts exact decimals without float rounding or scientific notation',async()=>{const w=await workspace();for(const [amount,cents] of [['0',0],['0.29',29],['12.3',1230],['42949672.95',4294967295]])assert.equal(vm.runInContext('parseCents('+JSON.stringify(amount)+')',w.context),cents);for(const amount of ['-1','1.005','1e2','42949672.96'])assert.throws(()=>vm.runInContext('parseCents('+JSON.stringify(amount)+')',w.context));});
test('staff markup escapes stored text and rejects external image paths',async()=>{const w=await workspace();assert.equal(vm.runInContext('esc("<script>")',w.context),'&lt;script&gt;');assert.equal(vm.runInContext('imageOk("https://example.test/x.png")',w.context),false);});
