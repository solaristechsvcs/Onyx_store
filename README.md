# Onyx Store

Weblutions-inspired independent digital storefront built for Wisp/Pterodactyl-compatible Node.js hosting and external MySQL.

## Planned capabilities
- Responsive storefront, product listings, cart, checkout, customer dashboard
- Unlimited nested product categories
- Digital product delivery, version management, subscriptions
- Store-issued and externally managed licenses with scoped API credentials, activation limits, validation, revocation and audit trails
- Staff/admin dashboard, roles, orders, coupons, payment webhooks
- First-run owner setup and safe schema migrations

## Deployment target
- Node.js + Express, external MySQL, config.js (local secrets excluded from git)
- Bind HTTP on 0.0.0.0 and Wisp-assigned port
- Startup via npm start; avoid SSH-only setup

Implementation is pending; this README is a project specification, not a working deployment.
