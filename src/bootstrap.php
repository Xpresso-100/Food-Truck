<?php
// ============================================================
// Food Truck - bootstrap (shared, frozen after G1)
// ============================================================
// Loaded first by public/api.php and every bin/ script.
//   - config from environment variables (the app never reads .env)
//   - Africa/Johannesburg time zone and timestamp helpers
//   - error handling: warnings become exceptions, nothing is displayed
//   - session configuration (started lazily by Auth, never here)
// ============================================================

declare(strict_types=1);

define('APP_ROOT', dirname(__DIR__));
define('APP_SRC', __DIR__);
define('APP_TZ', 'Africa/Johannesburg');

const SESSION_NAME = 'TRUCKSESSID';
const SESSION_LIFETIME = 28800; // 8 hours, same as the reference

date_default_timezone_set(APP_TZ);
error_reporting(E_ALL);
ini_set('display_errors', PHP_SAPI === 'cli' ? 'stderr' : '0');
ini_set('log_errors', '1');

// Warnings and notices become ErrorException so bugs fail loudly instead of
// producing half-written JSON. @-suppressed calls and deprecations are left alone.
set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    if ($severity === E_DEPRECATED || $severity === E_USER_DEPRECATED) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

// Optional gitignored config.local.php at the repo root, mirroring the reference's
// hand-edited config.php. It returns ['VAR' => 'value', ...] and only fills variables
// the real environment has not set. Never loaded under APP_ENV=test.
(static function (): void {
    $file = APP_ROOT . '/config.local.php';
    if (getenv('APP_ENV') === 'test' || !is_file($file)) {
        return;
    }
    $values = require $file;
    if (!is_array($values)) {
        return;
    }
    foreach ($values as $key => $value) {
        if (is_string($key) && preg_match('/^[A-Z][A-Z0-9_]*$/', $key) === 1
            && getenv($key) === false && (is_string($value) || is_int($value))) {
            putenv($key . '=' . $value);
        }
    }
})();

/** Environment variable, or $default when unset or empty. */
function env(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    if ($value === false && isset($_SERVER[$key]) && is_string($_SERVER[$key])) {
        $value = $_SERVER[$key];
    }
    if ($value === false || $value === '') {
        return $default;
    }
    return $value;
}

/** Integer environment variable, or $default when unset or not an integer. */
function env_int(string $key, int $default): int
{
    $value = env($key);
    if ($value === null || preg_match('/^-?\d+$/', trim($value)) !== 1) {
        return $default;
    }
    return (int) trim($value);
}

/** production | dev | test. Unset means production (the safest behaviour). */
function app_env(): string
{
    return env('APP_ENV', 'production');
}

function app_tz(): DateTimeZone
{
    static $tz = null;
    return $tz ??= new DateTimeZone(APP_TZ);
}

/** Current time as a DB DATETIME string ('Y-m-d H:i:s', Africa/Johannesburg). */
function app_now(): string
{
    return (new DateTimeImmutable('now', app_tz()))->format('Y-m-d H:i:s');
}

/**
 * DB DATETIME string (stored in Africa/Johannesburg) to ISO 8601 with offset,
 * e.g. '2026-10-06 10:15:00' -> '2026-10-06T10:15:00+02:00'. Null stays null.
 */
function app_iso(?string $dbDatetime): ?string
{
    if ($dbDatetime === null || $dbDatetime === '') {
        return null;
    }
    return (new DateTimeImmutable($dbDatetime, app_tz()))->format(DATE_ATOM);
}

/**
 * Configure and start the PHP session. Cookie TRUCKSESSID: HttpOnly, SameSite=Strict,
 * Path=/, 8h lifetime, Secure unless SESSION_COOKIE_SECURE=0. Strict mode rejects
 * session ids the server did not issue. Called by Auth only.
 */
function app_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $path = env('SESSION_SAVE_PATH');
    if ($path !== null) {
        if (!is_dir($path)) {
            @mkdir($path, 0700, true);
        }
        session_save_path($path);
    }
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    ini_set('session.gc_maxlifetime', (string) SESSION_LIFETIME);
    session_name(SESSION_NAME);
    session_cache_limiter('');
    session_set_cookie_params([
        'lifetime' => SESSION_LIFETIME,
        'path'     => '/',
        'secure'   => env('SESSION_COOKIE_SECURE', '1') !== '0',
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}
