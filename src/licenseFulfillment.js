'use strict';
const {createService}=require('./licenseService');
function start(db){
 const service=createService(db);let running=false,stopped=false,cursor=0;
 async function check(){if(running||stopped)return;running=true;try{
  const [orders]=await db.query(`SELECT o.id FROM orders o WHERE o.id>? AND (
  (o.status='paid' AND EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=o.id AND COALESCE(oi.is_digital,p.is_digital)=1 AND oi.quantity>(SELECT COUNT(*) FROM licenses l WHERE l.order_item_id=oi.id AND l.origin='store')))
  OR (o.status IN ('refunded','cancelled') AND EXISTS (SELECT 1 FROM licenses l JOIN order_items oi ON oi.id=l.order_item_id WHERE oi.order_id=o.id AND l.origin='store' AND l.status<>'revoked'))
  ) ORDER BY o.id LIMIT 50`,[cursor]);
  if(!orders.length){cursor=0;return;}
  for(const order of orders){if(stopped)break;try{await service.fulfillOrder(order.id);}catch(error){console.error('[licenses] Order '+order.id+': '+error.message);}finally{cursor=order.id;}}
 }catch(error){console.error('[licenses] Reconciliation failed: '+error.message);}finally{running=false;}}
 const timer=setInterval(check,60000);timer.unref();void check();return ()=>{stopped=true;clearInterval(timer);};
}
module.exports=start;
