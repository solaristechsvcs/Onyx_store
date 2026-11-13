'use strict';
module.exports=require('./licenseApi').createRouter(require('./db'),require('./security'),undefined,{paymentMode:require('../config').payments?.mode||'live'});
