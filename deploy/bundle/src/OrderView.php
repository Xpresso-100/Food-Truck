<?php
// ============================================================
// M1-ordering - shared order -> JSON serializer (SPEC 4.2)
// ============================================================
// Owned by M1. M2 (src/OrdersRead.php) calls it read-only.
// Builds the SPEC 4.2 `order` object from orders + order_lines rows: money through
// Http::money(), timestamps through app_iso(). Never sent to franchise users.
//
// Scoping is the caller's job: pass $locationId for a truck user (their own location
// only), null for HQ (every truck location). Only 'truck' locations are ever returned.
// ============================================================

declare(strict_types=1);

/** The status sequence. A change is allowed only to a strictly later status (SPEC R9). */
const ORDER_STATUSES = ['pending', 'in_process', 'out_for_delivery', 'delivered'];

/**
 * Orders newest first (created_at desc, then id desc), as SPEC 4.2 order objects.
 *
 * @return list<array>
 */
function order_view_list(?int $locationId, ?string $status, int $limit): array
{
    $where = ["l.type = 'truck'"];
    $params = [];
    if ($locationId !== null) {
        $where[] = 'o.location_id = ?';
        $params[] = $locationId;
    }
    if ($status !== null) {
        $where[] = 'o.status = ?';
        $params[] = $status;
    }
    $limit = max(1, $limit);
    return order_view_query(implode(' AND ', $where), $params, $limit);
}

/** One order by id, or null when it does not exist or is outside $locationId (when given). */
function order_view_get(int $id, ?int $locationId): ?array
{
    $where = "l.type = 'truck' AND o.id = ?";
    $params = [$id];
    if ($locationId !== null) {
        $where .= ' AND o.location_id = ?';
        $params[] = $locationId;
    }
    return order_view_query($where, $params, 1)[0] ?? null;
}

/**
 * @param string $where built only from the fixed fragments above; values go in $params
 * @return list<array>
 */
function order_view_query(string $where, array $params, int $limit): array
{
    $pdo = Db::pdo();
    $stmt = $pdo->prepare(
        'SELECT o.id, o.location_id, o.created_by_user_id, o.status, o.note, o.subtotal_cents, o.vat_cents,
                o.total_cents, o.cost_total_cents, o.created_at, o.status_updated_at,
                l.name AS location_name, l.type AS location_type, u.username AS created_by_username
           FROM orders o
           JOIN locations l ON l.id = o.location_id
           JOIN users u ON u.id = o.created_by_user_id
          WHERE ' . $where . '
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT ' . (int) $limit
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    if ($rows === []) {
        return [];
    }

    $ids = array_map(static fn(array $r): int => (int) $r['id'], $rows);
    $lineStmt = $pdo->prepare(
        'SELECT order_id, sku, product_name, unit, qty, unit_price_cents, line_total_cents, unit_cost_cents, line_cost_cents
           FROM order_lines
          WHERE order_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')
          ORDER BY order_id, id'
    );
    $lineStmt->execute($ids);
    $linesByOrder = [];
    foreach ($lineStmt->fetchAll() as $line) {
        $linesByOrder[(int) $line['order_id']][] = order_view_line($line);
    }

    $orders = [];
    foreach ($rows as $row) {
        $orders[] = order_view_order($row, $linesByOrder[(int) $row['id']] ?? []);
    }
    return $orders;
}

function order_view_order(array $row, array $lines): array
{
    return [
        'id'                => (int) $row['id'],
        'location'          => [
            'id'   => (int) $row['location_id'],
            'name' => (string) $row['location_name'],
            'type' => (string) $row['location_type'],
        ],
        'created_by'        => [
            'id'       => (int) $row['created_by_user_id'],
            'username' => (string) $row['created_by_username'],
        ],
        'status'            => (string) $row['status'],
        'note'              => $row['note'] === null ? null : (string) $row['note'],
        'created_at'        => app_iso((string) $row['created_at']),
        'status_updated_at' => app_iso($row['status_updated_at'] === null ? null : (string) $row['status_updated_at']),
        'subtotal'          => Http::money((int) $row['subtotal_cents']),
        'vat_amount'        => Http::money((int) $row['vat_cents']),
        'total'             => Http::money((int) $row['total_cents']),
        'cost_total'        => Http::money((int) $row['cost_total_cents']),
        'lines'             => $lines,
    ];
}

function order_view_line(array $line): array
{
    return [
        'sku'        => (string) $line['sku'],
        'name'       => (string) $line['product_name'],
        'unit'       => (string) $line['unit'],
        'qty'        => (int) $line['qty'],
        'unit_price' => Http::money((int) $line['unit_price_cents']),
        'line_total' => Http::money((int) $line['line_total_cents']),
        'unit_cost'  => Http::money((int) $line['unit_cost_cents']),
        'line_cost'  => Http::money((int) $line['line_cost_cents']),
    ];
}
