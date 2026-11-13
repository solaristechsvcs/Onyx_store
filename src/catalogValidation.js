'use strict';
function invalid(message,status=400){const error=new Error(message);error.status=status;throw error;}
function id(value,label='ID'){const s=String(value??'');if(!/^[1-9]\d{0,14}$/.test(s))invalid('Invalid '+label);return s;}
function text(value,label,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))invalid(label+' is required and must be at most '+max+' characters');return value.trim();}
function slug(value,max){if(typeof value!=='string'||value.length>max||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))invalid('URL slug must contain lowercase letters, numbers and single hyphens');return value;}
function integer(value,label,min,max){if(!Number.isInteger(value)||value<min||value>max)invalid(label+' must be a whole number from '+min+' to '+max);return value;}
function boolean(value,label){if(typeof value!=='boolean')invalid(label+' must be true or false');return value;}
const imagePattern=/^\/media\/products\/[a-f0-9]{48}\.(?:png|jpg|webp)$/;
function product(body){
 if(!body||Array.isArray(body))invalid('Product details required');
 const name=text(body.name,'Product name',180,true),description=text(body.description??'','Description',16000);
 if(body.is_published&&!description)invalid('Add a description before publishing');
 const currency=typeof body.currency==='string'?body.currency.toUpperCase():'';
 // The current schema stores cents. Only currencies with two minor-unit digits are accepted.
 if(!['USD','EUR','GBP','CAD','AUD','NZD','CHF','SEK','NOK','DKK','PLN','CZK','BRL','MXN','INR','SGD','HKD','ZAR'].includes(currency))invalid('Choose a supported currency');
 if(!Array.isArray(body.category_ids)||body.category_ids.length>100)invalid('Select at most 100 categories');
 const category_ids=[...new Set(body.category_ids.map(value=>id(value,'category')))];
 const image_path=body.image_path||null;
 if(image_path!==null&&(typeof image_path!=='string'||!imagePattern.test(image_path)))invalid('Choose an uploaded product image');
 return {name,slug:slug(body.slug,190),description,price_cents:integer(body.price_cents,'Price in cents',0,4294967295),currency,is_digital:boolean(body.is_digital,'Digital product'),activation_limit:integer(body.activation_limit,'Activation limit',1,1000000),license_duration_days:body.license_duration_days===null?null:integer(body.license_duration_days,'License duration',1,365000),is_published:boolean(body.is_published,'Published'),image_path,category_ids};
}
function category(body){if(!body||Array.isArray(body))invalid('Category details required');return {name:text(body.name,'Category name',150,true),slug:slug(body.slug,160),description:text(body.description??'','Description',8000),parent_id:body.parent_id===null?null:id(body.parent_id,'parent category'),sort_order:integer(body.sort_order,'Sort order',-1000000,1000000),is_visible:boolean(body.is_visible,'Visible')};}
function parentCheck(categories,currentId,parentId){const byId=new Map(categories.map(c=>[String(c.id),c]));const visited=new Set(currentId?[String(currentId)]:[]);let cursor=parentId;if(cursor&&!byId.has(String(cursor)))invalid('Parent category not found');while(cursor){if(visited.has(String(cursor)))invalid('A category cannot be placed inside itself or its descendants');visited.add(String(cursor));cursor=byId.get(String(cursor))?.parent_id;}}
module.exports={invalid,id,integer,product,category,parentCheck,imagePattern};
