# CODEBASE_MAP - reference Xpresso ordering system (read-only)

Source studied: `C:\dev\ordering-ref` (added with `--add-dir`, read-only, not a git repo).
Studied by node G0 on 2026-10-06. Nothing in the reference was edited.
`file:line` references point into the reference folder.

Two things are deliberately left out of this file:
- The FinCon tunnel hostname. It is in the reference's `FINCON_TUNNEL_RUNBOOK.md` §3.
  It goes in an environment variable on the server and nowhere in this repo.
- Credential values. `config.php` is not in the reference folder and was not looked for.
  `files/submit_order.php:8-12` holds hardcoded live DB credentials. That is a security
  finding in the reference. The values are not copied here.

---

## 1. Stack and versions

| Layer | Reference | Evidence |
|---|---|---|
| Server language | PHP, flat files in the web root, no framework, no Composer | Root listing; no `composer.json` |
| PHP version (live) | **Unverified.** Code is written to be safe on 8.1+ (`mysqli_report(MYSQLI_REPORT_OFF)`) | `get_stock.php:86-101` ("live PHP version is unverified") |
| PHP version (local CLI) | 8.3.32 NTS x64 with `pdo_sqlite`, `sqlite3`, `pdo_mysql`, `mysqli`, `curl`, `session`, `mbstring` | `php -v`, `php -m` on this machine |
| Database | MySQL, schema `xpresso_clients`, accessed with `mysqli` and prepared statements | `create_orders_table.sql`, `G69_Phase1_migration.sql:96` |
| Config | Gitignored `config.php` with `define()` constants (`DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, `ADMIN_EMAIL`, `FINCON_*`). Filled in by hand on the live server | `.gitignore:6`, `fincon_client.php:14-16`, `FINCON_TUNNEL_RUNBOOK.md` §5 |
| Front end | Static HTML pages and vanilla JS, no build step. `client-api.js` is the API adapter. `products-data.js` is a legacy client-side catalogue | `client-api.js:27-31` |
| Tests | Two kinds. PHP runner scripts with stubs (`php tests/g67/run.php` and similar). Node built-in `node:test` files (`tests/pc/*.test.js`, `tests/ct/*.js`) | `tests/g67/README.md`, `tests/pc/client-api.test.js:1-5` |
| Local Node | v24.17.0, npm 11.13.0 | `node -v` |

## 2. Login and roles

There are two separate identity systems.

**Franchisee (client) login**
- `admin_api.php` with `action=client_login` takes a form POST with `username`, `email` and `password`.
  It checks the password with `password_verify` (bcrypt) against `clients.password`. It then sets
  `$_SESSION['client_id']` (`admin_api.php:26-77`).
- The session bootstrap is `require_client_auth.php:6-17`. Session lifetime is 8 hours. The
  cookie is `secure`, `httponly` and `SameSite=Strict`.
- `require_client_id()` returns the session client id, or sends a 401 JSON response and exits
  (`require_client_auth.php:23-30`). The rule is that identity never comes from the request body.
- Login returns the client's shops. The client picks a shop on the page. Shops are rows in `shops`
  (`client_id`, `region_id`).
- There is a forced password change on first login (`password_changed`, `admin_api.php:76`, `:86-125`).

**HQ and admin login**
- `admin_auth.php` issues a token and stores it in `admin_users.last_token` with a `token_expiry`.
- Requests send the token in an `X-Admin-Token` header.
- The guards are in `require_admin_auth.php`:
  - `require_admin_token()` checks that the token is valid (`:10-34`).
  - `require_hq_admin()` also requires `region_id IS NULL`, which marks an HQ super-admin (`:36+`).
  - `require_admin_context()` returns the admin's region so callers can scope queries
    (used in `get_all_orders.php:17-22`).
- `admin_users.is_ops_only` marks the warehouse ops tier. Ops accounts get an empty stock body
  (`get_stock.php:115-140`).

**What does not exist yet:** there is no "location type". Every ordering location is a franchise
`shop` with a region. Hub and truck are new location types, and the truck app defines them.

## 3. How a franchisee order reaches the warehouse today

1. The franchisee portal (`index.html`, `xpresso_franchisee_portal*.html`,
   `orders/pc/xpresso_client_portal_pc.html`) loads the catalogue from `get_products.php` and stock
   badges from `get_stock_public.php`.
2. `client-api.js` `submit()` posts JSON to `submit_order.php` (`client-api.js:327-340`).
3. `submit_order.php` does three things:
   - inserts an `orders` row with status `pending`
   - inserts one `order_items` row per cart line, with `unit_price` and `item_total`
   - emails a confirmation to the client and to `ADMIN_EMAIL` (`submit_order.php:66-201`)

   A 10:00 Africa/Johannesburg cutoff sets the earliest delivery date (`:35-64`).
4. HQ sees the order in the Control Tower (`xpresso_hq_control_tower_pc.html`, `ct-api.js`) through
   `get_all_orders.php`. That endpoint is admin-token gated and region-scoped (`get_all_orders.php:17-50`).
5. The warehouse then works the order:
   - delivery runs: `get_todays_runs.php`
   - shipped quantities: `update_order_fulfillment.php`, written to `order_fulfillment`
   - status changes: `update_order_status.php`, moving `pending -> in_process -> out_for_delivery -> delivered`.
     Each change can send a WhatsApp notice through `whatsapp_delivery.php`.
6. **No order is posted to FinCon.** Nothing in the reference writes to FinCon. Getting the order
   into FinCon is outside the system. [Inference: done by hand at HQ.]

**Discrepancy to know about [UNVERIFIED which copy is live]:**
- The local root `submit_order.php:23-28` takes `clientId` from the JSON body. Line 89 takes unit
  prices from the posted cart.
- `IDOR-HARDENING-SCOPE.md` and `client-api.js:142` both say the endpoint uses session identity and
  recomputes prices on the server.
- So the local copy may be stale. The truck app must not copy the body-trusting pattern.

## 4. How FinCon stock is read through the Cloudflare Tunnel, and where auth is checked

**Network path** (`FINCON_TUNNEL_RUNBOOK.md:8`):
xneelo PHP -> HTTPS with CF-Access headers -> Cloudflare edge (Access check) -> `cloudflared` on
the FinCon box -> FinCon DataSnap REST on `localhost:4090`.

**Client** (`fincon_client.php`):
- Two auth layers are needed on every call (`:76-101`):
  1. Cloudflare Access: `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers. If Access
     rejects them the response is HTTP 403.
  2. FinCon's own HTTP Basic auth (`FINCON_SRV_USER`, `FINCON_SRV_PASS`). If FinCon rejects them
     the response is HTTP 401.
- **Login:** `POST {FINCON_BASE_URL}/datasnap/rest/FinconAPI/"Login"/` with the JSON body
  `{"_parameters":[DATA_ID, USER, PASS, false]}`. It returns a `ConnectID` (`:219-254`).
  The quotes wrap the method name only and are sent literally (`:57-74`).
- **Stock read:** `POST .../"GetStockQuantitiesForOpt2"/<ConnectID>/` with the body
  `{"ItemList":[{"ItemNo":"..."}]}`, in batches of 100 or fewer.
  The response shape is `result[0].Stock[]`. Each item has an `ItemNo` and `StockLoc[]`.
  Each location has `LocNo`, `InStock`, `SalesOrders` and `PurchaseOrders`
  (`fincon_stock_sync.php:372-406`, `:480-490`).
- **Logout:** `GET .../"Logout"/<ConnectID>/`. It is best effort and always called (`:261-267`).
- **Typed outcomes:** `OK`, `FINCON_UNREACHABLE`, `FINCON_AUTH_FAILED`, `FINCON_MAINTENANCE`
  (daily 15:25-15:30 SAST, `:41-52`), and `FINCON_ERROR`.
  - Every non-2xx response is a hard failure (`:190-203`).
  - A 2xx with an unparseable body is `FINCON_ERROR`, never OK (`:285-305`).
- **Timeouts:** 5s to connect, 15s per request, 30s per batch.
- No credential is ever logged or echoed.

**Who calls it.** Only `fincon_stock_sync.php`, a cron job:
- It runs from the CLI, or over the web with `?token=` checked against `FINCON_SYNC_TOKEN`
  using `hash_equals`. Anything else gets a 403 (`:50-62`).
- It upserts the local table `stock_levels` (`sku, loc_no, in_stock, sales_orders, purchase_orders,
  synced_at`) (`G69_Phase1_migration.sql:96-106`).
- It writes one `fincon_sync_log` row per run.
- **Tenant boundary:** the FinCon item master is shared with another company (Hitek). The sync
  requests and keeps only ItemNos that map to `products.fincon_item_no`. Unknown ItemNos are counted
  but never named (`:237`, `:439-442`, `:473`).
- It never writes `stock`, `orders` or `order_items` (`:20-26`).

**Where auth is checked on stock reads:**
- `get_stock.php` needs an admin token (`:110-113`). Ops-only accounts get an empty body.
  It works out status from `stock_levels`:
  - quantity `<= 0` is `out_of_stock`, `<= 10` is `low_stock`, anything else is `in_stock`
  - data older than 48h counts as stale
  - **every uncertainty resolves to `in_stock`** (`:9-52`)
  - shared FinCon codes may only show in or out of stock, never low (`fincon_stock_sync.php:491-495`)
- `get_stock_public.php` has no auth. It returns a status map from the manual `stock` table, which
  feeds the franchisee badges.
- Franchisees cannot see FinCon-derived status yet. That is "Phase 3b" (`get_stock.php:30-32`).
- **"Same visibility as franchisees" therefore means a stock status per product. It does not mean
  quantities.**

## 5. Where cost and franchise prices come from

| Price | Source | Evidence |
|---|---|---|
| Franchise price | `products.price DECIMAL(10,2)`, keyed by `sku`. Served by `get_products.php` (live filter `WHERE active = 1`) | `G11_Phase1_products_table.sql:9-27`, `get_products.LIVE.php:26-31`, `get_stock.php:63-84` |
| Regional franchise override | `product_region_prices (sku, region_id, price, note)`, managed in `admin_region_prices_api.php` | `admin_region_prices_api.php:4-18`, `:251` |
| Legacy client-side list | `products-data.js` | file |
| **Cost price** | **Not present anywhere in the reference.** A search for `cost_price`, `cost`, `AverageCost` and `UnitCost` finds no schema column and no endpoint. The FinCon sync pulls quantities only | grep over the reference |
| FinCon mapping | `products.fincon_item_no VARCHAR(25) NULL` | `G11_Phase1_products_table.sql:17` |

Hub and truck pricing (cost, and R0 with cost stored) is new. See DECISIONS-LOG D08.

## 6. Dev command

The reference has no single dev command and no `package.json`. The ways it actually runs:
- **PHP suites:** `php run.php` from inside `tests/g65`, `tests/g67`, `tests/fincon_sync` or
  `tests/g69_stock_read`. The runners hard-code the local PHP path, copy the real endpoint beside the
  stubs and stub `config.php`.
- **JS suites:** `node --test` over `tests/pc` and `tests/ct`. [Inference from `require('node:test')`.]
- **Local server:** none is documented. [Inference: `php -S` would serve it.]

## 7. How the reference is deployed

Source: `DEPLOY_RUNBOOK.md`.
- **Host:** xneelo shared hosting. A single human deployer. No CI/CD and no git-based deploy.
- **Files:** uploaded by hand in xneelo File Manager into `public_html/orders/`.
  - Delete the old file first. Uploading over a file creates a silent `name(1).php` duplicate.
  - Check the filename and the byte size after upload.
  - After every PHP upload, flush OPcache: switch the PHP version and back in cPanel.
- **SQL:** run in phpMyAdmin, one statement at a time, each prefixed `USE xpresso_clients;`.
  The host fails on multi-statement submissions. Back up before any write.
- **Secrets:** `config.php` is edited by hand on the server and never committed.
- **Cron:** xneelo cron runs `fincon_stock_sync.php`.
- **Web root protection:** `.htaccess` denies `*.txt` and `*.log` (`.htaccess:1-9`). The reference
  folder has no rewrite rules. [UNVERIFIED: whether `mod_rewrite` is enabled on the host.]

## 8. What the truck app takes from this

| Take | Do not take |
|---|---|
| bcrypt plus a server-side session for identity. 8h lifetime, HttpOnly, SameSite=Strict | Identity or prices from the request body (local `submit_order.php:23-28`, `:89`) |
| JSON error bodies, prepared statements, `mysqli_report` off or PDO exceptions handled | Hardcoded credentials (`files/submit_order.php`) |
| The FinCon client shape: two auth layers, the quoted method name, Login -> GetStockQuantitiesForOpt2 -> Logout, typed failures, timeouts | Writing to the reference DB (`xpresso_clients`), the `stock` table, or `orders` |
| Stock status thresholds (0 / 10), fail-open to `in_stock`, the shared-code rule, ItemNo tenant filtering | Range scans of the FinCon item master |
| Order statuses `pending / in_process / out_for_delivery / delivered` | WhatsApp or email side effects (outbound vector, Rule of Two leg C) |
| Deploy by File Manager upload, schema run one statement at a time in phpMyAdmin | |
