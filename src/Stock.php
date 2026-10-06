<?php
// ============================================================
// M1-ordering - R5 GET /api/stock (SPEC 4.3)
// ============================================================
// Read-only FinCon stock status: status derivation, stock_cache, fail-open.
// Read FinCon only through fincon_stock_reader() (src/Fincon/factory.php).
// Roles truck, franchise and hq are already enforced by public/api.php.
// G1 stub: returns 501 until M1 builds it.
// ============================================================

declare(strict_types=1);

require_once APP_SRC . '/Fincon/factory.php';

function stock_handle_get(array $ctx): array
{
    throw HttpError::notImplemented();
}
