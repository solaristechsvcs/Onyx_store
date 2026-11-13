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
  updater: {
    enabled: false, // Enable only when Wisp auto-restarts and startup runs node scripts/update.js
    branch: 'main',
    checkIntervalMinutes: 15
  },
  discord: {
    clientId: '',
    clientSecret: ''
  },
  payments: {
    enabled: false, // Set true after configuring providers and verified webhook endpoints.
    mode: 'test', // 'test' uses Stripe test keys and PayPal Sandbox; switch to 'live' together.
    providers: ['stripe', 'paypal'], // Use ['stripe'], ['paypal'], or both.
    defaultProvider: 'stripe',
    allowFreeOrders: true,
    maxTotalCents: 99999999,
    stripe: {
      secretKey: '',
      webhookSecret: '' // Signing secret for /api/payments/webhooks/stripe.
    },
    paypal: {
      clientId: '',
      clientSecret: '',
      webhookId: '', // Webhook ID for /api/payments/webhooks/paypal.
      merchantId: '' // Optional extra check against your PayPal merchant ID.
    }
  },
  session: {
    secret: 'REPLACE_WITH_A_LONG_RANDOM_SECRET',
    secureCookies: false
  }
};

