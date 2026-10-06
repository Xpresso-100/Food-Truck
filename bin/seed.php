<?php
// Load the SPEC section 6 test fixtures.
// Usage: php bin/seed.php test
// Refuses (exit 1, no writes) when APP_ENV=production - and APP_ENV unset counts as production.
// On a fresh database the ids are exactly as in SPEC section 6. On a database that already
// holds locations, users or products it writes nothing and exits 0.
// The passwords below are test-only fixtures from SPEC section 6, not real secrets.
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/src/bootstrap.php';
require APP_SRC . '/Db.php';

$set = $argv[1] ?? '';
if ($set !== 'test') {
    fwrite(STDERR, "usage: php bin/seed.php test\n");
    exit(2);
}
if (app_env() === 'production') {
    fwrite(STDERR, "seed: refusing to run with APP_ENV=production (set APP_ENV=test or dev)\n");
    exit(1);
}

$locations = [
    [1, 'Xpresso HQ Warehouse', 'hq'],
    [2, 'Xpresso Food Truck', 'truck'],
    [3, 'Test Franchise Store', 'franchise'],
    [4, 'Test Truck Two', 'truck'],
];

// [id, username, password, location_id, active]
$users = [
    [1, 'hq1', 'TestPass-hq1', 1, 1],
    [2, 'truck1', 'TestPass-truck1', 2, 1],
    [3, 'franchise1', 'TestPass-franchise1', 3, 1],
    [4, 'truck2', 'TestPass-truck2', 4, 1],
    [5, 'truck_off', 'TestPass-truckoff', 2, 0],
];

// [sku, name, category, unit, moq, franchise_price_cents, cost_price_cents, fincon_item_no, active]
$products = [
    ['HOT011', 'Coffee Beans 1kg', 'Hot Drinks', 'bag', 1, 28500, 21050, 'BEANS', 1],
    ['DAI006', 'Full Cream Milk 2L', 'Dairy', 'bottle', 6, 3890, 2735, 'MILK2L', 1],
    ['PKD010', 'Paper Cup 250ml x50', 'Packaging', 'sleeve', 1, 9500, 6120, 'CUP250', 1],
    ['PKD020', 'Cup Lid 250ml x50', 'Packaging', 'sleeve', 1, 4200, 2580, 'CUPLID', 1],
    ['PKD021', 'Cup Lid 350ml x50', 'Packaging', 'sleeve', 1, 4400, 2690, 'CUPLID', 1],
    ['SYR001', 'Hazelnut Syrup 750ml', 'Syrups', 'bottle', 1, 12000, 8475, null, 1],
    ['PKD034', 'Xpresso Coffee Cup', 'Packaging', 'each', 1, 5000, 3000, 'CUP34', 0],
];

try {
    $pdo = Db::pdo();
    foreach (['locations', 'users', 'products'] as $table) {
        if ((int) $pdo->query("SELECT COUNT(*) FROM $table")->fetchColumn() > 0) {
            fwrite(STDOUT, "seed: database already has data in $table; nothing written\n");
            exit(0);
        }
    }

    $now = app_now();
    Db::transaction(static function (PDO $pdo) use ($locations, $users, $products, $now): void {
        $stmt = $pdo->prepare('INSERT INTO locations (id, name, type, active) VALUES (?, ?, ?, 1)');
        foreach ($locations as $row) {
            $stmt->execute($row);
        }
        $stmt = $pdo->prepare('INSERT INTO users (id, username, password_hash, location_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($users as [$id, $username, $password, $locationId, $active]) {
            $stmt->execute([$id, $username, password_hash($password, PASSWORD_BCRYPT), $locationId, $active, $now]);
        }
        $stmt = $pdo->prepare(
            'INSERT INTO products (sku, name, category, unit, moq, franchise_price_cents, cost_price_cents, fincon_item_no, active, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($products as $row) {
            $stmt->execute([...$row, $now]);
        }
    });
    fwrite(STDOUT, 'seed: loaded test fixtures (' . count($locations) . ' locations, ' . count($users)
        . ' users, ' . count($products) . " products)\n");
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'seed: failed: ' . $e->getMessage() . "\n");
    exit(1);
}
