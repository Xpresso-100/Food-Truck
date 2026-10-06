<?php
// Prints a bcrypt hash for a password, for the users INSERT in deploy/sql/02-first-data.sql.
// Usage: php deploy/tools/make-hash.php   (password is read from STDIN, first line)
// Run by the person preparing the bundle, never on the server.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$line = fgets(STDIN);
$pw = $line === false ? '' : rtrim($line, "\r\n");
if (strlen($pw) < 10) { fwrite(STDERR, "password must be at least 10 characters\n"); exit(2); }
echo password_hash($pw, PASSWORD_BCRYPT), "\n";
