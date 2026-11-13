# Onyx Store

Weblutions-inspired independent digital storefront built for Wisp/Pterodactyl-compatible Node.js hosting and external MySQL.

## Implemented storefront
- Synergy-inspired storefront styling: an original dark geometric SVG backdrop, red lighting, purple accents, transparent navigation, an Onyx hero graphic, and matching catalog/detail/account/cart layouts. No reference-site logos, statistics, testimonials or raster assets are copied. Homepage product search opens the catalog with the search text preserved. The background is local and content-versioned with the other assets; no additional external image/font services are required.
- Responsive homepage and `/products` catalog using published MySQL products; visible category/subcategory links, search within the loaded collection, and newest/name sorting. The API currently returns at most 100 products; pagination and descendant-inclusive category filtering are not implemented. Selecting a category shows products assigned directly to it.
- Direct product pages at `/products/:slug`, with description, price, currency, digital/license metadata, and add-to-cart action. Uploaded product images appear on cards and product detail pages, with a decorative fallback.
- `/login` and `/register` submit to the existing account APIs. Registration requires a display name, email, and password of at least 12 characters. `/account` displays account details; navigation includes sign out and a Staff Panel link for staff/admin/owner roles. Existing server-side staff API authorization remains enforced.
- Discord login uses the existing OAuth endpoints and redirects home on success. It requires configured credentials and a verified Discord email. Linking Discord to an existing site account is not supported. Provider errors currently use the existing server error responses.
- `/cart` stores only product slugs and quantities in this browser, supports quantities 1–99 and removal, re-fetches product details/prices, groups subtotals by currency, and marks unavailable items. Browser storage is shared by accounts on that browser and is not synchronized across devices. No order is created.
- Loading, empty, failure/retry states, labeled forms, keyboard focus styles, and mobile layouts. Dynamic catalog/account content is escaped. All frontend scripts/styles are external to retain Helmet's content security policy, including the existing Staff Panel.

## Not implemented / not verified
Checkout is deliberately disabled. There is no verified payment integration, payment webhook, purchase flow, tax/shipping calculation, or paid-order fulfillment. Order history, customer downloads, subscriptions, coupons, password reset, email verification, and Discord account linking remain future work. Existing license APIs and schema are preserved; the storefront does not expose license management or automatically issue licenses.

Automated browser-logic tests use mocked API responses; they do not prove live MySQL, Discord OAuth, session cookies, Wisp deployment, or visual browser behavior. Validate these on the configured installation before production use. No sample products or fabricated inventory are inserted.

## Deployment target
- Node.js + Express, external MySQL, config.js (local secrets excluded from git)
- Bind HTTP on 0.0.0.0 and Wisp-assigned port
- Startup via npm start; avoid SSH-only setup

## Wisp setup
1. Copy `config.example.js` to local `config.js`; set MySQL credentials, Wisp-assigned port, and the public URL. Keep `config.js` out of Git.
2. Install dependencies and start with `npm start`. Existing startup migrations run against MySQL. Startup adds missing product image/revision fields and category revision fields automatically. No new package dependencies are required.
3. Set Discord's redirect URL to `https://YOUR-DOMAIN/api/accounts/discord/callback` and configure `discord.clientId` and `discord.clientSecret`. Set `server.publicUrl` to the exact external origin; cookie-authenticated writes validate that origin. Use secure cookies on HTTPS.
4. Keep the startup command `node scripts/update.js && npm install && node server.js`. The startup updater always checks for updates. With `updater.enabled: true`, the running app also checks immediately and at the configured interval, applies safe fast-forward updates, and exits after an update for Wisp to restart it. Wisp automatic restart must be enabled. The updater preserves ignored configuration, refuses tracked edits/diverged branches, and reads the configured branch (environment overrides still take precedence).
5. Sign in as an admin or owner and open `/staff`. Create categories, add products, review the preview, then check Published and save. Staff have read-only catalog access. Existing owner bootstrap and role protections are retained.

## Checks
`npm run check` checks every JavaScript file. `npm test` runs dependency-free storefront logic tests covering escaping, role navigation, API failures, registration markup, and cart validation/repricing/currencies. Live integration and responsive visual checks are still required.

## Repair an upload-only Wisp installation
If the console says `[updater] No .git directory: skipped`, the deployment was uploaded without Git metadata. The updater cannot bootstrap itself from that installation.

Download `scripts/repair-git.js` from this repository and upload it into `/home/container/scripts/repair-git.js` using Wisp Files. Stop the server first. Temporarily set startup to `node scripts/repair-git.js && npm install && node server.js` and start it once. Git and outbound GitHub access are required. If Git is unavailable, ask the host to provide a Node image with Git; this script does not install system software.

The repair downloads `main`, backs up each existing application file it will replace under `.onyx-recovery/`, copies the new files, and installs Git metadata last. It preserves local `config.js`, `.env`, dependencies, and other untracked data. It refuses symlink/path conflicts. File-copy failures roll back copied files; backups and a recovery manifest remain. A forced termination or disk failure may require manual recovery from the backup. Temporary downloads are retained under `.onyx-install-*`. Existing Git installations are left untouched.

Once `[repair] Git checkout restored` appears, restore startup to `node scripts/update.js && npm install && node server.js`. Check for `[updater] Already up to date` on the next restart. Repair changes application code to current `main`, but database migration/startup failures are separate and must be reviewed in the console.


## Staff catalog management
The staff interface uses the supplied charcoal/teal dashboard style: a fixed desktop sidebar, collapsible Catalog group, compact page header with working product search, teal metric cards/table headings, recent product and activity tables, and quick links. The dashboard shows actual catalog/account totals rather than fabricated sales, income or visitor analytics. Activity remains admin/owner-only. Navigation and columns adapt to smaller screens; product/category editors retain existing validation and permissions.

Pages reference content-versioned JavaScript/CSS filenames to prevent a browser or CDN from mixing an updated page with an older cached script or stylesheet. HTML and legacy asset URLs use `Cache-Control: no-store`; versioned URLs can be cached immutably. Each running process retains matching page/asset bytes until restart, including while the updater changes files on disk. Restart Wisp after updating; if an old panel is still displayed, hard-refresh once (Ctrl+Shift+R).

The staff workspace provides:
- Overview counts; searchable products with draft/published/category filters and 25-item pages.
- Create/edit products with unique URL slugs, plain-text descriptions, exact integer-cent pricing, supported two-decimal currencies, digital-product flag, activation limit and optional license duration.
- Draft/published status; live in-form preview and links to saved public listings. Publishing requires a description. Changing slugs breaks previous links/saved cart entries; the editor warns about this.
- One image per product, uploaded directly from the browser (PNG/JPEG/WebP, maximum 5 MB). Files are signature checked, assigned random names, and served with the existing security policy and no-sniff headers. SVG/HTML are rejected.
- Multiple category assignments; nested category create/edit/delete, visibility, sort order, and parent-cycle prevention. Each category controls its own visibility; hidden parents do not implicitly hide descendants or products.
- Staff may read all listings/categories, including drafts. Admins/owners may create, edit, publish, unpublish, upload and delete. Catalog mutation authorization is enforced on the server.
- Revision checks reject stale edits. Product fields, category assignments and audit writes commit together. Category-graph changes are locked during transactions.
- Draft-only product deletion. MySQL foreign keys protect products referenced by order items or licenses. Categories must have no assigned products or children before deletion. Prefer unpublishing products you want to retain.
- Existing user-role management, with protected owners/self and owner-only administrator changes; a recent 100-entry catalog/role activity log for admins/owners.
- Unsaved-edit prompts, validation errors, session/access messages, loading/retry/empty states and responsive desktop/mobile layouts.

Images are stored under `uploads/product-images/`, outside Git. Preserve and back up this folder along with MySQL and `config.js` when moving/reinstalling Wisp. Git updates preserve it. The Node process needs write access. Reverse proxies must allow 5 MB uploads. Uploaded images are public even for drafts; private downloadable products must not be uploaded here. Removing an image from a listing does not delete its file; media cleanup and galleries are not implemented.

Catalog upgrades are additive and repeatable: `products.image_path`, `products.revision`, and `categories.revision`. Existing data is retained; the configured MySQL user needs ALTER permission. Back up the database before deploying schema changes. No production MySQL migration or Wisp installation was exercised in development.

Tests exercise real Express HTTP routes with simulated MySQL query results, validation, role authorization, transactional commit/rollback decisions, concurrency conflicts, deletion protections and image upload limits. Browser QA covers product creation/publishing, subcategory creation and a 390-pixel mobile layout using local-only fixture data. The fixture is not deployed and inserts no production sample products. Live MySQL/foreign-key behavior and deployment still require verification.

Listing management does not implement payment checkout, order processing, private digital-file upload/delivery, inventory/shipping, subscriptions, coupons or automatic license issuance. These remain separate features.

