const mysql = require('mysql2/promise');
const config = require('../config.js');
const pool = mysql.createPool({host:config.mysql.host,port:config.mysql.port||3306,user:config.mysql.user,password:config.mysql.password,database:config.mysql.database,waitForConnections:true,connectionLimit:config.mysql.connectionLimit||10,decimalNumbers:true});
module.exports=pool;
