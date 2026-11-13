'use strict';
// Transactional SQL-response fixture, not a MySQL emulator or production store.
const createMemoryDB=()=>{
 const db={state:{licenses:[],activations:[],logs:[],clients:[],users:[{id:7,email:'owner@example.test',display_name:'Preview customer'},{id:8,email:'other@example.test',display_name:'Other customer'}],products:[{id:1,name:'Preview toolkit',slug:'preview-toolkit',is_digital:1,is_published:1,activation_limit:2,license_duration_days:null},{id:2,name:'Physical item',is_digital:0}],orders:[{id:10,user_id:7,status:'pending'}],items:[{id:11,order_id:10,product_id:1,quantity:2}]},queries:[]};
 const n=value=>String(value);
 const publicLicense=license=>{const {license_hash,license_secret,issuance_id,...safe}=license;const p=db.state.products.find(p=>n(p.id)===n(license.product_id)),u=db.state.users.find(u=>n(u.id)===n(license.user_id));return {...safe,product_name:p.name,product_slug:p.slug,is_published:p.is_published,email:u?.email,display_name:u?.display_name,activation_count:db.state.activations.filter(a=>n(a.license_id)===n(license.id)).length};};
 db.query=async(sql,args=[])=>{
  db.queries.push({sql,args});const s=db.state;
  if(sql.startsWith('SELECT id FROM users'))return [s.users.filter(u=>n(u.id)===n(args[0]))];
  if(sql.startsWith('SELECT id,activation_limit'))return [s.products.filter(p=>n(p.id)===n(args[0])&&p.is_digital)];
  if(sql.startsWith('SELECT id,product_id,user_id FROM licenses WHERE issuance_id'))return [s.licenses.filter(l=>l.issuance_id===args[0])];
  if(sql.startsWith('SELECT * FROM licenses WHERE id'))return [s.licenses.filter(l=>n(l.id)===n(args[0]))];
  if(sql.startsWith('SELECT * FROM licenses WHERE license_hash'))return [s.licenses.filter(l=>l.license_hash===args[0])];
  if(sql.startsWith('INSERT INTO licenses')){const id=Math.max(0,...s.licenses.map(l=>Number(l.id)))+1;const [product_id,user_id,order_item_id,origin,license_prefix,license_hash,license_secret,activation_limit,expires_at,issuance_id]=args;if(issuance_id&&s.licenses.some(l=>l.issuance_id===issuance_id)){const error=Error('Duplicate');error.code='ER_DUP_ENTRY';throw error;}s.licenses.push({id,product_id,user_id,order_item_id,origin,license_prefix,license_hash,license_secret,activation_limit,expires_at,issuance_id,status:'active',revision:1,created_at:new Date().toISOString()});return [{insertId:id}];}
  if(sql.startsWith('INSERT INTO audit_logs')){s.logs.push({id:s.logs.length+1,actor:args[0],action:args[1],entity_id:args[2],created_at:new Date().toISOString()});return [{insertId:s.logs.length}];}
  if(sql.startsWith('UPDATE licenses SET license_hash')){const l=s.licenses.find(l=>n(l.id)===n(args[3]));Object.assign(l,{license_hash:args[0],license_prefix:args[1],license_secret:args[2],revision:l.revision+1});return [{affectedRows:1}];}
  if(sql.startsWith('UPDATE licenses SET status=?')){const l=s.licenses.find(l=>n(l.id)===n(args[3]));Object.assign(l,{status:args[0],activation_limit:args[1],expires_at:args[2],revision:l.revision+1});return [{affectedRows:1}];}
  if(sql.startsWith("UPDATE licenses SET status='revoked'")){const l=s.licenses.find(l=>n(l.id)===n(args[0]));l.status='revoked';l.revision++;return [{affectedRows:1}];}
  if(sql.startsWith('UPDATE licenses SET revision')){s.licenses.find(l=>n(l.id)===n(args[0])).revision++;return [{affectedRows:1}];}
  if(sql.startsWith('SELECT COUNT(*) AS total FROM license_activations')||sql.startsWith('SELECT COUNT(*) AS n FROM license_activations')){const total=s.activations.filter(a=>n(a.license_id)===n(args[0])).length;return [[{total,n:total}]];}
  if(sql.startsWith('SELECT id FROM license_activations'))return [s.activations.filter(a=>n(a.license_id)===n(args[0])&&a.installation_hash===args[1])];
  if(sql.startsWith('INSERT INTO license_activations')){const id=Math.max(0,...s.activations.map(a=>a.id))+1;s.activations.push({id,license_id:args[0],installation_hash:args[1],created_at:new Date().toISOString()});return [{insertId:id}];}
  if(sql.startsWith('DELETE FROM license_activations')){s.activations=s.activations.filter(a=>sql.includes('WHERE id=')?!(n(a.id)===n(args[0])&&n(a.license_id)===n(args[1])):!(n(a.license_id)===n(args[0])&&(!sql.includes('installation_hash')||a.installation_hash===args[1])));return [{affectedRows:1}];}
  if(sql.startsWith('SELECT o.status FROM orders')){const item=s.items.find(i=>n(i.id)===n(args[0]));return [s.orders.filter(o=>n(o.id)===n(item?.order_id)).map(o=>({status:o.status}))];}
  if(sql.startsWith('SELECT id,user_id,status FROM orders'))return [s.orders.filter(o=>n(o.id)===n(args[0]))];
  if(sql.startsWith('SELECT oi.id,oi.product_id'))return [s.items.filter(i=>n(i.order_id)===n(args[0])).map(i=>({...s.products.find(p=>n(p.id)===n(i.product_id)),...i}))];
  if(sql.startsWith('SELECT id,issuance_id FROM licenses')||sql.startsWith("SELECT id FROM licenses WHERE order_item_id"))return [s.licenses.filter(l=>n(l.order_item_id)===n(args[0])&&l.origin==='store'&&(!sql.includes("status<>'revoked'")||l.status!=='revoked'))];
  if(sql.startsWith('SELECT id,created_at FROM license_activations'))return [s.activations.filter(a=>n(a.license_id)===n(args[0])).map(a=>({id:a.id,created_at:a.created_at}))];
  if(sql.includes('FROM licenses l JOIN products p')){let rows=s.licenses.map(publicLicense);let cursor=0;if(sql.includes('WHERE l.id=?')){rows=rows.filter(l=>n(l.id)===n(args[cursor++]));}if(sql.includes('l.user_id=?')){const uid=args[cursor++];rows=rows.filter(l=>n(l.user_id)===n(uid));}if(sql.includes('p.name LIKE ?')){const term=args[cursor].replaceAll('%','').replaceAll('\\','').toLowerCase();cursor+=3;rows=rows.filter(l=>(l.product_name+' '+l.email+' '+l.license_prefix).toLowerCase().includes(term));}if(sql.includes('l.status=?')){const status=args[cursor++];rows=rows.filter(l=>l.status===status);}if(sql.startsWith('SELECT COUNT'))return [[{total:rows.length}]];if(sql.includes('LIMIT 25'))rows=rows.reverse().slice(args.at(-1),args.at(-1)+25);return [rows];}
  if(sql.startsWith('SELECT id,email,display_name FROM users WHERE'))return [s.users];
  if(sql.startsWith('SELECT id,name,is_published'))return [s.products.filter(p=>p.is_digital)];
  if(sql.startsWith('SELECT id,name,scope,is_active'))return [s.clients.map(({token_hash,...client})=>client)];
  if(sql.startsWith('SELECT id,name,scope FROM api_clients'))return [s.clients.filter(c=>c.token_hash===args[0]&&c.is_active).map(({id,name,scope})=>({id,name,scope}))];
  if(sql.startsWith('INSERT INTO api_clients')){const id=s.clients.length+1;s.clients.push({id,name:args[0],token_hash:args[1],scope:args[2],is_active:1,created_at:new Date().toISOString()});return [{insertId:id}];}
  if(sql.startsWith('UPDATE api_clients')){const client=s.clients.find(c=>n(c.id)===n(args[1]));if(!client)return [{affectedRows:0}];client.is_active=args[0];return [{affectedRows:1}];}
  throw Error('Unhandled fixture SQL: '+sql);
 };
 let tail=Promise.resolve();
 db.getConnection=async()=>{let unlock;const previous=tail;tail=new Promise(resolve=>unlock=resolve);await previous;let snapshot;return {query:db.query,beginTransaction:async()=>{snapshot=structuredClone(db.state);},commit:async()=>{},rollback:async()=>{db.state=snapshot;},release:()=>unlock()};};
 return db;
};
module.exports={createMemoryDB};
