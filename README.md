# Davetech Importer

**Import Products. Automate Selling. Grow Your Business.**

Davetech Importer is a dashboard for running an AliExpress dropshipping business. You use it to import AliExpress products, price them in KES, publish them to **DaveTech Shop** (the Flask site on Render), check supplier prices and stock, and handle customer orders after they are paid with M-Pesa.

```
 Browser (React dashboard) ──HTTPS──► Importer server (Node/Express on Render)
                                         │  Firebase Admin ─► Firestore (data) + Firebase Auth (logins)
                                         │  AliExpress Open Platform API (signed requests)
                                         └─ Store Integration API ─► DaveTech Shop (Flask) ─► M-Pesa Daraja
```

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Lucide icons, Recharts. Supports light and dark themes and works on phones.
- **Backend:** Node.js and Express on one Render web service. The server also serves the dashboard and runs the import queue and the hourly sync scheduler.
- **Database:** Cloud Firestore. Only the server can access it; Firestore rules block all direct browser access.
- **Auth:** Firebase Authentication (email and password), with `admin` and `staff` roles checked on the server.
- **Payments:** M-Pesa runs in the shop. The shop now confirms every payment with Safaricom (callback, then STK Query, then an amount check) before it marks an order paid.

## What works now (Phases 1–4, plus manual order handling)

| Area | Status |
|---|---|
| Sign-in, roles (admin/staff), team invites, audit log | ✅ |
| Multi-store architecture (every record has `storeId`; server checks membership; rules deny browser access) | ✅ |
| Overview dashboard: 8 summary cards, sales and order charts, recent imports, orders and alerts | ✅ |
| **Manual import**: paste an AliExpress link and type in the price, shipping and image links | ✅ works today |
| AliExpress API import, search, product preview, variants, shipping to Kenya | ✅ built; needs an approved AliExpress app |
| Import queue with progress; duplicate protection (atomic, per store) | ✅ |
| Product editor: images and main image, description, category, SKU, SEO, variants, duplicate, archive, delete | ✅ |
| Pricing engine: % or fixed markup, category and product rules, minimum profit or price, rounding, locked manual price, exchange rates | ✅ |
| Publish, update and unpublish to DaveTech Shop; categories created automatically | ✅ |
| Price and stock sync (manual and scheduled), price-change alerts, automatic unpublish when out of stock, sync history | ✅ for API-imported products |
| Orders, customers, payments, CSV exports | ✅ (read live from the shop) |
| Supplier orders and tracking: **manual workflow** (open link → buy → paste AliExpress order number and tracking) | ✅ |
| Analytics: sales, estimated supplier cost, gross and net profit, best sellers, CSV | ✅ (costs are estimates) |
| Automatic supplier ordering, automatic tracking sync, SMS/email notifications, refunds through the API | ⏳ Phase 6. Shown in the dashboard as unavailable, and the master purchasing switch is locked **off** |

The app never invents data. If AliExpress doesn't supply a stock figure, the stock shows as "not supplied", not unlimited. If an API isn't approved for your app, the dashboard says so and shows the manual steps instead.

---

## Setup (step by step)

### 1. Create a Firebase project (about 10 minutes)
1. Go to <https://console.firebase.google.com> and click **Add project**. Name it, for example, `davetech-importer`. You can turn Google Analytics off.
2. **Build → Firestore Database → Create database**. Choose **Production mode** and a location close to Kenya (e.g. `europe-west1`).
3. **Build → Authentication → Get started → Email/Password → Enable**.
4. **Project settings (⚙) → General → Your apps → Web (`</>`)**. Register an app, then copy `apiKey`, `authDomain`, `projectId` and `appId`. These are the `VITE_FIREBASE_*` values.
5. **Project settings → Service accounts → Generate new private key**. A JSON file downloads. Its contents are `FIREBASE_SERVICE_ACCOUNT`. Keep this file secret.
6. Apply the security rules and indexes (easiest from a computer):
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add          # pick your project
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   If you can't use a computer, copy `firestore.rules` into **Firestore → Rules → Publish**. No extra indexes are needed, because the app sorts results itself.

### 2. Update DaveTech Shop
1. Deploy the updated `davetech-shop` code. It adds the integration API, the product image gallery and the safer M-Pesa confirmation.
2. On Render, open **davetech-shop → Environment** and add `IMPORTER_API_KEY`. Use a long random value; one way to make it is to run `openssl rand -hex 32` on a computer.

### 3. Deploy the importer on Render
1. Put this folder in a new GitHub repo, e.g. `davetech-importer`.
2. On Render, choose **New → Blueprint** and pick the repo. Render reads `render.yaml`.
3. Fill in the environment variables:

| Variable | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | the whole service-account JSON (paste it as is) |
| `ADMIN_EMAILS` | your email, e.g. `davmuchiri48@gmail.com` |
| `ENCRYPTION_KEY` | auto-generated by Render. **Never change it later**, or the saved keys can no longer be read |
| `PUBLIC_URL` | the importer's address, e.g. `https://davetech-importer.onrender.com` |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | from step 1.4 |
| `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET` | leave empty until AliExpress approves your app |

4. In Firebase, go to **Authentication → Settings → Authorized domains** and add your Render domain.
5. Open the importer and click **Create account** with your admin email. Then connect the shop: enter its address and the same `IMPORTER_API_KEY`.

### 4. First run
1. In **Settings → Currency**, set `1 USD = ? KES` or switch to automatic daily rates.
2. In **Pricing Rules**, set your markup, additional costs and rounding.
3. In **Categories**, click **Load from shop**.
4. In **Product Importer → Manual import**, paste an AliExpress link with its price, shipping and image links. The product appears in **My Products** as a draft. Check it there, then click **Save & publish**.
5. When a customer pays, the order appears under **Supplier Orders → Ready to order**. Buy the item on AliExpress, paste the AliExpress order number, and later paste the tracking number.

### Run locally (optional)
```bash
cp .env.example .env      # fill it in
npm install
npm run dev               # dashboard http://localhost:5173, API :8080
npm test                  # unit + flow tests
```

---

## AliExpress API permissions still required

Register at <https://openservice.aliexpress.com>, create an app in the **Dropshipping** category, and set the callback URL to `PUBLIC_URL/api/integrations/aliexpress/callback`. Then request these APIs:

| Feature | API (set in `server/aliexpress/adapter.ts`) | Needed for |
|---|---|---|
| Product search | `aliexpress.ds.text.search` | Find Products |
| Product details | `aliexpress.ds.product.get` | API import, sync |
| Shipping cost | `aliexpress.ds.freight.query` | Shipping to Kenya at import |
| Create order | `aliexpress.ds.order.create` (or `aliexpress.trade.buy.placeorder`) | Phase 6 automatic ordering |
| Order status | `aliexpress.trade.ds.order.get` | Phase 6 |
| Tracking | `aliexpress.logistics.ds.trackinginfo.query` | Phase 6 tracking sync |

After approval, add the key and secret on Render, then open **Integrations → Connect AliExpress account → Test API**. The test shows which APIs actually work for your app. AliExpress sometimes renames APIs, so check the names against your app's permission list. If one is different, change it in `AE_METHODS`.

## Other permissions and services
- **M-Pesa Daraja** (already used by the shop): go-live approval for your Paybill or Till. Refunds through the API need the B2C or Reversal API, which isn't set up yet.
- **SMS/email** (Phase 6): e.g. Africa's Talking for SMS and an email provider. Not connected yet.

## Security notes
- No secrets are in the frontend code. The browser only receives Firebase's public web settings.
- Firestore rules deny all direct access. The server checks the user's role and store for every request, and every query is filtered by `storeId`.
- The shop API key and AliExpress tokens are encrypted with AES-256-GCM and stored in a server-only `secrets` collection.
- Prices, payment status, roles and quantities are always worked out on the server, never taken from the browser.
- Duplicate protection: one product per AliExpress item per store, enforced with a Firestore transaction. Shop updates are keyed by the product id, so repeating one never creates a second copy. Duplicate M-Pesa callbacks are ignored.
- Other protections: rate limiting, input validation (zod), Helmet security headers, and an audit log of admin actions.

## Tests
`npm test` runs 23 tests. They cover the pricing engine (including the brief's KES 2,506 example), currency conversion, AliExpress link parsing and response mapping, request signing, store isolation, duplicate detection, publish rules (no shipping, unavailable, loss), locked prices, sync unpublish and alerts, recording of sync failures, and secret encryption. `tests/shop-live.test.ts` also tests against a real shop when `SHOP_URL` and `SHOP_KEY` are set.

## Next phases
- **Phase 5 (rest):** a Firestore copy of customers and payments, refund records, and SMS/email notifications.
- **Phase 6:** semi-automatic and automatic supplier ordering. This includes validation, purchase limits, the emergency switch, idempotent order creation, and tracking sync. It needs the AliExpress ordering APIs approved and testing in a sandbox first.
- **Phase 7:** a security review, performance work and more tests.
- **Shop:** let customers choose variants (colour/size) at checkout. Today the shop sells one price per product.
