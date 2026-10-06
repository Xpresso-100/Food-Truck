<?php
// ============================================================
// M1-ordering - R5 GET /api/stock (SPEC 4.3)
// ============================================================
// Read-only FinCon stock status: status derivation, stock_cache, fail-open.
// Read FinCon only through fincon_stock_reader() (src/Fincon/factory.php).
// Roles truck, franchise and hq are already enforced by public/api.php.
//
// Flow:
//   1. fresh cache (every cached row for the requested ItemNos younger than the TTL)
//      -> source "cache", no FinCon call
//   2. otherwise read FinCon; on success replace the cache rows for the requested
//      ItemNos with exactly what FinCon returned -> source "fincon"
//   3. on failure, cache rows younger than 48h -> source "cache"; none -> "unavailable"
// A FinCon failure never produces a non-200 response. Quantities never leave this file.
// ============================================================

declare(strict_types=1);

require_once APP_SRC . '/Fincon/factory.php';

const STOCK_FALLBACK_MAX_AGE_SECONDS = 172800; // 48h

function stock_handle_get(array $ctx): array
{
    $products = Db::pdo()->query(
        'SELECT sku, name, category, unit, fincon_item_no
           FROM products
          WHERE active = 1
          ORDER BY category, sku'
    )->fetchAll();

    // How many active products share each ItemNo (shared codes are never low_stock).
    $shareCount = [];
    foreach ($products as $p) {
        $itemNo = stock_item_no($p);
        if ($itemNo !== null) {
            $shareCount[$itemNo] = ($shareCount[$itemNo] ?? 0) + 1;
        }
    }
    $itemNos = array_keys($shareCount);

    [$source, $quantities, $checkedAt] = stock_quantities($itemNos);

    $low = env_int('STOCK_THRESHOLD_LOW', 10);
    $items = [];
    foreach ($products as $p) {
        $itemNo = stock_item_no($p);
        $qty = $itemNo === null ? null : ($quantities[$itemNo] ?? null);
        $items[] = [
            'sku'      => (string) $p['sku'],
            'name'     => (string) $p['name'],
            'category' => (string) $p['category'],
            'unit'     => (string) $p['unit'],
            'status'   => stock_status($qty, $itemNo !== null && $shareCount[$itemNo] >= 2, $low),
        ];
    }

    return [200, ['source' => $source, 'checked_at' => $checkedAt, 'items' => $items]];
}

/** The product's FinCon ItemNo, or null when it has no mapping. */
function stock_item_no(array $product): ?string
{
    $itemNo = $product['fincon_item_no'];
    if ($itemNo === null) {
        return null;
    }
    $itemNo = trim((string) $itemNo);
    return $itemNo === '' ? null : $itemNo;
}

/** SPEC R5 status rules. $qty null = unknown, which fails open to in_stock. */
function stock_status(?float $qty, bool $sharedCode, int $lowThreshold): string
{
    if ($qty === null) {
        return 'in_stock';
    }
    if ($qty <= 0) {
        return 'out_of_stock';
    }
    if (!$sharedCode && $qty <= $lowThreshold) {
        return 'low_stock';
    }
    return 'in_stock';
}

/**
 * @param list<string> $itemNos
 * @return array{0: string, 1: array<string, float>, 2: string} [source, ItemNo => qty, checked_at ISO]
 */
function stock_quantities(array $itemNos): array
{
    $nowIso = app_iso(app_now());
    if ($itemNos === []) {
        return ['fincon', [], $nowIso];
    }

    $ttl = env_int('STOCK_CACHE_TTL_SECONDS', 900);
    if ($ttl > 0) {
        $cached = stock_cache_rows($itemNos, $ttl);
        if ($cached !== null) {
            return ['cache', $cached[0], app_iso($cached[1])];
        }
    }

    $result = fincon_stock_reader()->readStockQuantities($itemNos);
    if (($result['status'] ?? null) === FinconStockReader::OK && is_array($result['items'] ?? null)) {
        $wanted = array_flip($itemNos);
        $quantities = [];
        foreach ($result['items'] as $itemNo => $qty) {
            // Tenant boundary: an ItemNo that was not requested is dropped and never stored.
            if (isset($wanted[(string) $itemNo]) && (is_int($qty) || is_float($qty))) {
                $quantities[(string) $itemNo] = (float) $qty;
            }
        }
        stock_cache_replace($itemNos, $quantities);
        return ['fincon', $quantities, $nowIso];
    }

    error_log('STOCK | FinCon read failed (' . (string) ($result['status'] ?? 'unknown') . '); failing open');
    $fallback = stock_cache_rows($itemNos, STOCK_FALLBACK_MAX_AGE_SECONDS);
    if ($fallback !== null) {
        return ['cache', $fallback[0], app_iso($fallback[1])];
    }
    return ['unavailable', [], $nowIso];
}

/**
 * Cache rows for $itemNos when there is at least one and every one is younger than $maxAge.
 *
 * @param list<string> $itemNos
 * @return array{0: array<string, float>, 1: string}|null [ItemNo => qty, oldest synced_at]
 */
function stock_cache_rows(array $itemNos, int $maxAge): ?array
{
    $stmt = Db::pdo()->prepare(
        'SELECT item_no, in_stock, synced_at FROM stock_cache
          WHERE item_no IN (' . implode(',', array_fill(0, count($itemNos), '?')) . ')'
    );
    $stmt->execute($itemNos);
    $rows = $stmt->fetchAll();
    if ($rows === []) {
        return null;
    }
    $cutoff = (new DateTimeImmutable('now', app_tz()))->modify('-' . $maxAge . ' seconds')->format('Y-m-d H:i:s');
    $quantities = [];
    $oldest = null;
    foreach ($rows as $row) {
        $syncedAt = (string) $row['synced_at'];
        if ($syncedAt < $cutoff) {
            return null;
        }
        $oldest = ($oldest === null || $syncedAt < $oldest) ? $syncedAt : $oldest;
        $quantities[(string) $row['item_no']] = (float) $row['in_stock'];
    }
    return [$quantities, (string) $oldest];
}

/**
 * Make the cache rows for $itemNos match one successful FinCon read: upsert what FinCon
 * returned, delete what it did not. Cache trouble never fails the request.
 *
 * @param list<string> $itemNos
 * @param array<string, float> $quantities
 */
function stock_cache_replace(array $itemNos, array $quantities): void
{
    try {
        $now = app_now();
        Db::transaction(static function (PDO $pdo) use ($itemNos, $quantities, $now): void {
            $missing = array_values(array_diff($itemNos, array_keys($quantities)));
            if ($missing !== []) {
                $pdo->prepare('DELETE FROM stock_cache WHERE item_no IN (' . implode(',', array_fill(0, count($missing), '?')) . ')')
                    ->execute($missing);
            }
            $sql = Db::driver($pdo) === 'mysql'
                ? 'INSERT INTO stock_cache (item_no, in_stock, synced_at) VALUES (?, ?, ?)
                   ON DUPLICATE KEY UPDATE in_stock = VALUES(in_stock), synced_at = VALUES(synced_at)'
                : 'INSERT INTO stock_cache (item_no, in_stock, synced_at) VALUES (?, ?, ?)
                   ON CONFLICT(item_no) DO UPDATE SET in_stock = excluded.in_stock, synced_at = excluded.synced_at';
            $upsert = $pdo->prepare($sql);
            foreach ($quantities as $itemNo => $qty) {
                $upsert->execute([$itemNo, $qty, $now]);
            }
        });
    } catch (Throwable $e) {
        error_log('STOCK | stock_cache write failed: ' . $e->getMessage());
    }
}
