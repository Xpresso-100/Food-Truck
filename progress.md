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
