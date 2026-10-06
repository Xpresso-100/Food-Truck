<?php
// ============================================================
// M1-ordering - R7 POST /api/orders (SPEC 4.3)
// ============================================================
// Truck only (enforced by public/api.php, which also did the 415 check and parsed the
// JSON object into $ctx['body']). Lines are R0 with the cost value stored; the server
// computes every value and ignores price, cost, location and status in the body.
// No FinCon call. The order and its lines are written in one transaction.
// ============================================================

declare(strict_types=1);

require_once APP_SRC . '/OrderView.php';

const ORDER_MAX_LINES = 50;
const ORDER_MAX_QTY = 999;
const ORDER_NOTE_MAX = 500;

function orders_handle_create(array $ctx): array
{
    $user = $ctx['user'];
    [$lines, $note] = orders_validate_body($ctx['body'] ?? []);

    $id = Db::transaction(static function (PDO $pdo) use ($user, $lines, $note): int {
        $costTotal = 0;
        foreach ($lines as $line) {
            $costTotal += $line['line_cost_cents'];
        }
        $now = app_now();
        $pdo->prepare(
            'INSERT INTO orders (location_id, created_by_user_id, status, note, subtotal_cents, vat_cents, total_cents,
                                 cost_total_cents, created_at, status_updated_at)
             VALUES (?, ?, \'pending\', ?, 0, 0, 0, ?, ?, NULL)'
        )->execute([$user['location']['id'], $user['id'], $note, $costTotal, $now]);
        $orderId = (int) $pdo->lastInsertId();

        $insert = $pdo->prepare(
            'INSERT INTO order_lines (order_id, sku, product_name, unit, qty, unit_price_cents, line_total_cents,
                                      unit_cost_cents, line_cost_cents)
             VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)'
        );
        foreach ($lines as $line) {
            $insert->execute([$orderId, $line['sku'], $line['name'], $line['unit'], $line['qty'],
                $line['unit_cost_cents'], $line['line_cost_cents']]);
        }
        return $orderId;
    });

    $order = order_view_get($id, (int) $user['location']['id']);
    if ($order === null) {
        throw new RuntimeException('Order ' . $id . ' was written but cannot be read back');
    }
    return [201, ['order' => $order]];
}

/**
 * SPEC R7 validation. Only `lines` and `note` are read; every other body field is ignored.
 * Product names, units and costs come from the catalogue, never from the request.
 *
 * @return array{0: list<array>, 1: ?string} [lines with cost snapshot, note]
 */
function orders_validate_body(array $body): array
{
    $fields = [];

    $note = null;
    if (array_key_exists('note', $body) && $body['note'] !== null) {
        if (!is_string($body['note'])) {
            $fields['note'] = 'must be a string';
        } elseif (preg_match('/^.{0,' . ORDER_NOTE_MAX . '}$/su', $body['note']) !== 1) {
            $fields['note'] = 'must be at most ' . ORDER_NOTE_MAX . ' characters';
        } else {
            $note = $body['note'];
        }
    }

    $raw = $body['lines'] ?? null;
    if (!is_array($raw) || !array_is_list($raw) || $raw === []) {
        $fields['lines'] = 'must be a non-empty array';
        throw HttpError::validation($fields);
    }
    if (count($raw) > ORDER_MAX_LINES) {
        $fields['lines'] = 'must have at most ' . ORDER_MAX_LINES . ' entries';
        throw HttpError::validation($fields);
    }

    $parsed = [];
    $seen = [];
    foreach ($raw as $i => $line) {
        $path = 'lines[' . $i . ']';
        if (!is_array($line) || ($line !== [] && array_is_list($line))) {
            $fields[$path] = 'must be an object';
            continue;
        }
        $sku = $line['sku'] ?? null;
        if (!is_string($sku) || $sku === '') {
            $fields[$path . '.sku'] = 'must be a string';
        } elseif (isset($seen[$sku])) {
            $fields[$path . '.sku'] = 'appears more than once';
        } else {
            $seen[$sku] = true;
        }
        $qty = orders_parse_qty($line['qty'] ?? null);
        if ($qty === null) {
            $fields[$path . '.qty'] = 'must be an integer from 1 to ' . ORDER_MAX_QTY;
        }
        $parsed[] = ['path' => $path, 'sku' => is_string($sku) ? $sku : null, 'qty' => $qty];
    }

    $skus = array_keys($seen);
    $products = [];
    if ($skus !== []) {
        $stmt = Db::pdo()->prepare(
            'SELECT sku, name, unit, cost_price_cents FROM products
              WHERE active = 1 AND sku IN (' . implode(',', array_fill(0, count($skus), '?')) . ')'
        );
        $stmt->execute($skus);
        foreach ($stmt->fetchAll() as $row) {
            $products[(string) $row['sku']] = $row;
        }
    }
    foreach ($parsed as $p) {
        if ($p['sku'] !== null && !isset($fields[$p['path'] . '.sku']) && !isset($products[$p['sku']])) {
            $fields[$p['path'] . '.sku'] = 'unknown or inactive product';
        }
    }

    if ($fields !== []) {
        throw HttpError::validation($fields);
    }

    $lines = [];
    foreach ($parsed as $p) {
        $product = $products[$p['sku']];
        $unitCost = (int) $product['cost_price_cents'];
        $lines[] = [
            'sku'             => (string) $product['sku'],
            'name'            => (string) $product['name'],
            'unit'            => (string) $product['unit'],
            'qty'             => $p['qty'],
            'unit_cost_cents' => $unitCost,
            'line_cost_cents' => $p['qty'] * $unitCost,
        ];
    }
    return [$lines, $note];
}

/** An integer qty from 1 to 999. JSON 2.0 counts as 2; "2", 2.5, true and null do not. */
function orders_parse_qty(mixed $qty): ?int
{
    if (is_float($qty) && $qty >= 1 && $qty <= ORDER_MAX_QTY && floor($qty) === $qty) {
        $qty = (int) $qty;
    }
    if (!is_int($qty) || $qty < 1 || $qty > ORDER_MAX_QTY) {
        return null;
    }
    return $qty;
}
