# Onyx Store

Weblutions-inspired independent digital storefront built for Wisp/Pterodactyl-compatible Node.js hosting and external MySQL.

## Implemented storefront
- Responsive homepage and `/products` catalog using published MySQL products; visible category/subcategory links, search within the loaded collection, and newest/name sorting. The API currently returns at most 100 products; pagination and descendant-inclusive category filtering are not implemented. Selecting a category shows products assigned directly to it.
- Direct product pages at `/products/:slug`, with description, price, currency, digital/license metadata, and add-to-cart action. Product art is a decorative placeholder; no product image field exists yet.
- `/login` and `/register` submit to the existing account APIs. Registration requires a display name, email, and password of at least 12 characters. `/account` displays account details; navigation includes sign out and a Staff Panel link for staff/admin/owner roles. Existing server-side staff API authorization remains enforced.
- Discord login uses the existing OAuth endpoints and redirects home on success. It requires configured credentials and a verified Discord email. Linking Discord to an existing site account is not supported. Provider errors currently use the existing server error responses.
- `/cart` stores only product slugs and quantities in this browser, supports quantities 1–99 and removal, re-fetches product details/prices, groups subtotals by currency, and marks unavailable items. Browser storage is shared by accounts on that browser and is not synchronized across devices. No order is created.
- Loading, empty, failure/retry states, labeled forms, keyboard focus styles, and mobile layouts. Dynamic catalog/account content is escaped. All frontend scripts/styles are external to retain Helmet's content security policy, including the existing Staff Panel.

## Not implemented / not verified
Checkout is deliberately disabled. There is no verified payment integration, payment webhook, purchase flow, tax/shipping calculation, or paid-order fulfillment. Order history, customer downloads, subscriptions, coupons, product/category staff editing, password reset, email verification, and Discord account linking remain future work. Existing license APIs and schema are preserved; the storefront does not expose license management or automatically issue licenses.

Automated browser-logic tests use mocked API responses; they do not prove live MySQL, Discord OAuth, session cookies, Wisp deployment, or visual browser behavior. Validate these on the configured installation before production use. No sample products or fabricated inventory are inserted.

## Deployment target
- Node.js + Express, external MySQL, config.js (local secrets excluded from git)
- Bind HTTP on 0.0.0.0 and Wisp-assigned port
- Startup via npm start; avoid SSH-only setup

## Wisp setup
1. Copy `config.example.js` to local `config.js`; set MySQL credentials, Wisp-assigned port, and the public URL. Keep `config.js` out of Git.
2. Install dependencies and start with `npm start`. Existing startup migrations run against MySQL. The storefront introduces no schema changes or additional dependencies.
3. Set Discord's redirect URL to `https://YOUR-DOMAIN/api/accounts/discord/callback` and configure `discord.clientId` and `discord.clientSecret`. Set `server.publicUrl` to the exact external origin; cookie-authenticated writes validate that origin. Use secure cookies on HTTPS.
4. Keep the startup command `node scripts/update.js && npm install && node server.js`. The startup updater always checks for updates. With `updater.enabled: true`, the running app also checks immediately and at the configured interval, applies safe fast-forward updates, and exits after an update for Wisp to restart it. Wisp automatic restart must be enabled. The updater preserves ignored configuration, refuses tracked edits/diverged branches, and reads the configured branch (environment overrides still take precedence).
5. Publish products and assign visible categories through the existing database; catalog administration UI is not provided yet. Existing owner bootstrap and staff role management are unchanged. Open `/staff` after signing in with an authorized account.

## Checks
`npm run check` checks every JavaScript file. `npm test` runs dependency-free storefront logic tests covering escaping, role navigation, API failures, registration markup, and cart validation/repricing/currencies. Live integration and responsive visual checks are still required.

## Repair an upload-only Wisp installation
If the console says `[updater] No .git directory: skipped`, the deployment was uploaded without Git metadata. The updater cannot bootstrap itself from that installation.

Download `scripts/repair-git.js` from this repository and upload it into `/home/container/scripts/repair-git.js` using Wisp Files. Stop the server first. Temporarily set startup to `node scripts/repair-git.js && npm install && node server.js` and start it once. Git and outbound GitHub access are required. If Git is unavailable, ask the host to provide a Node image with Git; this script does not install system software.

The repair downloads `main`, backs up each existing application file it will replace under `.onyx-recovery/`, copies the new files, and installs Git metadata last. It preserves local `config.js`, `.env`, dependencies, and other untracked data. It refuses symlink/path conflicts. File-copy failures roll back copied files; backups and a recovery manifest remain. A forced termination or disk failure may require manual recovery from the backup. Temporary downloads are retained under `.onyx-install-*`. Existing Git installations are left untouched.

Once `[repair] Git checkout restored` appears, restore startup to `node scripts/update.js && npm install && node server.js`. Check for `[updater] Already up to date` on the next restart. Repair changes application code to current `main`, but database migration/startup failures are separate and must be reviewed in the console.

