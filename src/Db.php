<?php
// ============================================================
// Food Truck - PDO factory (shared, frozen after G1)
// ============================================================
// DB_DSN picks the driver: mysql:... in production (own database, never
// xpresso_clients), sqlite:... in tests and dev. Prepared statements only.
// ============================================================

declare(strict_types=1);

final class Db
{
    private static ?PDO $pdo = null;

    /** The shared connection for this request. ERRMODE_EXCEPTION, FETCH_ASSOC, native types. */
    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $dsn = env('DB_DSN');
            if ($dsn === null) {
                throw new RuntimeException('DB_DSN is not set');
            }
            self::$pdo = self::connect($dsn, env('DB_USER'), env('DB_PASS'));
        }
        return self::$pdo;
    }

    public static function connect(string $dsn, ?string $user = null, ?string $pass = null): PDO
    {
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        if (str_starts_with($dsn, 'sqlite:')) {
            $pdo = new PDO($dsn, null, null, $options);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 5000');
            return $pdo;
        }
        if (str_starts_with($dsn, 'mysql:')) {
            $pdo = new PDO($dsn, $user, $pass, $options);
            $pdo->exec("SET time_zone = '+02:00'");
            return $pdo;
        }
        throw new RuntimeException('DB_DSN must start with mysql: or sqlite:');
    }

    /** 'sqlite' or 'mysql'. Use it to pick dialect-specific SQL such as upserts. */
    public static function driver(?PDO $pdo = null): string
    {
        return (string) ($pdo ?? self::pdo())->getAttribute(PDO::ATTR_DRIVER_NAME);
    }

    /**
     * Run $fn inside a transaction; commit on return, roll back and rethrow on any exception.
     *
     * @template T
     * @param callable(PDO): T $fn
     * @return T
     */
    public static function transaction(callable $fn): mixed
    {
        $pdo = self::pdo();
        $pdo->beginTransaction();
        try {
            $result = $fn($pdo);
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }
}
