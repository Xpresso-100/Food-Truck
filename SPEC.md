# SPEC - The Food Truck, phase 1

Repo: Xpresso-100/Food-Truck. Written by node G0 on 2026-10-06.
Binding inputs: `SPEC-locked-decisions.md` (it wins on any conflict), the role spec, and
`CODEBASE_MAP.md`. Every assumption has a numbered line in `DECISIONS-LOG.md` (`Dnn` below).

The Food Truck is an Xpresso-owned retail outlet parked outside the office. In phase 1 it does one
thing: **order stock from the Xpresso HQ warehouse.** It has no sales and no POS (D13). Ordering
is on demand (D13).

---

## 0. Stack (D01-D04)

- **Server:** PHP 8.1 or later (8.3 locally). Flat PHP, no framework, no Composer.
  The web root is `public/`. Application code lives in `src/`, outside the web root.
- **Database:**
  - PDO with prepared statements only.
  - Production: MySQL through `pdo_mysql`, using its own database. Suggested name: `xpresso_truck`.
  - Tests and dev: SQLite through `pdo_sqlite`.
  - The app **never connects to the reference database `xpresso_clients`** (D03).
- **UI:** static HTML, vanilla JS and one CSS file. Mobile-first. No build step.
- **Tests:**
  - Node 24's built-in `node:test` and global `fetch`, with zero npm dependencies.
  - They are black-box tests against `php -S`.
  - `package.json` declares no dependencies. A `package-lock.json` exists so `npm audit` can run.
- **Money:** stored as integer cents (`*_cents INTEGER`). The API emits JSON numbers rounded to
  2 decimals, in ZAR (D14).
- **Time zone:** `Africa/Johannesburg`. API timestamps are ISO 8601 with an offset, for example
  `2026-10-06T10:15:00+02:00`.

## 1. Modules and file ownership

A file that is in no module list is **shared**. Shared files are created by G1 and frozen
afterwards. A build node that needs a shared file changed writes
`LANE BREACH: <file> - <reason>` in `progress.md` and stops.

### Shared (G1 scaffold; frozen after G1)
```
.gitignore                      (.env, node_modules/, .run/, var/, *.sqlite)
.env.example                    (every variable in section 7, placeholder values only)
package.json, package-lock.json (no dependencies; "test" script = the test command)
.pipeline/test-cmd.txt
public/api.php                  front controller: full route table from section 4, wired to the
                                handler functions in the module files below
public/router.php               php -S router: /api/* -> api.php, otherwise static files
public/.htaccess                Apache: rewrite ^api/(.*)$ -> api.php?route=/$1; deny dotfiles,
                                *.sql, *.log, *.txt
src/bootstrap.php               env config, timezone, error handling, session start
src/Http.php                    JSON responses, error envelope, JSON body parsing, 415 check
src/Db.php                      PDO factory (sqlite | mysql from DB_DSN)
src/Auth.php                    login, logout, me, current user, require_role()
src/Fincon/FinconStockReader.php        interface (read-only)
src/Fincon/MockFinconStockReader.php    mock adapter (tests)
src/Fincon/TunnelFinconStockReader.php  real adapter (Cloudflare Tunnel)
src/Fincon/factory.php                  picks the adapter from FINCON_ADAPTER
db/schema.sqlite.sql
db/schema.mysql.sql             one statement per block (phpMyAdmin runs them one at a time)
bin/migrate.php                 applies the schema for DB_DSN's driver; idempotent
bin/seed.php                    `php bin/seed.php test` loads section 6 fixtures; refuses when
                                APP_ENV=production
bin/create-user.php             `php bin/create-user.php <username> <location_id>`; reads the
                                password from STDIN; bcrypt
tests/support/**                test helpers (server start-up, cookie jar, JSON deep-scan)
tests/smoke/**                  smoke test (app starts, GET /api/health)
tests/acceptance/**             black-box acceptance tests (READ-ONLY to everyone except G1)
```
G1 also creates each module handler file below as a stub that returns
`501 {"error":{"code":"not_implemented",...}}`, so the route table is complete from day one.

### M1-ordering
```
src/Stock.php            GET /api/stock: status derivation, stock_cache, fail-open
src/Products.php         GET /api/products: role-aware pricing
src/OrdersCreate.php     POST /api/orders
src/Hq.php               GET /api/hq/orders, POST /api/hq/orders/{id}/status
src/OrderView.php        shared order -> JSON serializer (M1 owns it; M2 calls it read-only)
bin/import-products.php  CSV upsert of the catalogue (cost and franchise prices)
public/index.html        login page
public/stock.html        stock view plus order form (truck), stock view only (franchise)
public/hq.html           HQ inbox of truck orders
public/assets/app.css    the only stylesheet, mobile-first
public/assets/app.js     fetch helper, login, logout, nav
public/assets/stock.js
public/assets/hq.js
```

### M2-history
```
src/OrdersRead.php       GET /api/orders, GET /api/orders/{id}
public/history.html
public/assets/history.js
```

Other test folders:
- `tests/e2e/**` belongs to the E2E node.
- `tests/security/**` belongs to the verifier.

## 2. Data model

The schema is portable between SQLite and MySQL. The types below are logical. Each schema file uses
its own dialect: `INTEGER PRIMARY KEY AUTOINCREMENT` in SQLite, `INT AUTO_INCREMENT` with InnoDB
and utf8mb4 in MySQL.

```
locations
  id            INTEGER PK
  name          VARCHAR(120) NOT NULL
  type          VARCHAR(16)  NOT NULL  CHECK (type IN ('hq','truck','franchise'))
  active        INTEGER NOT NULL DEFAULT 1

users
  id            INTEGER PK
  username      VARCHAR(60) NOT NULL UNIQUE
  password_hash VARCHAR(255) NOT NULL          -- password_hash(PASSWORD_BCRYPT)
  location_id   INTEGER NOT NULL FK -> locations.id
  active        INTEGER NOT NULL DEFAULT 1
  created_at    DATETIME NOT NULL
  -- role is NOT stored: role = locations.type of the user's location (D06)

products
  sku                    VARCHAR(20) PK
  name                   VARCHAR(150) NOT NULL
  category               VARCHAR(60)  NOT NULL
  unit                   VARCHAR(20)  NOT NULL
  moq                    INTEGER NOT NULL DEFAULT 1
  franchise_price_cents  INTEGER NOT NULL CHECK (>= 0)
  cost_price_cents       INTEGER NOT NULL CHECK (>= 0)
  fincon_item_no         VARCHAR(25) NULL          -- NULL = no FinCon mapping
  active                 INTEGER NOT NULL DEFAULT 1
  updated_at             DATETIME NOT NULL

orders
  id                  INTEGER PK
  location_id         INTEGER NOT NULL FK -> locations.id    -- always a 'truck' location
  created_by_user_id  INTEGER NOT NULL FK -> users.id
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','in_process','out_for_delivery','delivered'))
  note                VARCHAR(500) NULL
  subtotal_cents      INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents = 0)
  vat_cents           INTEGER NOT NULL DEFAULT 0 CHECK (vat_cents = 0)
  total_cents         INTEGER NOT NULL DEFAULT 0 CHECK (total_cents = 0)
  cost_total_cents    INTEGER NOT NULL CHECK (cost_total_cents >= 0)
  created_at          DATETIME NOT NULL
  status_updated_at   DATETIME NULL
  INDEX (location_id, created_at)

order_lines
  id                 INTEGER PK
  order_id           INTEGER NOT NULL FK -> orders.id
  sku                VARCHAR(20) NOT NULL
  product_name       VARCHAR(150) NOT NULL    -- snapshot
  unit               VARCHAR(20)  NOT NULL    -- snapshot
  qty                INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 999)
  unit_price_cents   INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents = 0)   -- truck = R0
  line_total_cents   INTEGER NOT NULL DEFAULT 0 CHECK (line_total_cents = 0)
  unit_cost_cents    INTEGER NOT NULL CHECK (unit_cost_cents >= 0)  -- cost snapshot at order time
  line_cost_cents    INTEGER NOT NULL CHECK (line_cost_cents >= 0)  -- qty * unit_cost_cents

stock_cache                  -- local cache of FinCon READS; the only stock data this app writes
  item_no     VARCHAR(25) PK
  in_stock    DECIMAL(12,3) NOT NULL
  synced_at   DATETIME NOT NULL
```

Hard rules on the data:
- Every row in `order_lines` has `unit_price_cents = 0`, `line_total_cents = 0`, and
  `unit_cost_cents` equal to the product's `cost_price_cents` at the moment the order was placed.
- Later changes to the cost price never change existing orders. The value is a snapshot.
- `VAT = 0`. Truck orders are internal transfers, not VAT invoices (locked decisions).

## 3. Roles

| Role (= location type) | Can |
|---|---|
| `truck` | log in; view stock; view products at R0 with cost; place orders for **its own location only**; read **its own location's** orders |
| `franchise` | log in; view stock status; view products at **franchise price only**. Every orders and HQ route returns **403** |
| `hq` | log in; view stock and products (the truck view); read **all** truck orders; move an order's status forward |

- Identity comes from the server session only. A `location_id`, `user_id`, price, cost, `status`
  or `role` field in any request body is ignored.
- **Franchise sessions never receive cost or truck pricing.** No franchise response contains the
  keys `cost_price`, `unit_cost`, `line_cost`, `cost_total`, `unit_price`, `line_total` or
  `truck_price`, at any depth. No franchise response contains any product's cost value.

## 4. Public HTTP API contract

### 4.1 Conventions
- **Base path:** `/api/`. On Apache without rewrite, the same route is reachable as
  `/api.php?route=/<path>` (D15). Tests use `/api/<path>`.
- **Requests with a body** (every POST except `/api/logout`) must send
  `Content-Type: application/json`. Anything else gets `415`. Malformed JSON, or a body that is not
  a JSON object, gets `422 validation_failed`.
- **Every API response:**
  - `Content-Type: application/json; charset=utf-8`
  - `Cache-Control: no-store`
  - **except** `204`, which has an empty body.
- **Error envelope:** `{"error":{"code":"<code>","message":"<human text>"}}`. For `422` the
  envelope may add `"fields":{"<field path>":"<reason>"}`.

| Status | `error.code` |
|---|---|
| 401 | `unauthenticated` (no or expired session) or `invalid_credentials` (login only) |
| 403 | `forbidden` |
| 404 | `not_found` (unknown route, unknown id, or another location's order) |
| 405 | `method_not_allowed` (known path, wrong method) |
| 409 | `invalid_transition` |
| 415 | `unsupported_media_type` |
| 422 | `validation_failed` |
| 501 | `not_implemented` (scaffold stubs only) |

- **Check order on every route:** authentication (401), then role (403), then content type (415),
  then validation (422), then existence (404 or 409).
  - So an unauthenticated request with a bad body gets 401.
  - A franchise user POSTing a bad body to `/api/orders` gets 403.
- **Session cookie:**
  - Name `TRUCKSESSID`. Set on successful login.
  - `HttpOnly`, `SameSite=Strict`, `Path=/`.
  - `Secure` unless `SESSION_COOKIE_SECURE=0`.
  - Lifetime 8 hours.
  - The session id is regenerated on login.
- **CSRF:** `SameSite=Strict` plus the JSON-only rule above (D19).
- **Money:** JSON numbers with at most 2 decimals, for example `210.5` or `0`. Tests compare
  numerically.
- **The `user` object**, used by login and `/api/me`:
  `{"id":int,"username":string,"role":"truck"|"franchise"|"hq","location":{"id":int,"name":string,"type":string}}`.
  It never contains `password_hash`.

### 4.2 The `order` object (truck and HQ only, never sent to franchise)
```json
{
  "id": 12,
  "location": {"id": 2, "name": "Xpresso Food Truck", "type": "truck"},
  "created_by": {"id": 2, "username": "truck1"},
  "status": "pending",
  "note": "for Friday",
  "created_at": "2026-10-06T10:15:00+02:00",
  "status_updated_at": null,
  "subtotal": 0, "vat_amount": 0, "total": 0,
  "cost_total": 585.1,
  "lines": [
    {"sku":"HOT011","name":"Coffee Beans 1kg","unit":"bag","qty":2,
     "unit_price":0,"line_total":0,"unit_cost":210.5,"line_cost":421},
    {"sku":"DAI006","name":"Full Cream Milk 2L","unit":"bottle","qty":6,
     "unit_price":0,"line_total":0,"unit_cost":27.35,"line_cost":164.1}
  ]
}
```
- `note` is `null` when it is absent.
- `cost_total` is the sum of every `line_cost`.
- Lines appear in the order they were submitted.

### 4.3 Routes

| # | Method and path | Roles | Module |
|---|---|---|---|
| R1 | `GET /api/health` | public | shared |
| R2 | `POST /api/login` | public | shared (G1), UI in M1 |
| R3 | `POST /api/logout` | public | shared |
| R4 | `GET /api/me` | any logged in | shared |
| R5 | `GET /api/stock` | truck, franchise, hq | M1 |
| R6 | `GET /api/products` | truck, franchise, hq | M1 |
| R7 | `POST /api/orders` | truck | M1 |
| R8 | `GET /api/hq/orders` | hq | M1 |
| R9 | `POST /api/hq/orders/{id}/status` | hq | M1 |
| R10 | `GET /api/orders` | truck | M2 |
| R11 | `GET /api/orders/{id}` | truck | M2 |

**R1 `GET /api/health`.** Returns `200 {"ok":true}`. No auth, no DB writes, no FinCon call.

**R2 `POST /api/login`.** Body: `{"username":string,"password":string}`.
- `200 {"user":<user>}` with `Set-Cookie: TRUCKSESSID=...`.
- `401 invalid_credentials` for an unknown user, a wrong password, an inactive user or an inactive
  location. All four give the identical body.
- `422 validation_failed` when either field is missing, empty or not a string.
- `415` when the content type is wrong.

**R3 `POST /api/logout`.** No body is needed. Destroys the session and expires the cookie.
Returns `204` whether or not anyone was logged in.

**R4 `GET /api/me`.** Returns `200 {"user":<user>}` or `401 unauthenticated`.

**R5 `GET /api/stock`.** Read-only FinCon stock view. Franchise visibility is status only (D10).
- `200`:
  ```json
  {
    "source": "fincon" | "cache" | "unavailable",
    "checked_at": "<ISO8601>",
    "items": [ {"sku":"HOT011","name":"Coffee Beans 1kg","category":"Hot Drinks","unit":"bag","status":"in_stock"} ]
  }
  ```
  - Every item has exactly these keys. There are no quantities and no prices.
  - Items are active products only, sorted by `category` then `sku`.
- **Status rules** (mirroring `get_stock.php`; `qty` is the FinCon `InStock` of the first
  `StockLoc`):
  1. If the product has no `fincon_item_no`, or FinCon did not return its ItemNo, or the read failed
     and there is no usable cache, the status is `in_stock` (fail open).
  2. If the `fincon_item_no` is shared by 2 or more active products, the status is `out_of_stock`
     when `qty <= 0`. Otherwise it is `in_stock`. It is never `low_stock`.
  3. Otherwise:
     - `qty <= 0` gives `out_of_stock`
     - `qty <= STOCK_THRESHOLD_LOW` (default 10) gives `low_stock`
     - anything else gives `in_stock`
- **Cache:**
  - Fresh rows in `stock_cache` (younger than `STOCK_CACHE_TTL_SECONDS`, default 900) are served
    with `source:"cache"` and no FinCon call. `0` disables the cache.
  - Otherwise the app reads FinCon, upserts `stock_cache`, and returns `source:"fincon"`.
  - If the FinCon read fails, the app serves cache rows younger than 48h with `source:"cache"`.
    With no such rows it returns `source:"unavailable"`, and every item is `in_stock`.
  - A FinCon failure **never** produces a non-200 response.
- Only the ItemNos of active products are requested from FinCon. Any ItemNo FinCon returns that
  was not requested is dropped and never stored (tenant boundary).

**R6 `GET /api/products`.** Active products, sorted by `category` then `sku`.
- **Truck and HQ:** `200 {"items":[{"sku","name","category","unit","moq","unit_price":0,"unit_cost":<cost>}]}`.
- **Franchise:** `200 {"items":[{"sku","name","category","unit","moq","price":<franchise_price>}]}`.
  Exactly these keys.

**R7 `POST /api/orders`.** Truck only. Franchise and HQ get `403`.
- **Body:** `{"lines":[{"sku":string,"qty":int}], "note"?: string}`.
- **`201 {"order":<order>}`.** The new order has these properties:
  - `status` is `pending`
  - `location` is the session user's location
  - every line has `unit_price:0` and `line_total:0`
  - every line has `unit_cost` equal to the product's current cost and `line_cost` equal to
    `qty * unit_cost`
  - `subtotal`, `vat_amount` and `total` are all `0`
  - `cost_total` is the sum of the line costs
- **`422 validation_failed`** for any of these:
  - `lines` is missing, not an array, empty, or has more than 50 entries
  - a line is not an object
  - `sku` is not a string, is unknown, or is inactive
  - `qty` is not an integer (JSON `2.0` is accepted as 2; `"2"`, `2.5`, `0`, `-1` and `1000` are
    rejected)
  - the same `sku` appears twice
  - `note` is not a string, or is longer than 500 characters

  Nothing is written when validation fails.
- Body fields other than `lines` and `note` are ignored. That covers `location_id`, `unit_price`,
  `unit_cost`, `price`, `status`, `user_id` and so on.
- `moq` is shown in the UI but not enforced (D24).
- **No FinCon call is made.** Placing an order never touches FinCon.
- Lines are written in a single transaction with their order.

**R8 `GET /api/hq/orders`.** HQ only. Truck and franchise get `403`.
- Optional query `?status=<one of the 4 statuses>`. Any other value gets `422`.
- `200 {"orders":[<order>...]}` with every truck location's orders.
  - Newest first: `created_at` descending, then `id` descending.
  - At most 200.

**R9 `POST /api/hq/orders/{id}/status`.** HQ only. Truck and franchise get `403`.
- **Body:** `{"status": "in_process"|"out_for_delivery"|"delivered"}`.
- **`200 {"order":<order>}`.** It has the new status and `status_updated_at` set.
- `404` for an unknown or non-integer id.
- `422` for a missing value, or a value that is not one of the 4 statuses.
- **`409 invalid_transition`** unless the new status is strictly later in the sequence
  `pending < in_process < out_for_delivery < delivered`. Forward skips are allowed.
- No FinCon call.

**R10 `GET /api/orders`.** Truck only. Franchise and HQ get `403`.
- `200 {"orders":[<order>...]}`, holding **only orders whose location is the session user's
  location**.
  - Newest first: `created_at` descending, then `id` descending.
  - At most 50.
- Query parameters such as `location_id` are ignored.

**R11 `GET /api/orders/{id}`.** Truck only. Franchise and HQ get `403`.
- `200 {"order":<order>}` when the order belongs to the session user's location.
- **`404 not_found`** when it belongs to another location, does not exist, or the id is not a
  positive integer. A 404 does not reveal whether the id exists (D18).

### 4.4 Pages (static; phone-first)

| Path | File | Module | Who |
|---|---|---|---|
| `/` | `public/index.html` | M1 | login |
| `/stock.html` | `public/stock.html` | M1 | truck (order form), franchise and hq (status only) |
| `/hq.html` | `public/hq.html` | M1 | hq |
| `/history.html` | `public/history.html` | M2 | truck |

**Element contract** (the E2E node drives these):
- **`/`:**
  - `form#login-form` containing `input#username`, `input#password` and `button#login-submit`
  - `#login-error`, which holds the error text
  - On success the page goes to `/hq.html` for an HQ user and to `/stock.html` otherwise.
- **`/stock.html`:**
  - `#stock-list`. Each product is an element with `data-sku="<sku>"` that contains an element with
    `data-status="<status>"`.
  - **Truck only:**
    - `input[data-qty-for="<sku>"]` (type number, min 0)
    - `button#place-order`
    - after success, `#order-confirmation` with `data-order-id="<id>"`
  - `a#nav-history` links to `/history.html`.
  - `button#logout`.
  - A logged-out visit redirects to `/`.
- **`/history.html`:**
  - `#history-list`. Each order is an element with `data-order-id="<id>"` that shows the status,
    the created date, the line count and the cost total.
  - `a#nav-stock`
  - `button#logout`
- **`/hq.html`:**
  - `#hq-orders`. Each order is `[data-order-id]`, with `button[data-next-status="<status>"]` for
    each allowed next status.
  - `button#logout`

**Phone-width rules** (D16). The acceptance tests check these statically:
1. Every page above contains `<meta name="viewport" content="width=device-width, initial-scale=1">`.
2. Every page links `/assets/app.css`.
3. No CSS served under `/assets/` has a `width` or `min-width` declaration with a px value greater
   than 360. Use `max-width` to contain desktop layouts.
4. `app.css` declares `min-height` of at least 44px (tap targets for `button` and `input`).
5. No page uses a `<table>` element. Lists use cards.

The E2E node also checks, with a real browser if one is installed, that at a 375x667 viewport each
page has `document.documentElement.scrollWidth <= 375`.

## 5. Integration: how truck orders reach HQ (D05)

Least risky option the reference supports: **HQ pulls the orders from a store it owns.** That is
the Control Tower pattern, but in the truck app's own database.

1. The truck user places an order (R7). It is stored in the truck app's own `orders` and
   `order_lines` tables, with status `pending`.
2. HQ warehouse staff log in to the truck app with an `hq` account. They see every truck order on
   `/hq.html` (R8) and move it forward as they pick and deliver it (R9). The status sequence is the
   same as the reference's.
3. The truck sees the status in its history (R10, R11).

What this deliberately does **not** do in phase 1:
- **No write to the reference `xpresso_clients.orders`.** That avoids polluting franchise revenue
  and region reports with R0 rows, avoids the region-scoping problem (the truck has no region), and
  avoids touching a live franchise table.
- **No email or WhatsApp.** Either would be an outbound vector.
- **No FinCon write.** Locked rule A2.
- If HQ later wants the order inside the Control Tower, that is a phase 2 change. It needs a
  reviewed decision.

## 6. Test harness contract (public; tests depend on this, not on code)

**Server start-up.** Each test file or suite:
1. Creates a temp dir.
2. Sets the environment below.
3. Runs `php bin/migrate.php` and then `php bin/seed.php test`.
4. Starts `php -S 127.0.0.1:<free port> -t public public/router.php`.
5. Polls `GET /api/health` until it returns 200.

The PHP binary is `PHP_BIN` if set, otherwise `php` on PATH.
```
APP_ENV=test
DB_DSN=sqlite:<tmpdir>/app.sqlite
SESSION_COOKIE_SECURE=0
SESSION_SAVE_PATH=<tmpdir>/sessions        (the app creates it if missing)
FINCON_ADAPTER=mock
FINCON_MOCK_STOCK=<tmpdir>/fincon-stock.json   (optional; re-read on every FinCon call)
FINCON_MOCK_LOG=<tmpdir>/fincon-calls.jsonl
STOCK_CACHE_TTL_SECONDS=0
```

**Mock FinCon:**
- **Stock source.** If `FINCON_MOCK_STOCK` is a file it is read on every call:
  - `{"items":{"<ItemNo>":<InStock number>,...}}` serves those quantities. ItemNos not listed are
    not returned.
  - `{"fail":true}` makes the read fail as unreachable.

  If the variable is unset or the file is missing, the mock serves the default quantities below.
- **Call log.** Every mock call appends one JSON line to `FINCON_MOCK_LOG`:
  `{"ts":"<ISO8601>","method":"Login"|"GetStockQuantitiesForOpt2"|"Logout","kind":"read","items":[...]}`.
  - `items` is present only for `GetStockQuantitiesForOpt2`.
  - The mock has no method that writes, so `kind` is always `"read"`.

**Fixtures** (`php bin/seed.php test`):
- On a fresh DB, ids are exactly as listed.
- The seed refuses (exit code 1, no writes) when `APP_ENV=production`.
- These are test-only passwords, not real secrets.

| locations.id | name | type |
|---|---|---|
| 1 | Xpresso HQ Warehouse | hq |
| 2 | Xpresso Food Truck | truck |
| 3 | Test Franchise Store | franchise |
| 4 | Test Truck Two | truck |

| username | password | location | active |
|---|---|---|---|
| hq1 | `TestPass-hq1` | 1 | 1 |
| truck1 | `TestPass-truck1` | 2 | 1 |
| franchise1 | `TestPass-franchise1` | 3 | 1 |
| truck2 | `TestPass-truck2` | 4 | 1 |
| truck_off | `TestPass-truckoff` | 2 | 0 |

| sku | name | category | unit | moq | franchise price | cost price | fincon_item_no | active |
|---|---|---|---|---|---|---|---|---|
| HOT011 | Coffee Beans 1kg | Hot Drinks | bag | 1 | 285.00 | 210.50 | BEANS | 1 |
| DAI006 | Full Cream Milk 2L | Dairy | bottle | 6 | 38.90 | 27.35 | MILK2L | 1 |
| PKD010 | Paper Cup 250ml x50 | Packaging | sleeve | 1 | 95.00 | 61.20 | CUP250 | 1 |
| PKD020 | Cup Lid 250ml x50 | Packaging | sleeve | 1 | 42.00 | 25.80 | CUPLID | 1 |
| PKD021 | Cup Lid 350ml x50 | Packaging | sleeve | 1 | 44.00 | 26.90 | CUPLID | 1 |
| SYR001 | Hazelnut Syrup 750ml | Syrups | bottle | 1 | 120.00 | 84.75 | (NULL) | 1 |
| PKD034 | Xpresso Coffee Cup | Packaging | each | 1 | 50.00 | 30.00 | CUP34 | 0 |

The seed creates no orders.

**Default mock FinCon quantities** and the stock statuses they must produce:

| ItemNo | InStock | Result |
|---|---|---|
| BEANS | 40 | HOT011 `in_stock` |
| MILK2L | 5 | DAI006 `low_stock` |
| CUP250 | 0 | PKD010 `out_of_stock` |
| CUPLID | 6 | PKD020 and PKD021 `in_stock` (shared code, never low) |
| CUP34 | 12 | not listed (PKD034 is inactive) |
| (none) | - | SYR001 `in_stock` (no mapping, fails open) |

**Worked example for the pricing check.** truck1 posts
`{"lines":[{"sku":"HOT011","qty":2},{"sku":"DAI006","qty":6}]}`. The response is `201` with these
line values:
- line 1: `unit_cost 210.5`, `line_cost 421`
- line 2: `unit_cost 27.35`, `line_cost 164.1`

And these totals:
- `cost_total 585.1`
- every `unit_price`, `line_total`, `subtotal`, `vat_amount` and `total` is `0`

## 7. Environment variables (`.env.example` holds placeholders only; the app never reads `.env` itself)

| Variable | Meaning |
|---|---|
| `APP_ENV` | `production`, `dev` or `test` |
| `DB_DSN` | `mysql:host=...;dbname=xpresso_truck;charset=utf8mb4`, or `sqlite:/path/app.sqlite` |
| `DB_USER`, `DB_PASS` | MySQL credentials (empty for SQLite) |
| `SESSION_COOKIE_SECURE` | `1` (default) or `0` (local http only) |
| `SESSION_SAVE_PATH` | Session file directory. Defaults to the PHP default |
| `FINCON_ADAPTER` | `tunnel` (production) or `mock` |
| `FINCON_BASE_URL` | FinCon tunnel base URL (the Cloudflare hostname). **Placeholder only in the repo** |
| `FINCON_CF_CLIENT_ID`, `FINCON_CF_CLIENT_SECRET` | Cloudflare Access service-token pair |
| `FINCON_SRV_USER`, `FINCON_SRV_PASS` | FinCon server HTTP Basic credentials |
| `FINCON_DATA_ID`, `FINCON_USER`, `FINCON_PASS` | FinCon Login `_parameters` |
| `FINCON_MOCK_STOCK`, `FINCON_MOCK_LOG` | Mock adapter only |
| `STOCK_CACHE_TTL_SECONDS` | Default 900. `0` disables the cache |
| `STOCK_THRESHOLD_LOW` | Default 10 |

**Real adapter rules** (`TunnelFinconStockReader`, mirroring the reference `fincon_client.php`):
- Calls only the DataSnap methods `Login`, `GetStockQuantitiesForOpt2` and `Logout`.
- Sends both auth layers on every call.
- Connect timeout 5s, request timeout 15s (30s per stock batch).
- Batches of 100 or fewer ItemNos.
- Always calls `Logout`, even after a failure.
- Maps 401 and 403 to auth failure, other non-2xx to unreachable, and an unparseable 2xx to error.
- The 15:25-15:30 SAST window maps to maintenance.
- Never logs credentials or response bodies.
- Every failure is returned to `Stock.php` as a failure value, which then fails open. It is never
  thrown as an uncaught exception.

## 8. Acceptance checks

Copied from the role spec, plus the locked rules that apply. Each needs at least one black-box test
in `tests/acceptance`.

| ID | Check (as written) | How it is tested |
|---|---|---|
| AC1 | **Truck user cannot read other locations' orders.** | truck2 places an order X. For truck1, `GET /api/orders/X` gives 404 and `GET /api/orders` (with or without `?location_id=4`) does not contain X. Franchise gets 403 on R10 and R11. Unauthenticated gets 401. hq1 sees X in R8 |
| AC2 | **Franchise users never see cost prices or truck pricing.** | As franchise1, deep-scan the parsed JSON bodies of R4, R5 and R6 for the forbidden keys in section 3, and for any numeric value equal to a fixture cost price (`210.5`, `27.35`, `61.2`, `25.8`, `26.9`, `84.75`, `30`). R6 shows `price` = franchise price. R7, R8, R9, R10 and R11 give 403 with no order data |
| AC3 | **Truck order lines are R0 and store the cost value.** | The worked example in section 6. A posted `unit_price:99` / `unit_cost:1` / `location_id:4` is ignored. Re-reading the order through R11 and R8 returns the same values |
| AC4 | **Nothing writes to FinCon.** | Drive R2, R5, R6, R7, R10, R11, R8 and R9. Every `FINCON_MOCK_LOG` line has `kind:"read"` and a method in {Login, GetStockQuantitiesForOpt2, Logout}. R7 and R9 add **zero** log lines. The static check: the DataSnap method names in `src/Fincon/TunnelFinconStockReader.php` are only those three, and the `FinconStockReader` interface declares no method whose name starts with set, update, insert, create, post, write, delete or save |
| AC5 | **UI usable at phone width.** | The section 4.4 phone-width rules 1-5 against `/`, `/stock.html`, `/history.html` and `/hq.html` |
| AC6 | Locked rule: **truck users CAN read FinCon stock** (the same status visibility as franchisees) | As truck1, R5 returns 200 with the default statuses in section 6. `{"fail":true}` gives 200 with `source:"unavailable"` and every item `in_stock` |
| AC7 | E2E smoke flow: truck user logs in on a phone-sized viewport -> views stock -> places an order -> sees it in order history | `tests/e2e` (E2E node). Through the API, plus a browser at 375x667 if one is available |

Supporting checks, also black-box:
- login returns 401 for a wrong password and for an inactive user
- the cookie is HttpOnly and SameSite=Strict
- logout followed by `/api/me` gives 401
- the 415 and 422 cases on R7
- the forward-only transitions and 409 on R9

## 9. Out of scope (phase 1)
- Sales and POS (A4).
- Delivery dates and cutoffs (D13).
- Any FinCon write (A2).
- Writes to the reference DB.
- Email and WhatsApp.
- Password reset.
- Regional franchise price overrides.
- Multi-truck management UI.
- Self-service user admin. Users come from `bin/create-user.php`.
