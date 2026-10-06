<?php
// ============================================================
// M1-ordering - R8 GET /api/hq/orders, R9 POST /api/hq/orders/{id}/status (SPEC 4.3)
// ============================================================
// HQ only (enforced by public/api.php). $ctx['params']['id'] is the raw path segment;
// Http::positiveId() turns it into an int or null (null = 404). No FinCon call.
// G1 stub: returns 501 until M1 builds it.
// ============================================================

declare(strict_types=1);

function hq_handle_list_orders(array $ctx): array
{
    throw HttpError::notImplemented();
}

function hq_handle_update_status(array $ctx): array
{
    throw HttpError::notImplemented();
}
