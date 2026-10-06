<?php
// Create a login for a location. The password is read from the first line of STDIN and
// stored as a bcrypt hash; it never appears on the command line.
// Usage:  php bin/create-user.php <username> <location_id>  < password-file
// The user's role is the type of the location (hq | truck | franchise).
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/src/bootstrap.php';
require APP_SRC . '/Db.php';
require APP_SRC . '/Http.php';
require APP_SRC . '/Auth.php';

const MIN_PASSWORD_LENGTH = 10;

if ($argc !== 3) {
    fwrite(STDERR, "usage: php bin/create-user.php <username> <location_id>   (password on STDIN)\n");
    exit(2);
}
$username = Auth::normaliseUsername($argv[1]);
if (preg_match('/^[a-z0-9._-]{3,60}$/', $username) !== 1) {
    fwrite(STDERR, "create-user: username must be 3-60 characters: a-z, 0-9, dot, underscore, hyphen\n");
    exit(2);
}
if (preg_match('/^[1-9][0-9]*$/', $argv[2]) !== 1) {
    fwrite(STDERR, "create-user: location_id must be a positive integer\n");
    exit(2);
}
$locationId = (int) $argv[2];

$line = fgets(STDIN);
$password = $line === false ? '' : rtrim($line, "\r\n");
if (strlen($password) < MIN_PASSWORD_LENGTH) {
    fwrite(STDERR, 'create-user: password (first line of STDIN) must be at least ' . MIN_PASSWORD_LENGTH . " characters\n");
    exit(2);
}

try {
    $pdo = Db::pdo();
    $stmt = $pdo->prepare('SELECT id, name, type, active FROM locations WHERE id = ?');
    $stmt->execute([$locationId]);
    $location = $stmt->fetch();
    if ($location === false || (int) $location['active'] !== 1) {
        fwrite(STDERR, "create-user: location $locationId does not exist or is inactive\n");
        exit(1);
    }
    $stmt = $pdo->prepare('SELECT 1 FROM users WHERE username = ?');
    $stmt->execute([$username]);
    if ($stmt->fetchColumn() !== false) {
        fwrite(STDERR, "create-user: username $username already exists\n");
        exit(1);
    }
    $stmt = $pdo->prepare('INSERT INTO users (username, password_hash, location_id, active, created_at) VALUES (?, ?, ?, 1, ?)');
    $stmt->execute([$username, password_hash($password, PASSWORD_BCRYPT), $locationId, app_now()]);
    fwrite(STDOUT, sprintf("create-user: created %s (id %d) at location %d %s (role %s)\n",
        $username, (int) $pdo->lastInsertId(), $locationId, $location['name'], $location['type']));
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'create-user: failed: ' . $e->getMessage() . "\n");
    exit(1);
}
