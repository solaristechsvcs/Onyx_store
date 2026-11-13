'use strict';
const allCurrencies=['USD','EUR','GBP','CAD','AUD','NZD','CHF','SEK','NOK','DKK','PLN','CZK','BRL','MXN','INR','SGD','HKD','ZAR'];
const paypalCurrencies=allCurrencies.filter(c=>!['INR','ZAR'].includes(c));
function paymentConfig(config){
 const input=config.payments||{},enabled=input.enabled===true,mode=input.mode||'test';
 if(!['test','live'].includes(mode))throw Error('payments.mode must be test or live');
 const providers=input.providers||['stripe','paypal'];
 if(!Array.isArray(providers)||providers.some(p=>!['stripe','paypal'].includes(p)))throw Error('payments.providers must contain stripe and/or paypal');
 let url;try{url=new URL(config.server?.publicUrl);}catch{if(enabled)throw Error('Enabled payments require a valid server.publicUrl');url=new URL('http://localhost');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Invalid server.publicUrl');
 if(enabled&&mode==='live'&&(url.protocol!=='https:'||config.session?.secureCookies!==true))throw Error('Live payments require HTTPS publicUrl and session.secureCookies=true');
 const stripe=input.stripe||{},paypal=input.paypal||{};
 const maxTotalCents=input.maxTotalCents??99999999;if(!Number.isSafeInteger(maxTotalCents)||maxTotalCents<1||maxTotalCents>99999999)throw Error('payments.maxTotalCents must be 1–99999999');
 const stripeReady=typeof stripe.secretKey==='string'&&new RegExp('^(sk|rk)_'+mode+'_').test(stripe.secretKey)&&typeof stripe.webhookSecret==='string'&&stripe.webhookSecret.startsWith('whsec_');
 const paypalReady=!!(paypal.clientId&&paypal.clientSecret&&paypal.webhookId);
 const ready=providers.filter(p=>p==='stripe'?stripeReady:paypalReady);
 return {enabled,mode,providers:[...new Set(providers)],ready:enabled?ready:[],defaultProvider:ready.includes(input.defaultProvider)?input.defaultProvider:ready[0]||null,allowFreeOrders:enabled&&input.allowFreeOrders!==false,maxTotalCents,publicUrl:url.origin,stripe:{...stripe,ready:stripeReady,apiVersion:stripe.apiVersion||'2026-10-28.endive'},paypal:{...paypal,ready:paypalReady},currencies:{stripe:allCurrencies,paypal:paypalCurrencies}};
}
module.exports={paymentConfig};
