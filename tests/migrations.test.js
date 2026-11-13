const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('catalog migration adds missing columns once and retains existing tables',async()=>{
 const columns={products:new Set(),categories:new Set()};const queries=[];
 const db={query:async(sql,args)=>{queries.push(sql);if(sql.includes("TABLE_NAME='users'"))return [[{COLUMN_NAME:'discord_id'}]];if(sql.includes('information_schema.COLUMNS'))return [[...columns[args[0]]].map(COLUMN_NAME=>({COLUMN_NAME}))];const change=sql.match(/^ALTER TABLE (products|categories) ADD COLUMN (\w+)/);if(change)columns[change[1]].add(change[2]);return [[]];}};
 const context={require:id=>id==='./db'?db:require(id),module:{exports:{}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/migrate.js'),'utf8'),context);
 await context.module.exports();await context.module.exports();
 assert.equal(queries.filter(q=>/^ALTER TABLE (products|categories) ADD COLUMN/.test(q)).length,3);
 assert.deepEqual([...columns.products],['image_path','revision']);assert.deepEqual([...columns.categories],['revision']);
 assert.ok(!queries.some(q=>/^(DROP|TRUNCATE|DELETE)\b/.test(q)));
});
