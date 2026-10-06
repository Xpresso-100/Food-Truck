<?php
// Import the product catalogue (franchise and cost prices) from a CSV file.
// Usage:  php bin/import-products.php <file.csv>
// Header (exactly these columns, in this order):
//   sku,name,category,unit,moq,franchise_price,cost_price,fincon_item_no,active
// Prices are rands with at most 2 decimals (210.50). An empty fincon_item_no means no
// FinCon mapping. active is 1 or 0 (empty = 1).
// Upserts by sku in one transaction. Any invalid row: every error is printed, nothing is
// written, exit 1. Existing order lines are never touched: their cost is a snapshot.
// This writes only to the app's own products table; it never touches FinCon.
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/src/bootstrap.php';
require APP_SRC . '/Db.php';

const IMPORT_HEADER = ['sku', 'name', 'category', 'unit', 'moq', 'franchise_price', 'cost_price', 'fincon_item_no', 'active'];

/** Rands string to integer cents: "210.5" -> 21050. Null when not a valid non-negative amount. */
function import_cents(string $value): ?int
{
    $value = trim($value);
    if (preg_match('/^(\d{1,9})(?:\.(\d{1,2}))?$/', $value, $m) !== 1) {
        return null;
    }
    return (int) $m[1] * 100 + (int) str_pad($m[2] ?? '0', 2, '0');
}

/** Length in UTF-8 characters; invalid UTF-8 counts as too long. No mbstring needed. */
function import_len(string $value): int
{
    $n = preg_match_all('/./su', $value);
    return $n === false ? PHP_INT_MAX : $n;
}

/** @return array{0: ?array, 1: list<string>} [row ready to write, errors] */
function import_row(array $cells, int $lineNo): array
{
    $errors = [];
    if (count($cells) !== count(IMPORT_HEADER)) {
        return [null, ["line $lineNo: expected " . count(IMPORT_HEADER) . ' columns, got ' . count($cells)]];
    }
    $r = array_combine(IMPORT_HEADER, array_map(static fn($c): string => trim((string) $c), $cells));

    $text = ['sku' => 20, 'name' => 150, 'category' => 60, 'unit' => 20];
    foreach ($text as $field => $max) {
        if ($r[$field] === '' || import_len($r[$field]) > $max) {
            $errors[] = "line $lineNo: $field is required and at most $max characters";
        }
    }
    if ($r['sku'] !== '' && preg_match('/^[A-Za-z0-9._-]+$/', $r['sku']) !== 1) {
        $errors[] = "line $lineNo: sku may contain only letters, digits, dot, underscore and hyphen";
    }
    if (preg_match('/^[1-9]\d{0,5}$/', $r['moq']) !== 1) {
        $errors[] = "line $lineNo: moq must be a whole number of at least 1";
    }
    $franchise = import_cents($r['franchise_price']);
    $cost = import_cents($r['cost_price']);
    if ($franchise === null) {
        $errors[] = "line $lineNo: franchise_price must be an amount like 285.00";
    }
    if ($cost === null) {
        $errors[] = "line $lineNo: cost_price must be an amount like 210.50";
    }
    if (import_len($r['fincon_item_no']) > 25) {
        $errors[] = "line $lineNo: fincon_item_no is at most 25 characters";
    }
    if (!in_array($r['active'], ['', '0', '1'], true)) {
        $errors[] = "line $lineNo: active must be 1 or 0";
    }
    if ($errors !== []) {
        return [null, $errors];
    }
    return [[
        'sku'                   => $r['sku'],
        'name'                  => $r['name'],
        'category'              => $r['category'],
        'unit'                  => $r['unit'],
        'moq'                   => (int) $r['moq'],
        'franchise_price_cents' => $franchise,
        'cost_price_cents'      => $cost,
        'fincon_item_no'        => $r['fincon_item_no'] === '' ? null : $r['fincon_item_no'],
        'active'                => $r['active'] === '0' ? 0 : 1,
    ], []];
}

if ($argc !== 2) {
    fwrite(STDERR, "usage: php bin/import-products.php <file.csv>\n");
    exit(2);
}
$file = $argv[1];
if (!is_file($file) || !is_readable($file)) {
    fwrite(STDERR, "import-products: cannot read $file\n");
    exit(2);
}

$handle = fopen($file, 'rb');
$header = fgetcsv($handle, 0, ',', '"', '');
if ($header === false || $header === [null]) {
    fwrite(STDERR, "import-products: the file is empty\n");
    exit(1);
}
$header[0] = preg_replace('/^\xEF\xBB\xBF/', '', (string) $header[0]); // Excel BOM
$header = array_map(static fn($h): string => strtolower(trim((string) $h)), $header);
if ($header !== IMPORT_HEADER) {
    fwrite(STDERR, 'import-products: the header must be exactly: ' . implode(',', IMPORT_HEADER) . "\n");
    exit(1);
}

$rows = [];
$errors = [];
$seen = [];
$lineNo = 1;
while (($cells = fgetcsv($handle, 0, ',', '"', '')) !== false) {
    $lineNo++;
    if ($cells === [null]) {
        continue; // blank line
    }
    [$row, $rowErrors] = import_row($cells, $lineNo);
    if ($row !== null && isset($seen[$row['sku']])) {
        $rowErrors[] = "line $lineNo: sku {$row['sku']} already appears on line {$seen[$row['sku']]}";
    }
    if ($rowErrors !== []) {
        array_push($errors, ...$rowErrors);
        continue;
    }
    $seen[$row['sku']] = $lineNo;
    $rows[] = $row;
}
fclose($handle);

if ($errors !== []) {
    fwrite(STDERR, implode("\n", $errors) . "\nimport-products: " . count($errors) . " error(s); nothing was written\n");
    exit(1);
}
if ($rows === []) {
    fwrite(STDERR, "import-products: no product rows; nothing was written\n");
    exit(1);
}

try {
    [$inserted, $updated] = Db::transaction(static function (PDO $pdo) use ($rows): array {
        $exists = $pdo->prepare('SELECT 1 FROM products WHERE sku = ?');
        $insert = $pdo->prepare(
            'INSERT INTO products (sku, name, category, unit, moq, franchise_price_cents, cost_price_cents, fincon_item_no, active, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $update = $pdo->prepare(
            'UPDATE products SET name = ?, category = ?, unit = ?, moq = ?, franchise_price_cents = ?, cost_price_cents = ?,
                    fincon_item_no = ?, active = ?, updated_at = ?
              WHERE sku = ?'
        );
        $now = app_now();
        $inserted = 0;
        $updated = 0;
        foreach ($rows as $r) {
            $exists->execute([$r['sku']]);
            $found = $exists->fetchColumn() !== false;
            $exists->closeCursor();
            if ($found) {
                $update->execute([$r['name'], $r['category'], $r['unit'], $r['moq'], $r['franchise_price_cents'],
                    $r['cost_price_cents'], $r['fincon_item_no'], $r['active'], $now, $r['sku']]);
                $updated++;
            } else {
                $insert->execute([$r['sku'], $r['name'], $r['category'], $r['unit'], $r['moq'], $r['franchise_price_cents'],
                    $r['cost_price_cents'], $r['fincon_item_no'], $r['active'], $now]);
                $inserted++;
            }
        }
        return [$inserted, $updated];
    });
    fwrite(STDOUT, "import-products: inserted $inserted, updated $updated\n");
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'import-products: failed, nothing was written: ' . $e->getMessage() . "\n");
    exit(1);
}
