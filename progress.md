# progress.md - Food Truck pipeline

## 2026-10-06 - G0 DISCOVER (done)

**What was done**
- Studied the reference ordering system at `C:\dev\ordering-ref`, read-only. Nothing in it was edited.
- Wrote `CODEBASE_MAP.md`. It covers the stack, the two login systems, the franchise order flow to
  the warehouse, the FinCon tunnel client and where auth is checked, and the price sources. One
  finding there: the reference has **no cost price**. It also covers the test style and the xneelo
  File Manager deploy.
- Wrote `SPEC.md`:
  - file ownership for the scaffold, M1-ordering and M2-history
  - a portable SQLite/MySQL data model with R0 CHECK constraints
  - the public HTTP API contract: routes R1-R11, payloads, status codes and roles
  - the element contract for the pages, the phone-width rules, and the test harness contract
    (env vars, mock FinCon, fixtures, a worked pricing example)
  - acceptance checks AC1-AC7
  - the HQ integration method: HQ pulls orders from the truck app's own DB through an HQ inbox
- Wrote `feature_list.json` with 20 features: 5 scaffold, 12 M1, 3 M2. All have `passes:false`.
- Started `DECISIONS-LOG.md` with A2, A4, A5 and D01-D26.
- Wrote no application code.

**Flags for the human, not blockers:**
- Cost price source (D08): it will come from a CSV import, because the reference has none.
  Jolandi or HQ finance must supply cost prices per SKU.
- Reference security findings (D21). Both belong to the reference repo owner.
  - `files/submit_order.php` holds hardcoded live DB credentials.
  - The local root `submit_order.php` trusts `clientId` and prices from the request body.
- [UNVERIFIED] whether `mod_rewrite` is enabled on xneelo. The `api.php?route=` fallback covers it.

**Next: G1 SCAFFOLD + ACCEPTANCE TESTS**
- Build the "Shared (G1 scaffold)" file list in SPEC §1. Create a stub for each module handler.
- Write `tests/acceptance` for AC1-AC6, black-box, through the SPEC §6 harness.
- Write `.pipeline/test-cmd.txt`. Suggested:
  `node --test --test-concurrency=1 "tests/smoke/**/*.test.mjs" "tests/acceptance/**/*.test.mjs"`
- The tests must use `SESSION_COOKIE_SECURE=0` and a temp `SESSION_SAVE_PATH`. Windows `php -S`
  sessions fail without one.

## 2026-10-06 - G1 SCAFFOLD + ACCEPTANCE TESTS (done)

**What was done**
- Built the shared scaffold from SPEC §1. These files are frozen from now on:
  - .gitignore, .env.example (placeholders only), package.json, package-lock.json (no dependencies)
  - public/api.php: the front controller. It holds the full R1-R11 route table, and checks
    404/405, then 401/403, then 415 and the JSON-object 422, centrally.
  - public/router.php, public/.htaccess
  - src/bootstrap.php, src/Http.php (HttpError, Http::send, jsonBody, money, positiveId), src/Db.php, src/Auth.php
  - src/Fincon/: the read-only interface, the mock with its JSON-lines log, the tunnel adapter
    (env only, 3 DataSnap methods), and factory.php
  - db/schema.sqlite.sql and db/schema.mysql.sql: every table, for all modules
  - bin/migrate.php, bin/seed.php test, bin/create-user.php
  - deny-all .htaccess files in src/, bin/ and db/
- Module handler stubs return 501: src/Stock.php, Products.php, OrdersCreate.php, Hq.php,
  OrdersRead.php. src/OrderView.php is an empty placeholder that M1 owns.
- Tests (Node built-in runner, zero dependencies):
  - tests/support: the harness, fixtures and contract helpers
  - tests/smoke/app-starts.test.mjs: health, idempotent migrate, php -l on every PHP file, the
    seed refusing in production
  - tests/acceptance, frozen: ac1-ac6, plus auth-session, orders-validation, hq-status and
    api-conventions. 105 tests in total.
- `.pipeline/test-cmd.txt` holds one line:
  `node --test --test-concurrency=1 --test-reporter=spec "tests/smoke/**/*.test.mjs" "tests/acceptance/**/*.test.mjs"`
- Logged decisions G1-01 to G1-12 in DECISIONS-LOG.md.

**Evidence**
- In this repo the full command exits 1: 32 pass, 73 fail. Smoke and auth pass. Everything
  that needs a module fails on 501.
- To prove the frozen tests can be passed, I put a throwaway reference implementation in a temp
  copy outside the repo. It was never committed. With it, the same command run through PowerShell
  Invoke-Expression exits 0 with 105/105 passing.
- 9 seeded bugs were each caught: cost leaked to franchise, cross-location list and get, location
  taken from the body, inactive ItemNo requested, same-status transition, wide CSS, qty 1000, and
  a missing shared-code rule.

**For the build node (G2, MODULE=all)**
- Skip the feature_list entries with module "scaffold" (S01-S05). G1 delivered them.
- Implement inside the module files only. The handler contract is in the public/api.php header:
  - read `$ctx['user']`, `$ctx['params']`, `$ctx['query']` and `$ctx['body']`
  - return `[status, payload]`, or throw `HttpError::validation()` / `::notFound()` / `::invalidTransition()`
  - roles, 401, 403, 415 and the JSON-object check are already done before the handler runs
- Helpers already available:
  - `Db::pdo()`, `Db::driver()` (for the sqlite or mysql upsert), `Db::transaction()`
  - `app_now()` and `app_iso()` for timestamps, `env_int()` for config
  - `Http::money()` for money, `Http::positiveId()` for ids
  - `fincon_stock_reader()->readStockQuantities($itemNos)`, which returns `['status','items','error']`
    and never throws
- M1 also owns: public/index.html, stock.html, hq.html, assets/app.css, app.js, stock.js, hq.js,
  and bin/import-products.php. M2 owns history.html and assets/history.js.
- AC5 needs these in app.css: a `button` rule and an `input` rule, each with `min-height: 44px`.
  No width or min-width above 360px anywhere, including inline styles. Use max-width. No `<table>`.

**Flags (not blockers)**
- There is no login throttling in phase 1.
- Production locations (HQ and the truck) need rows in `locations` before
  `bin/create-user.php` can be used. G5 should supply the SQL in deploy/DEPLOY.md.
- Whether SetEnv works on xneelo is [UNVERIFIED]. config.local.php is the fallback (G1-02).
