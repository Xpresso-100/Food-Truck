<?php
// Router for PHP's built-in server (tests and local dev only; production uses .htaccess):
//   php -S 127.0.0.1:8080 -t public public/router.php
// /api/* and /api.php go to the front controller. Dotfiles, other PHP files and the file
// types .htaccess denies get 404. Everything else is served as a static file.
declare(strict_types=1);

$path = rawurldecode((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH));

if ($path === '/api' || str_starts_with($path, '/api/') || $path === '/api.php') {
    require __DIR__ . '/api.php';
    return true;
}

if (preg_match('#(^|/)\.#', $path) === 1 || preg_match('/\.(php|sql|log|txt|sqlite|md)$/i', $path) === 1) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Not found';
    return true;
}

return false;
