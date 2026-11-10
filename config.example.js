// Copy to config.js on your Wisp server. Never commit config.js.
module.exports = {
  server: {
    host: '0.0.0.0',
    port: 3000,
    publicUrl: 'http://localhost:3000'
  },
  mysql: {
    host: '127.0.0.1',
    port: 3306,
    user: 'onyx_store',
    password: 'CHANGE_ME',
    database: 'onyx_store',
    connectionLimit: 10
  },
  discord: {
    clientId: '',
    clientSecret: ''
  },
  session: {
    secret: 'REPLACE_WITH_A_LONG_RANDOM_SECRET',
    secureCookies: false
  }
};
