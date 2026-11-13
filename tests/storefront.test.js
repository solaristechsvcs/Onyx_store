const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/store.js'),'utf8');
async function page(path,{saved='[]',user=null,products=[],failure=false}={}){
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:id==='sort'?'new':'',addEventListener(){}});return nodes.get(id);};
  const calls=[];
  const context=vm.createContext({document:{getElementById:node,title:''},location:{pathname:path,search:'',assign(){},replace(){}},localStorage:{getItem:()=>saved,setItem:(k,v)=>calls.push([k,v])},URLSearchParams,Intl,FormData,setTimeout:()=>0,clearTimeout(){},fetch:async url=>{calls.push(url);if(failure)throw Error('Offline');let data=url.endsWith('/me')?{user}:url.endsWith('/categories')?[]:url==='/api/store/products'?products:products.find(p=>url.endsWith('/'+p.slug));return {ok:!!data,json:async()=>data||{error:'Product not found'}};}});
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../public/payments.js'),'utf8')+'\n'+source,context);
  for(let i=0;i<15;i++)await Promise.resolve();
  return {context,nodes,calls,html:()=>node('main').innerHTML};
}
const product={id:1,slug:'test-product',name:'<img src=x onerror=alert(1)>',description:'A useful product',price_cents:1250,currency:'USD',is_digital:1,activation_limit:1,license_duration_days:null};
test('catalog escapes database content and provides empty/search UI',async()=>{const p=await page('/products',{products:[product]});assert.match(p.nodes.get('results').innerHTML,/&lt;img/);assert.doesNotMatch(p.nodes.get('results').innerHTML,/<img/);const empty=await page('/products');assert.match(empty.nodes.get('results').innerHTML,/No products are published/);});
test('staff link is conditional for every supported role',async()=>{for(const role of ['customer','staff','admin','owner']){const p=await page('/account',{user:{display_name:'Tester',email:'test@example.com',role}});assert.equal(p.nodes.get('user-nav').innerHTML.includes('Staff Panel'),role!=='customer');}const guest=await page('/login');assert.doesNotMatch(guest.nodes.get('user-nav').innerHTML,/Staff Panel/);});
test('cart ignores stored prices and separates currencies',async()=>{const p=await page('/cart',{saved:JSON.stringify([{slug:product.slug,quantity:2,price_cents:1},{slug:'euro',quantity:1}]),products:[product,{...product,slug:'euro',currency:'EUR'}]});assert.match(p.html(),/25\.00/);assert.match(p.html(),/12\.50/);assert.match(p.html(),/button disabled>Checkout unavailable/);assert.match(p.html(),/No purchase will be made/);});
test('malformed saved cart is discarded and unavailable items remain removable',async()=>{const invalid=await page('/cart',{saved:'{"bad":true}'});assert.match(invalid.html(),/Your cart is empty/);const p=await page('/cart',{saved:'[{"slug":"removed","quantity":1}]'});assert.match(p.html(),/Product unavailable/);assert.match(p.html(),/data-remove="removed"/);});
test('adding products is bounded and persists only slug and quantity',async()=>{const p=await page('/products/test-product',{products:[product]});vm.runInContext("add('test-product');add('test-product')",p.context);const saved=p.calls.filter(Array.isArray).at(-1);assert.deepEqual(JSON.parse(saved[1]),[{slug:'test-product',quantity:2}]);assert.match(p.nodes.get('cart-link').textContent,/2/);});
test('product failures and network failures have recovery UI',async()=>{const missing=await page('/products/missing');assert.match(missing.html(),/Product not found/);const offline=await page('/products',{failure:true});assert.match(offline.html(),/Try again/);});
test('registration uses backend password constraints and Discord route',async()=>{const p=await page('/register');assert.match(p.html(),/minlength="12"/);assert.match(p.html(),/\/api\/accounts\/discord\/login/);assert.match(p.html(),/autocomplete="new-password"/);});
