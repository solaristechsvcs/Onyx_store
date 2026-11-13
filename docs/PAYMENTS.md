# Stripe and PayPal setup

The store implements Stripe hosted Checkout and PayPal Orders v2 with server-side capture. Enable either provider or both in local `config.js`. Existing configuration files are never overwritten by an update. Copy the new `payments` block from `config.example.js` into your existing `module.exports` object, keeping commas between sections.

## Configuration

```js
payments: {
  enabled: true,
  mode: 'test',
  providers: ['stripe', 'paypal'],
  defaultProvider: 'stripe',
  allowFreeOrders: true,
  maxTotalCents: 99999999,
  stripe: {
    secretKey: 'YOUR_STRIPE_TEST_SECRET_KEY',
    webhookSecret: 'YOUR_STRIPE_TEST_WEBHOOK_SIGNING_SECRET'
  },
  paypal: {
    clientId: 'YOUR_PAYPAL_SANDBOX_CLIENT_ID',
    clientSecret: 'YOUR_PAYPAL_SANDBOX_CLIENT_SECRET',
    webhookId: 'YOUR_PAYPAL_SANDBOX_WEBHOOK_ID',
    merchantId: ''
  }
},
```

- Stripe only: `providers: ['stripe']`.
- PayPal only: `providers: ['paypal']` and `defaultProvider: 'paypal'`.
- Both: `providers: ['stripe', 'paypal']`; customers choose in the cart.
- Disable new checkout: `enabled: false`. Keep existing provider credentials and the same mode in place so earlier orders and refund webhooks can still be reconciled.
- A provider is offered only when its credentials and webhook configuration are present. Stripe test mode requires a test secret key (`sk_test_` or `rk_test_`) and a `whsec_` signing secret. Client-side/publishable keys are not used.
- `mode: 'test'` uses Stripe test credentials and PayPal Sandbox. `mode: 'live'` uses live credentials and PayPal production. Live mode requires an HTTPS `server.publicUrl` and `session.secureCookies: true`.
- Set `server.publicUrl` to the exact public origin, such as `https://onyx.thesynergy.dev`. Provider return URLs are generated from it; no customer-supplied return URL is accepted.
- `merchantId` is an optional extra PayPal merchant identity check. Leave it blank or supply the correct merchant ID for the selected environment.

Keep credentials only in local config.js, which is excluded from Git. Do not paste them into support chats, browser code or screenshots. No new package dependencies are required. Restart Wisp after updating the configuration; the startup command is unchanged.

## Stripe webhook

Create a snapshot event webhook endpoint in the matching Stripe test/live environment:

`https://YOUR-STORE/api/payments/webhooks/stripe`

Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`
- `charge.dispute.created`

Put that endpoint's signing secret into `payments.stripe.webhookSecret`. Signatures are checked with the original body, a five-minute timestamp tolerance and constant-time HMAC comparison. The route is mounted before JSON parsing. Session/payment records are fetched from Stripe and checked against the store order's identity, amount, currency and mode before fulfillment. The adapter pins Stripe API version `2026-10-28.endive`; changing versions requires reviewing the response contract and rerunning tests.

Official references: [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create), [Webhook verification and retries](https://docs.stripe.com/events/manage-webhook-endpoints).

## PayPal webhook

Create a webhook for the matching PayPal Sandbox/live REST app:

`https://YOUR-STORE/api/payments/webhooks/paypal`

Subscribe to:

- `CHECKOUT.ORDER.APPROVED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.PENDING`
- `PAYMENT.CAPTURE.DENIED`
- `PAYMENT.CAPTURE.REVERSED`
- `PAYMENT.CAPTURE.REFUNDED`

Put the webhook ID into `payments.paypal.webhookId`. This is the webhook registration ID, not the client ID or an event ID. Verification uses PayPal's `verify-webhook-signature` API with the event and transmission headers; it must return SUCCESS. PayPal's generic webhook simulator is not compatible with this postback verification method. Test using actual Sandbox app transactions and their webhooks.

The store creates CAPTURE-intent, no-shipping digital-product orders. It verifies the order/custom ID, amount/currency and optional merchant ID before capturing an APPROVED order. Capture requests have stable idempotency IDs. An approval redirect alone never marks an order paid: the capture must be confirmed COMPLETED by PayPal. Signed approval webhooks and the pending-order worker can complete capture even if the customer closes the return tab.

Official references: [Orders v2](https://developer.paypal.com/api/orders/v2), [Webhook verification](https://developer.paypal.com/api/rest/webhooks/rest/), [Supported currencies](https://developer.paypal.com/api/codes/currency).

## Orders and licenses

Checkout requires a signed-in customer. Only published digital products can be checked out. The server reads current prices and licensing terms from MySQL, snapshots them into order items, and ignores client-supplied prices or totals. One order supports 1–50 distinct products, quantities 1–99, and one currency. Physical shipping, subscriptions, coupons, discounts and tax calculation are not implemented. The charged total is the configured product-price sum; no extra tax/shipping is calculated. Provider/account-specific minimums, limits and currency availability can still cause rejection.

The current two-decimal catalog currencies are supported by Stripe subject to account eligibility. PayPal checkout excludes INR and ZAR. Mixed-currency carts must be split. Zero-total digital carts use an explicit free-order claim when `allowFreeOrders` is enabled; no paid provider is called.

Checkout request UUIDs, provider idempotency headers, unique payment/capture references, row locks and webhook receipts protect retries from duplicate orders or licenses. A return-page query string or a client claim of success does not mark an order paid. Confirmed payments trigger license issuance immediately; failed license work is retried by the existing license worker. The payment worker checks up to 25 pending provider orders per minute, rotating through records so one failed order does not block later ones. Missing credentials are never treated as successful payment.

Customer receipts and history are at `/checkout?order=ID` and `/orders`, with account-ownership checks. Admins/owners can inspect **Staff Panel → Sales & orders** and recheck provider status. Staff and customers cannot force an order paid. Checkout creation is limited to ten attempts per account per minute in the running process.

Orders retain their payment mode. Test orders are labeled and their licenses do not validate in the live-mode license API. Switching mode does not turn a test payment into a live payment. Use a separate database/deployment for Sandbox testing when practical, and keep matching credentials available for outstanding orders.

## Refunds and disputes

Issue refunds in the Stripe or PayPal dashboard. The Staff Panel does not send refunds. Full verified refunds set the order to refunded and revoke its store-issued licenses; reversed PayPal captures and newly opened Stripe disputes block the order and revoke licenses. A late payment-success event cannot reactivate a refunded/disputed/reversed order. Dispute resolution and reinstatement require manual review; this release does not automatically restore a disputed order after a win.

Partial refunds retain the remaining order entitlement because there is no per-item refund allocation UI. Stripe's cumulative refunded amount is recorded. PayPal's authoritative PARTIALLY_REFUNDED status is recorded, but its cumulative partial-refund amount is not calculated here; consult the provider dashboard. Admins may manually suspend/revoke individual licenses as appropriate. Full-refund totals are recorded for both providers.

Refund notifications return a retryable error if the provider read API has not yet caught up, rather than acknowledging the event as a paid order. Duplicate processed event IDs are acknowledged without duplicate fulfillment. Webhook delivery must remain enabled and monitored: the pending-order worker is not a substitute for refund/dispute webhooks on already-paid orders.

## Deployment and verification

Startup adds order payment fields, checkout/capture indexes, order-item snapshot fields and a payment-event receipt table. Existing data and config.js are preserved. Back up MySQL and `.onyx-license-key`; the MySQL account needs ALTER/CREATE permission. Keep the HTTPS webhook paths reachable through your proxy with unmodified request bodies and signature headers. No provider secrets or card details are sent to the public configuration endpoint or audit log.

Before enabling live payments, complete Sandbox/test checkouts for both configured providers on the actual Wisp deployment. Check webhook delivery and signatures, confirm exactly one paid order and the correct licenses, retry notifications, test cancellation/failure and test a full refund. Then use matching live keys/webhook registrations and set `mode: 'live'`. Do not mix test signing secrets with live keys.

Development verification uses real local HTTP routes with simulated transactional SQL and simulated provider APIs, including signed Stripe fixture events and PayPal verification-response fixtures. Browser checks cover both simulated checkout flows, receipts, cart clearing, staff order views, license delivery and mobile layout. Real merchant credentials were not available; actual Stripe/PayPal Sandbox or live transactions, live MySQL migrations and Wisp deployment remain unverified. No money was charged in development.
