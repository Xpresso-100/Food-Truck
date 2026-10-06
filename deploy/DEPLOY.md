# DEPLOY.md - Xpresso Food Truck

Same method as the Xpresso ordering system (CODEBASE_MAP.md section 7): **xneelo shared hosting,
files uploaded by hand in File Manager, SQL run in phpMyAdmin.** No git deploy, no command line.

## 1. What is in the bundle

`deploy/bundle/` is the upload. It holds `public/` (the website), `src/` (the server code) and
`config.local.php.example`. `deploy/MANIFEST.txt` lists every file with its byte size.
`deploy/sql/` is NOT uploaded; it is pasted into phpMyAdmin.

**There are no secrets in the bundle.** The one file with secrets, `config.local.php`, is made
separately (section 3) and handed over outside git and outside email-in-plain-text.

## 2. Upload steps (File Manager)

You need: the `bundle` folder, the ready `config.local.php` from the person who prepared it, and the
two SQL files.

**A. One-time hosting setup (xneelo / cPanel)**
1. Create a subdomain for the truck (for example `truck.<your domain>`).
2. Create a MySQL database and a database user with all rights on it. Write down the database name,
   user and password. This is a NEW database. Never use the ordering system's `xpresso_clients`.
3. Set the PHP version to 8.1 or newer. [UNVERIFIED: the reference's live PHP version was never
   confirmed. The code needs 8.0+ and the `pdo_mysql` and `curl` extensions, which are usual on xneelo.]

**B. Upload**
1. In File Manager, go to the folder you want the app to live in, for example `truck-app/`, **next to
   `public_html`, not inside it.** Navigate by clicking. Do not use the search bar.
2. Upload the contents of `bundle` so you have `truck-app/public/`, `truck-app/src/` and
   `truck-app/config.local.php.example`. Upload folder by folder if File Manager asks.
3. Upload the ready `config.local.php` into `truck-app/` itself (next to `public/` and `src/`, **not**
   inside `public/`).
4. Point the subdomain's **document root at `truck-app/public`**. This is required: the pages use
   absolute `/api` and `/assets` paths, and it keeps `src/` and `config.local.php` off the web.
5. **If a file already exists, delete it first, then upload.** Uploading over a file leaves a silent
   `name(1).php` copy and the old version stays live.
6. Check each uploaded file: exact name, no `(1)` suffix, size matches `MANIFEST.txt`. A mismatch
   means the wrong source: stop.
7. Flush OPcache: cPanel -> PHP Config -> switch the PHP version -> Save -> switch back -> Save.
   Skip this and old code keeps running.

**C. Database (phpMyAdmin)** - once, on first deploy only
1. Select the new database. Open `deploy/sql/01-schema.sql`.
2. Paste **one CREATE TABLE statement at a time** and run it (the host fails on several at once).
   There are 6 tables: locations, users, products, orders, order_lines, stock_cache. Running a
   statement twice is harmless.
3. Open `deploy/sql/02-first-data.sql` (already filled in by the person who prepared it) and run
   it one statement at a time: 2 locations, the users, the products.

## 3. Environment variables (go in `config.local.php`)

Shared hosting has no place to set real environment variables, so the app reads them from
`config.local.php` (the same pattern as the reference system's hand-edited `config.php`).
Copy `config.local.php.example`, rename it `config.local.php` and replace every `REPLACE_` value.

| Variable | In plain English |
|---|---|
| `APP_ENV` | Leave as `production`. It switches off test shortcuts. |
| `DB_DSN` | Tells the app where the database is: `mysql:host=localhost;dbname=<database name>;charset=utf8mb4`. Only change the database name. |
| `DB_USER` | The database user from step A2. |
| `DB_PASS` | That user's password. |
| `SESSION_COOKIE_SECURE` | Leave as `1`: login cookies only travel over https. Make sure the subdomain has an SSL certificate. |
| `FINCON_ADAPTER` | Leave as `tunnel`: read real stock from FinCon. |
| `FINCON_BASE_URL` | **The FinCon URL.** The Cloudflare Tunnel address that reaches the FinCon server, starting `https://`. Same address the ordering system uses (its `FINCON_TUNNEL_RUNBOOK.md` section 3). |
| `FINCON_CF_CLIENT_ID` | **Part of the FinCon key.** Cloudflare Access service-token ID: lets this server through Cloudflare. |
| `FINCON_CF_CLIENT_SECRET` | **Part of the FinCon key.** The matching Cloudflare token secret. |
| `FINCON_SRV_USER` | **Part of the FinCon key.** Username for the FinCon server's own login prompt. |
| `FINCON_SRV_PASS` | **Part of the FinCon key.** Its password. |
| `FINCON_DATA_ID` | Which FinCon company data set to read. |
| `FINCON_USER` | The FinCon user the app logs in as. Read-only use: the app only reads stock and never writes. |
| `FINCON_PASS` | That FinCon user's password. |
| `STOCK_CACHE_TTL_SECONDS` | How long (seconds) a stock reading is reused before asking FinCon again. `900` = 15 minutes. `0` = always ask. |
| `STOCK_THRESHOLD_LOW` | Stock at or below this number shows as "low". Default `10` (0 = out of stock). |

Not needed on the server: `FINCON_MOCK_STOCK`, `FINCON_MOCK_LOG` (test only; mock is refused in
production) and `SESSION_SAVE_PATH` (only if the host's default session folder is not writable).

The FinCon values are the same ones the ordering system already uses. They are copied from its live
`config.php` by whoever has access. They are never typed into git, a chat or an email body.

## 4. The 3 checks after upload

Do them in this order, on the live subdomain.

1. **The app is up.** Open `https://<truck subdomain>/api/health`. Pass: it shows `{"ok":true}`.
   If you get a 404 on `/api/...`, `mod_rewrite` may be off: try `/api.php?route=/health` and tell
   the developer.
2. **Login and live stock.** On a phone, open the subdomain and log in as the truck user. Pass: you
   land on the stock page and the line under the heading says **"Live stock from FinCon"**.
   "Stock from the last FinCon check" or "FinCon is unavailable" means the FinCon values in
   `config.local.php` are wrong or the tunnel is down. Orders can still be placed.
   Do not place a test order on the live system.
3. **Private files are blocked.** Open each of these. Pass: every one is refused (403 or 404), none
   shows code:
   `https://<truck subdomain>/config.local.php`, `/src/bootstrap.php`, `/.htaccess`.
   If any shows text or code, the document root is wrong (step B4). Fix it before anyone logs in.

## 5. Rebuilding the bundle (developer only)

After code changes: move the old `deploy/bundle` away, run `powershell -File deploy\build.ps1` from the
repo root, regenerate `MANIFEST.txt`, commit. Passwords for the first users: `php deploy/tools/make-hash.php`.
