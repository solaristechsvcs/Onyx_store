'use strict';
const crypto=require('node:crypto');
const {id,invalid}=require('../catalogValidation');
const {cents}=require('./providers');
function normalizeItems(items){if(!Array.isArray(items)||!items.length||items.length>50)invalid('Checkout requires 1–50 products');const seen=new Set();return items.map(item=>{if(!item||typeof item.slug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)||item.slug.length>190||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99||seen.has(item.slug))invalid('Invalid or duplicate cart item');seen.add(item.slug);return {slug:item.slug,quantity:item.quantity};}).sort((a,b)=>a.slug.localeCompare(b.slug));}
function createPaymentService(db,config,providers,licenses){
 const audit=(conn,action,orderId)=>conn.query('INSERT INTO audit_logs(actor,action,entity_id) VALUES (?,?,?)',['system:payments',action,String(orderId)]);
 async function transaction(fn){const conn=await db.getConnection();try{await conn.beginTransaction();const result=await fn(conn);await conn.commit();return result;}catch(error){await conn.rollback();throw error;}finally{conn.release();}}
 async function find(orderId,userId){const args=[id(orderId,'order')];let sql='SELECT * FROM orders WHERE id=?';if(userId!==undefined){sql+=' AND user_id=?';args.push(userId);}const [[order]]=await db.query(sql,args);if(!order)invalid('Order not found',404);return order;}
 async function itemsFor(orderId){const [items]=await db.query('SELECT oi.*,COALESCE(oi.product_name,p.name) AS name,COALESCE(oi.product_slug,p.slug) AS slug FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=? ORDER BY oi.id',[orderId]);return items;}
 async function fulfill(order){if(!['paid','refunded','cancelled'].includes(order.status))return;try{await licenses.fulfillOrder(order.id);}catch{console.error('[payments] License reconciliation pending for order '+order.id);}}
 async function apply(proof,event){
  const result=await transaction(async conn=>{
   const [[order]]=await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE',[id(proof.orderId,'order')]);if(!order)invalid('Order not found',404);
   if(order.payment_mode&&order.payment_mode!==config.mode)invalid('Payment environment did not match',409);
   if(order.provider!==proof.provider||order.currency!==proof.currency||order.total_cents!==proof.amountCents)invalid('Provider order amount, currency or identity did not match',409);
   if(proof.reference&&order.provider_payment_id&&order.provider_payment_id!==proof.reference)invalid('Provider payment reference did not match',409);
   if(proof.captureId&&order.provider_capture_id&&order.provider_capture_id!==proof.captureId)invalid('Provider capture did not match',409);
   if(proof.refundedCents!==undefined&&(!Number.isSafeInteger(proof.refundedCents)||proof.refundedCents<0||proof.refundedCents>order.total_cents))invalid('Provider refund amount did not match',409);
   if(event){const [[existing]]=await conn.query('SELECT event_id FROM payment_events WHERE provider=? AND event_id=?',[proof.provider,event.id]);if(existing)return order;}
   let status=order.status,state=order.payment_state;
   const blocked=['refunded','reversed','disputed'].includes(state)||order.status==='refunded';
   if(proof.state==='refunded'){status='refunded';state='refunded';}
   else if(['reversed','disputed'].includes(proof.state)){status='cancelled';state=proof.state;}
   else if(!blocked&&['paid','partially_refunded'].includes(proof.state)){status='paid';state=proof.state==='partially_refunded'||state==='partially_refunded'?'partially_refunded':'paid';}
   else if(!blocked&&status!=='paid'&&['failed','expired'].includes(proof.state)){status='cancelled';state=proof.state;}
   const refunded=Math.max(order.payment_refunded_cents||0,proof.state==='refunded'?order.total_cents:proof.refundedCents||0);
   const reference=order.provider_payment_id||proof.reference||null,capture=order.provider_capture_id||proof.captureId||null;
   await conn.query('UPDATE orders SET status=?,payment_state=?,provider_payment_id=?,provider_capture_id=?,payment_refunded_cents=?,paid_at=? WHERE id=?',[status,state,reference,capture,refunded,order.paid_at||(status==='paid'?new Date():null),order.id]);
   if(status!==order.status||state!==order.payment_state)await audit(conn,'payment.'+proof.provider+'.'+state,order.id);
   if(event)await conn.query('INSERT INTO payment_events(provider,event_id,event_type,order_id) VALUES (?,?,?,?)',[proof.provider,event.id,event.type,order.id]);
   return {...order,status,payment_state:state,provider_payment_id:reference,provider_capture_id:capture,payment_refunded_cents:refunded};
  });await fulfill(result);return result;
 }
 async function create(userId,body){
  if(!config.enabled)invalid('Checkout is not enabled',503);
  const items=normalizeItems(body?.items),provider=body?.provider,requestId=body?.requestId;
  if(typeof requestId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(requestId))invalid('Invalid checkout request ID');
  if(!['stripe','paypal','free'].includes(provider))invalid('Select a payment provider');
  const hash=crypto.createHash('sha256').update(JSON.stringify({provider,items})).digest('hex');
  const order=await transaction(async conn=>{
   const [[user]]=await conn.query('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);if(!user)invalid('Login required',401);
   const [[existing]]=await conn.query('SELECT * FROM orders WHERE checkout_request_id=?',[requestId]);if(existing){if(String(existing.user_id)!==String(userId))invalid('Order not found',404);if(existing.cart_hash!==hash)invalid('This checkout request belongs to a different cart',409);return existing;}
   const [products]=await conn.query('SELECT id,name,slug,price_cents,currency,is_digital,activation_limit,license_duration_days FROM products WHERE is_published=1 AND slug IN ('+items.map(()=>'?').join(',')+')',items.map(item=>item.slug));
   if(products.length!==items.length)invalid('A product is no longer available. Refresh your cart.',409);
   const currencies=new Set(products.map(p=>p.currency));if(currencies.size!==1)invalid('Checkout supports one currency per order. Split mixed-currency carts.');
   const currency=products[0].currency;let total=0;
   for(const product of products){if(!product.is_digital)invalid('Physical-product checkout is not configured. Remove physical items.');if(!Number.isSafeInteger(product.price_cents)||product.price_cents<0)invalid('Invalid product price');total+=product.price_cents*items.find(i=>i.slug===product.slug).quantity;}
   if(!Number.isSafeInteger(total)||total>config.maxTotalCents)invalid('Order exceeds the checkout amount limit');
   if(total===0){if(provider!=='free'||!config.allowFreeOrders)invalid('Choose the free-order option for this cart');}
   else if(provider==='free'||!config.ready.includes(provider)||!config.currencies[provider].includes(currency))invalid('This payment provider is not available for this currency');
   const [insert]=await conn.query('INSERT INTO orders(user_id,status,total_cents,currency,provider,checkout_request_id,cart_hash,payment_mode,payment_state) VALUES (?,"pending",?,?,?,?,?,?,"creating")',[userId,total,currency,provider,requestId,hash,config.mode]);
   for(const product of products){const quantity=items.find(i=>i.slug===product.slug).quantity;await conn.query('INSERT INTO order_items(order_id,product_id,quantity,unit_price_cents,product_name,product_slug,is_digital,activation_limit,license_duration_days) VALUES (?,?,?,?,?,?,?,?,?)',[insert.insertId,product.id,quantity,product.price_cents,product.name,product.slug,product.is_digital,product.activation_limit,product.license_duration_days]);}
   await audit(conn,'payment.checkout.created',insert.insertId);return {id:insert.insertId,user_id:userId,status:'pending',total_cents:total,currency,provider,checkout_request_id:requestId,cart_hash:hash,payment_mode:config.mode,payment_state:'creating'};
  });
  if(order.status==='paid')return {orderId:String(order.id),url:config.publicUrl+'/checkout?order='+order.id};
  if(['refunded','cancelled'].includes(order.status))invalid('This checkout is closed. Start a new checkout attempt.',409);
  if(order.provider==='free'){await apply({orderId:order.id,provider:'free',reference:'free_'+order.id,state:'paid',amountCents:0,currency:order.currency});return {orderId:String(order.id),url:config.publicUrl+'/checkout?order='+order.id};}
  if(order.checkout_url&&order.provider_payment_id)return {orderId:String(order.id),url:order.checkout_url};
  const result=await providers[order.provider].create(order,await itemsFor(order.id));
  if(typeof result.id!=='string'||!result.id||result.id.length>191)invalid('Invalid provider checkout reference',502);
  await transaction(async conn=>{const [[current]]=await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE',[order.id]);if(current.provider_payment_id&&current.provider_payment_id!==result.id)invalid('Checkout reference conflict',409);await conn.query('UPDATE orders SET provider_payment_id=?,checkout_url=?,payment_state=? WHERE id=?',[result.id,result.url,current.payment_state==='creating'?'awaiting':current.payment_state,order.id]);});
  return {orderId:String(order.id),url:result.url};
 }
 function stripeProof(order,session){
  if(session.id!==order.provider_payment_id&&order.provider_payment_id)invalid('Stripe session did not match',409);
  if(session.mode!=='payment'||session.livemode!==(config.mode==='live')||String(session.client_reference_id)!==String(order.id)||String(session.metadata?.order_id)!==String(order.id))invalid('Stripe session identity did not match',409);
  const state=session.status==='complete'&&session.payment_status==='paid'?'paid':session.status==='expired'?'expired':'pending';
  const captureId=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
  if(state==='paid'&&!captureId)invalid('Stripe payment intent is missing',502);
  return {orderId:order.id,provider:'stripe',reference:session.id,captureId,state,amountCents:session.amount_total,currency:String(session.currency).toUpperCase()};
 }
 function paypalOrderCheck(order,data){const units=data.purchase_units;if(data.intent!=='CAPTURE'||units?.length!==1||String(units[0].custom_id)!==String(order.id)||cents(units[0].amount?.value)!==order.total_cents||units[0].amount.currency_code!==order.currency||data.id!==order.provider_payment_id&&order.provider_payment_id)invalid('PayPal order identity or amount did not match',409);if(config.paypal.merchantId&&units[0].payee?.merchant_id!==config.paypal.merchantId)invalid('PayPal merchant did not match',409);return units[0];}
 async function paypalProof(order,data,captureApproved=false){let unit=paypalOrderCheck(order,data);if(data.status==='APPROVED'&&captureApproved){data=await providers.paypal.capture(data.id);unit=paypalOrderCheck(order,data);}const captures=unit.payments?.captures||[];if(captures.length>1)invalid('Multiple PayPal captures require review',409);if(!captures.length)return {orderId:order.id,provider:'paypal',reference:data.id,state:data.status==='VOIDED'?'expired':'pending',amountCents:order.total_cents,currency:order.currency};const capture=await providers.paypal.getCapture(captures[0].id);if(config.paypal.merchantId&&capture.payee?.merchant_id&&capture.payee.merchant_id!==config.paypal.merchantId)invalid('PayPal merchant did not match',409);return {orderId:order.id,provider:'paypal',reference:data.id,captureId:capture.id,state:({COMPLETED:'paid',REFUNDED:'refunded',PARTIALLY_REFUNDED:'partially_refunded',DECLINED:'failed',FAILED:'failed',DENIED:'failed'})[capture.status]||'pending',amountCents:cents(capture.amount?.value),currency:capture.amount?.currency_code};}
 async function refresh(orderId,userId,captureApproved=false){const order=await find(orderId,userId);if(order.payment_mode&&order.payment_mode!==config.mode)invalid('This order belongs to a different payment environment.',409);if(order.provider==='free')return order;if(!order.provider_payment_id)invalid('Checkout is still being created. Retry shortly.',409);if(!config[order.provider]?.ready)invalid('Payment verification is not configured for this provider',503);const proof=order.provider==='stripe'?stripeProof(order,await providers.stripe.getSession(order.provider_payment_id)):await paypalProof(order,await providers.paypal.getOrder(order.provider_payment_id),captureApproved);return apply(proof);}
 async function detail(orderId,userId){const order=await find(orderId,userId),items=await itemsFor(order.id);const [[{total}]]=await db.query("SELECT COUNT(*) AS total FROM licenses l JOIN order_items oi ON oi.id=l.order_item_id WHERE oi.order_id=? AND l.origin='store'",[order.id]);return {id:String(order.id),status:order.status,mode:order.payment_mode,paymentState:order.payment_state,provider:order.provider,totalCents:order.total_cents,currency:order.currency,refundedCents:order.payment_refunded_cents||0,createdAt:order.created_at,paidAt:order.paid_at,checkoutUrl:order.status==='pending'?order.checkout_url:null,items:items.map(i=>({name:i.name,slug:i.slug,quantity:i.quantity,unitPriceCents:i.unit_price_cents})),licensesReady:Number(total)>=items.reduce((n,i)=>n+(i.is_digital?i.quantity:0),0)};}
 async function list(userId,page=1){if(!Number.isInteger(page)||page<1||page>1000000)invalid('Invalid page');const args=userId===undefined?[]:[userId],where=userId===undefined?'':' WHERE user_id=?';const [[{total}]]=await db.query('SELECT COUNT(*) AS total FROM orders'+where,args);const [rows]=await db.query('SELECT id,status,payment_state,payment_mode,provider,total_cents,currency,created_at,paid_at FROM orders'+where+' ORDER BY id DESC LIMIT 25 OFFSET ?',[...args,(page-1)*25]);return {items:rows,total:Number(total),page,pageSize:25};}
 async function webhook(provider,raw,headers){
  const event=provider==='stripe'?providers.stripe.verify(raw,headers['stripe-signature']):await providers.paypal.verify(raw,headers);
  if(!event||typeof event.id!=='string'||event.id.length>191)invalid('Invalid webhook event',400);
  const type=provider==='stripe'?event.type:event.event_type;if(typeof type!=='string'||type.length>150)invalid('Invalid webhook type',400);
  const [[seen]]=await db.query('SELECT event_id FROM payment_events WHERE provider=? AND event_id=?',[provider,event.id]);if(seen)return {received:true,duplicate:true};
  let order,proof;
  if(provider==='stripe'){
   if(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'].includes(type)){const session=await providers.stripe.getSession(event.data?.object?.id);const orderId=session.metadata?.order_id;if(!orderId)return {received:true,ignored:true};order=await find(orderId);proof=stripeProof(order,session);if(type==='checkout.session.async_payment_failed'&&proof.state==='pending')proof.state='failed';}
   else if(['charge.refunded','charge.dispute.created'].includes(type)){const object=event.data?.object;const charge=await providers.stripe.getCharge(type==='charge.refunded'?object?.id:typeof object?.charge==='string'?object.charge:object?.charge?.id);const intent=await providers.stripe.getIntent(typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id);if(!intent.metadata?.order_id)return {received:true,ignored:true};order=await find(intent.metadata.order_id);proof={orderId:order.id,provider:'stripe',reference:order.provider_payment_id,captureId:intent.id,amountCents:charge.amount,currency:String(charge.currency).toUpperCase(),state:type==='charge.dispute.created'?'disputed':charge.refunded?'refunded':'partially_refunded',refundedCents:charge.amount_refunded||0};}
   else return {received:true,ignored:true};
  }else{
   const supported=['CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DENIED','PAYMENT.CAPTURE.REVERSED','PAYMENT.CAPTURE.REFUNDED'];if(!supported.includes(type))return {received:true,ignored:true};
   let providerOrderId=type==='CHECKOUT.ORDER.APPROVED'?event.resource?.id:event.resource?.supplementary_data?.related_ids?.order_id;
   if(!providerOrderId){let capture;if(type==='PAYMENT.CAPTURE.REFUNDED'){const refund=await providers.paypal.getRefund(event.resource?.id);const link=refund.links?.find(l=>l.rel==='up');const captureId=refund.supplementary_data?.related_ids?.capture_id||link?.href?.match(/\/captures\/([A-Za-z0-9]+)(?:\?|$)/)?.[1];if(!captureId)invalid('Refund capture reference unavailable',502);capture=await providers.paypal.getCapture(captureId);}else capture=await providers.paypal.getCapture(event.resource?.id);providerOrderId=capture.supplementary_data?.related_ids?.order_id||capture.links?.find(l=>l.rel==='up')?.href?.match(/\/orders\/([A-Za-z0-9]+)(?:\?|$)/)?.[1];if(!providerOrderId){const [[stored]]=await db.query('SELECT id FROM orders WHERE provider=? AND provider_capture_id=?',['paypal',capture.id]);if(stored){order=await find(stored.id);providerOrderId=order.provider_payment_id;}}}
   if(!providerOrderId)invalid('PayPal order reference unavailable',502);const data=await providers.paypal.getOrder(providerOrderId);const orderId=data.purchase_units?.[0]?.custom_id;if(!orderId)return {received:true,ignored:true};order=await find(orderId);proof=await paypalProof(order,data,type==='CHECKOUT.ORDER.APPROVED');if(type==='PAYMENT.CAPTURE.REVERSED')proof.state='reversed';
  }
  // Refund APIs can briefly lag the signed notification. Ask the provider to
  // retry instead of acknowledging a refund while leaving old entitlements paid.
  if(type==='PAYMENT.CAPTURE.REFUNDED'&&!['refunded','partially_refunded'].includes(proof.state))invalid('Refund confirmation is still pending at PayPal',502);
  if(type==='charge.refunded'&&proof.state!=='refunded'&&!proof.refundedCents)invalid('Refund confirmation is still pending at Stripe',502);
  await apply(proof,{id:event.id,type});return {received:true};
 }
 return {create,refresh,detail,list,webhook,apply,find};
}
module.exports={createPaymentService,normalizeItems};
