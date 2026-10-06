<?php
// ============================================================
// M2-history - R10 GET /api/orders, R11 GET /api/orders/{id} (SPEC 4.3)
// ============================================================
// Truck only (enforced by public/api.php). Only the session user's location's orders;
// another location's order is 404, identical to a missing id. Query parameters such as
// location_id are ignored. Serialise with src/OrderView.php (M1-owned, read-only here).
// G1 stub: returns 501 until M2 builds it.
// ============================================================

declare(strict_types=1);

require_once APP_SRC . '/OrderView.php';

function orders_handle_list(array $ctx): array
{
    throw HttpError::notImplemented();
}

function orders_handle_get(array $ctx): array
{
    throw HttpError::notImplemented();
}
