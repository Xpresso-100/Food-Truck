<?php
// ============================================================
// M1-ordering - R6 GET /api/products (SPEC 4.3)
// ============================================================
// Role-aware pricing. Truck and hq: unit_price 0 and unit_cost. Franchise: price only,
// never a cost value or truck pricing. Roles are already enforced by public/api.php.
// The franchise branch never selects the cost column, so it cannot leak.
// ============================================================

declare(strict_types=1);

function products_handle_list(array $ctx): array
{
    if ($ctx['user']['role'] === 'franchise') {
        $rows = Db::pdo()->query(
            'SELECT sku, name, category, unit, moq, franchise_price_cents
               FROM products WHERE active = 1 ORDER BY category, sku'
        )->fetchAll();
        $items = array_map(static fn(array $r): array => [
            'sku'      => (string) $r['sku'],
            'name'     => (string) $r['name'],
            'category' => (string) $r['category'],
            'unit'     => (string) $r['unit'],
            'moq'      => (int) $r['moq'],
            'price'    => Http::money((int) $r['franchise_price_cents']),
        ], $rows);
        return [200, ['items' => $items]];
    }

    // truck and hq: the truck view, R0 with the cost value
    $rows = Db::pdo()->query(
        'SELECT sku, name, category, unit, moq, cost_price_cents
           FROM products WHERE active = 1 ORDER BY category, sku'
    )->fetchAll();
    $items = array_map(static fn(array $r): array => [
        'sku'        => (string) $r['sku'],
        'name'       => (string) $r['name'],
        'category'   => (string) $r['category'],
        'unit'       => (string) $r['unit'],
        'moq'        => (int) $r['moq'],
        'unit_price' => 0,
        'unit_cost'  => Http::money((int) $r['cost_price_cents']),
    ], $rows);
    return [200, ['items' => $items]];
}
