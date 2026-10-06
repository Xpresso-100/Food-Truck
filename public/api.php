<?php
// ============================================================
// Food Truck - API front controller (shared, frozen after G1)
// ============================================================
// Every /api/* request lands here: Apache via .htaccess (api.php?route=/x), php -S via
// router.php, or directly as /api.php?route=/x when mod_rewrite is off (SPEC 4.1, D15).
//
// Order of checks on every request (SPEC 4.1):
//   unknown path 404 -> wrong method 405 -> authentication 401 -> role 403
//   -> Content-Type 415 and JSON-object body 422 (body routes) -> the handler
// The handler does field validation (422) and existence (404 / 409).
//
// Handler contract: function name(array $ctx): array
//   $ctx = ['user'   => ?array  (Auth current-user array; null on public routes),
//           'params' => array   (path params as raw strings, e.g. ['id' => '12']),
//           'query'  => array   (query string, without 'route'),
//           'body'   => ?array  (decoded JSON object on body routes, else null)]
//   returns [int $status, ?array $payload]; throws HttpError for error responses.
// Module files are loaded only for the route that needs them.
// ============================================================

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';
require_once APP_SRC . '/Http.php';
require_once APP_SRC . '/Db.php';
require_once APP_SRC . '/Auth.php';

// roles: null = public; otherwise the roles allowed (401 when logged out, 403 for other roles).
const API_ROUTES = [
    // R1-R4 shared
    ['method' => 'GET',  'path' => '/health',                 'roles' => null,                          'file' => null,             'handler' => 'api_health',              'body' => false],
    ['method' => 'POST', 'path' => '/login',                  'roles' => null,                          'file' => null,             'handler' => 'Auth::handleLogin',       'body' => true],
    ['method' => 'POST', 'path' => '/logout',                 'roles' => null,                          'file' => null,             'handler' => 'Auth::handleLogout',      'body' => false],
    ['method' => 'GET',  'path' => '/me',                     'roles' => ROLES_ALL,                     'file' => null,             'handler' => 'Auth::handleMe',          'body' => false],
    // R5-R9 M1-ordering
    ['method' => 'GET',  'path' => '/stock',                  'roles' => ['truck', 'franchise', 'hq'],  'file' => 'Stock.php',      'handler' => 'stock_handle_get',        'body' => false],
    ['method' => 'GET',  'path' => '/products',               'roles' => ['truck', 'franchise', 'hq'],  'file' => 'Products.php',   'handler' => 'products_handle_list',    'body' => false],
    ['method' => 'POST', 'path' => '/orders',                 'roles' => ['truck'],                     'file' => 'OrdersCreate.php', 'handler' => 'orders_handle_create',  'body' => true],
    ['method' => 'GET',  'path' => '/hq/orders',              'roles' => ['hq'],                        'file' => 'Hq.php',         'handler' => 'hq_handle_list_orders',   'body' => false],
    ['method' => 'POST', 'path' => '/hq/orders/{id}/status',  'roles' => ['hq'],                        'file' => 'Hq.php',         'handler' => 'hq_handle_update_status', 'body' => true],
    // R10-R11 M2-history
    ['method' => 'GET',  'path' => '/orders',                 'roles' => ['truck'],                     'file' => 'OrdersRead.php', 'handler' => 'orders_handle_list',      'body' => false],
    ['method' => 'GET',  'path' => '/orders/{id}',            'roles' => ['truck'],                     'file' => 'OrdersRead.php', 'handler' => 'orders_handle_get',       'body' => false],
];

/** R1 GET /api/health - no auth, no DB, no FinCon. */
function api_health(array $ctx): array
{
    return [200, ['ok' => true]];
}

/** The route path, e.g. '/orders/12', from /api/<path> or /api.php?route=/<path>. */
function api_route_path(): string
{
    $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $path = rawurldecode($path);
    if (preg_match('#/api\.php$#', $path) === 1) {
        $route = $_GET['route'] ?? '';
        $route = is_string($route) ? $route : '';
    } elseif (($pos = strpos($path, '/api/')) !== false) {
        $route = substr($path, $pos + 4);
    } else {
        $route = '';
    }
    if (strlen($route) > 1) {
        $route = rtrim($route, '/');
    }
    return $route;
}

/** @return array{0: array, 1: array<string,string>} the matched route and its path params */
function api_match(string $method, string $path): array
{
    $allowed = [];
    foreach (API_ROUTES as $route) {
        $regex = '#^' . preg_replace('#\\\\\{([a-z_]+)\\\\\}#', '(?P<$1>[^/]+)', preg_quote($route['path'], '#')) . '$#';
        if (preg_match($regex, $path, $m) !== 1) {
            continue;
        }
        if ($route['method'] !== $method) {
            $allowed[] = $route['method'];
            continue;
        }
        $params = [];
        foreach ($m as $key => $value) {
            if (is_string($key)) {
                $params[$key] = $value;
            }
        }
        return [$route, $params];
    }
    if ($allowed !== []) {
        throw HttpError::methodNotAllowed(array_values(array_unique($allowed)));
    }
    throw HttpError::notFound();
}

function api_dispatch(): void
{
    try {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        [$route, $params] = api_match($method, api_route_path());

        $user = $route['roles'] === null ? null : Auth::requireRole($route['roles']);
        $body = $route['body'] ? Http::jsonBody() : null;
        $query = $_GET;
        unset($query['route']);

        if ($route['file'] !== null) {
            require_once APP_SRC . '/' . $route['file'];
        }
        $result = call_user_func($route['handler'], [
            'user'   => $user,
            'params' => $params,
            'query'  => $query,
            'body'   => $body,
        ]);
        if (!is_array($result) || !is_int($result[0] ?? null) || !(is_array($result[1] ?? null) || ($result[1] ?? null) === null)) {
            throw new UnexpectedValueException('Handler ' . $route['handler'] . ' must return [int $status, ?array $payload]');
        }
        Http::send($result[0], $result[1]);
    } catch (HttpError $e) {
        Http::sendError($e);
    } catch (Throwable $e) {
        error_log('API | ' . get_class($e) . ': ' . $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine());
        Http::send(500, ['error' => ['code' => 'internal_error', 'message' => 'Something went wrong. Please try again.']]);
    }
}

api_dispatch();
