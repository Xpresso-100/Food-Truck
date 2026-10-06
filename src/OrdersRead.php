<?php
// ============================================================
// M2-history - R10 GET /api/orders, R11 GET /api/orders/{id} (SPEC 4.3)
// ============================================================
// Truck only (enforced by public/api.php). Only the session user's location's orders;
// another location's order is 404, identical to a missing id. Query parameters such as
// location_id are ignored. Serialise with src/OrderView.php (M1-owned, read-only here).
// ============================================================

declare(strict_types=1);

require_once APP_SRC . '/OrderView.php';

const HISTORY_LIMIT = 50;

/** R10 - the session location's orders, newest first, at most 50. */
function orders_handle_list(array $ctx): array
{
    $locationId = (int) $ctx['user']['location']['id'];
    return [200, ['orders' => order_view_list($locationId, null, HISTORY_LIMIT)]];
}

/** R11 - one order of the session location; anything else is the same 404. */
function orders_handle_get(array $ctx): array
{
    $id = Http::positiveId($ctx['params']['id'] ?? null);
    if ($id === null) {
        throw HttpError::notFound();
    }
    $order = order_view_get($id, (int) $ctx['user']['location']['id']);
    if ($order === null) {
        throw HttpError::notFound();
    }
    return [200, ['order' => $order]];
}
