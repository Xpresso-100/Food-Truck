<?php
// ============================================================
// M1-ordering - R7 POST /api/orders (SPEC 4.3)
// ============================================================
// Truck only (enforced by public/api.php, which also did the 415 check and parsed the
// JSON object into $ctx['body']). Lines are R0 with the cost value stored; the server
// computes every value and ignores price, cost, location and status in the body.
// No FinCon call. G1 stub: returns 501 until M1 builds it.
// ============================================================

declare(strict_types=1);

function orders_handle_create(array $ctx): array
{
    throw HttpError::notImplemented();
}
