<?php
// Apply db/schema.<driver>.sql to DB_DSN. Idempotent (every statement is IF NOT EXISTS).
// Usage: php bin/migrate.php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/src/bootstrap.php';
require APP_SRC . '/Db.php';

try {
    $dsn = env('DB_DSN');
    if ($dsn === null) {
        fwrite(STDERR, "migrate: DB_DSN is not set\n");
        exit(1);
    }
    if (str_starts_with($dsn, 'sqlite:')) {
        $dir = dirname(substr($dsn, strlen('sqlite:')));
        if ($dir !== '' && !is_dir($dir)) {
            mkdir($dir, 0700, true);
        }
    }
    $pdo = Db::pdo();
    $driver = Db::driver($pdo);
    $file = APP_ROOT . '/db/schema.' . $driver . '.sql';
    if (!is_file($file)) {
        fwrite(STDERR, "migrate: no schema file for driver $driver\n");
        exit(1);
    }

    // Drop comment lines, then split on a semicolon that ends a line.
    $sql = preg_replace('/^\s*--.*$/m', '', (string) file_get_contents($file));
    $statements = array_values(array_filter(
        array_map('trim', preg_split('/;\s*(?:\r?\n|$)/', (string) $sql)),
        static fn (string $s): bool => $s !== ''
    ));
    foreach ($statements as $statement) {
        $pdo->exec($statement);
    }
    fwrite(STDOUT, 'migrate: applied ' . count($statements) . " statements ($driver)\n");
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'migrate: failed: ' . $e->getMessage() . "\n");
    exit(1);
}
