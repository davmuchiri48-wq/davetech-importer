# Store Integration API (v1)

Davetech Importer talks to each online store through this small HTTP API. DaveTech Shop (Flask) already implements it. Any future custom website can be connected by implementing the same six endpoints.

## Authentication

Every request carries the store's API key:

```
Authorization: Bearer <IMPORTER_API_KEY>
Content-Type: application/json
```

- The store keeps the key in an environment variable (`IMPORTER_API_KEY`, 32+ random characters).
- The importer keeps it encrypted (AES-256-GCM) in a server-only Firestore collection and never sends it to the browser.
- A wrong or missing key returns `401`. If the store has no key configured, it returns `503`.
- Use HTTPS only.

All money values are **whole units of the store currency** (KES shillings).

## Endpoints

### `GET /api/integration/v1/health`
```json
{ "ok": true, "store_name": "DaveTech Shop", "currency": "KSh", "version": "1.0" }
```

### `GET /api/integration/v1/categories`
```json
{ "categories": [ { "id": 1, "name": "Electronics" } ] }
```

### `POST /api/integration/v1/categories`
Body `{ "name": "Gadgets" }`. This call is idempotent: if a category with that name already exists (any letter case), the store returns it instead of creating a second one.
```json
{ "id": 6, "name": "Gadgets" }
```

### `PUT /api/integration/v1/products/{external_id}`
Creates or updates the product whose `external_id` matches. `external_id` is the importer's product id, so repeating the same request never creates duplicates.

| Field | Type | Notes |
|---|---|---|
| `name` | string | required |
| `price` | integer > 0 | selling price, required |
| `description` | string | plain text |
| `image` | https URL | main image |
| `images` | https URL[] | up to 10 gallery images |
| `category_id` | integer \| null | from the categories endpoints |
| `active` | bool | shown in the shop |
| `dropship` | bool | true for AliExpress items |
| `supplier_url` | string | AliExpress product link |
| `supplier_cost` | integer | item cost + additional costs in KES |
| `supplier_shipping` | integer | supplier shipping in KES |
| `old_price`, `delivery_days`, `sku`, `seo_title`, `seo_description` | optional | |

Response: `{ "id": 42, "created": true }`

### `DELETE /api/integration/v1/products/{external_id}`
Deletes the product. If the product already has orders, the store hides it instead so that order history stays intact.
`{ "result": "deleted" | "hidden" | "not_found" }`

### `GET /api/integration/v1/orders?since=ISO&status=new&limit=200`
Returns orders, newest first (`limit` max 1000).
```json
{ "orders": [ {
  "id": 1, "code": "A1B2C3", "name": "Jane", "phone": "0712345678", "email": "", "address": "Nairobi",
  "notes": "", "subtotal": 2600, "delivery": 200, "total": 2800,
  "payment_method": "mpesa", "payment_status": "paid", "mpesa_receipt": "QWE123",
  "status": "processing", "supplier_order_no": "", "tracking_no": "", "created": "2026-11-03T10:00:00Z",
  "items": [ { "product_id": 42, "external_id": "abc", "name": "Earbuds", "price": 2600, "qty": 1,
               "dropship": true, "supplier_url": "https://…", "supplier_cost": 1790 } ]
} ] }
```
`price` and `supplier_cost` on items are copies saved when the customer ordered. They never change afterwards.

`payment_status` must be set **only** by the store's server after it has checked the payment with the gateway: `unpaid | pending | paid | failed`.

### `PATCH /api/integration/v1/orders/{code}`
Body: any of `supplier_order_no`, `tracking_no`, `status` (`new|processing|shipped|delivered|cancelled`).
- The store refuses a `supplier_order_no` (`400`) unless the order is paid or is pay-on-delivery.
- When a tracking number is added to a `new` or `processing` order, the store marks it `shipped`.

Response: `{ "order": { …same shape as above… } }`
