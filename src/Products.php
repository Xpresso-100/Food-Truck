<?php
// ============================================================
// M1-ordering - R6 GET /api/products (SPEC 4.3)
// ============================================================
// Role-aware pricing. Truck and hq: unit_price 0 and unit_cost. Franchise: price only,
// never a cost value or truck pricing. Roles are already enforced by public/api.php.
// G1 stub: returns 501 until M1 builds it.
// ============================================================

declare(strict_types=1);

function products_handle_list(array $ctx): array
{
    throw HttpError::notImplemented();
}
