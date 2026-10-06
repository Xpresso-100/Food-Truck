<?php
// ============================================================
// Food Truck - authentication and roles (shared, frozen after G1)
// ============================================================
// Identity comes from the server session only, never from a request body.
// Role = the type of the user's location: 'hq' | 'truck' | 'franchise' (SPEC section 3).
// The session holds only the user id and login time; the user and location are
// re-read on every request, so deactivating either takes effect immediately.
//
// The current-user array handed to handlers as $ctx['user']:
//   ['id' => int, 'username' => string, 'role' => 'hq'|'truck'|'franchise',
//    'location' => ['id' => int, 'name' => string, 'type' => string]]
// ============================================================

declare(strict_types=1);

const ROLES_ALL = ['truck', 'franchise', 'hq'];

final class Auth
{
    // bcrypt hash of a random throwaway string. Verified against when the username is
    // unknown so a wrong username and a wrong password take the same time.
    private const DUMMY_HASH = '$2y$10$H93cGFyE8WPyItxTgGO4CeDDKIsd6eaOM9jdU.EsbYnzd6lHngfsa';

    private static bool $resolved = false;
    private static ?array $user = null;

    /** The logged-in user, or null. Starts the session only when a session cookie was sent. */
    public static function currentUser(): ?array
    {
        if (self::$resolved) {
            return self::$user;
        }
        self::$resolved = true;

        $cookie = $_COOKIE[SESSION_NAME] ?? null;
        if (!is_string($cookie) || $cookie === '') {
            return null;
        }
        app_session_start();
        $uid = $_SESSION['uid'] ?? null;
        $loginAt = $_SESSION['login_at'] ?? null;
        if (!is_int($uid) || !is_int($loginAt) || (time() - $loginAt) > SESSION_LIFETIME) {
            $_SESSION = [];
            session_destroy();
            return null;
        }
        session_write_close();

        $stmt = Db::pdo()->prepare(
            'SELECT u.id, u.username, l.id AS location_id, l.name AS location_name, l.type AS location_type
               FROM users u
               JOIN locations l ON l.id = u.location_id
              WHERE u.id = ? AND u.active = 1 AND l.active = 1'
        );
        $stmt->execute([$uid]);
        $row = $stmt->fetch();
        self::$user = $row === false ? null : self::userFromRow($row);
        return self::$user;
    }

    /** The logged-in user, or 401 unauthenticated. */
    public static function requireUser(): array
    {
        $user = self::currentUser();
        if ($user === null) {
            throw HttpError::unauthenticated();
        }
        return $user;
    }

    /**
     * The logged-in user if their role is in $roles; 401 when not logged in, 403 otherwise.
     *
     * @param list<string> $roles
     */
    public static function requireRole(array $roles): array
    {
        $user = self::requireUser();
        if (!in_array($user['role'], $roles, true)) {
            throw HttpError::forbidden();
        }
        return $user;
    }

    /** The public `user` object (SPEC 4.1). Never contains the password hash. */
    public static function publicUser(array $user): array
    {
        return [
            'id'       => $user['id'],
            'username' => $user['username'],
            'role'     => $user['role'],
            'location' => $user['location'],
        ];
    }

    // ---------------------------------------------------------------- handlers

    /** R2 POST /api/login */
    public static function handleLogin(array $ctx): array
    {
        $body = $ctx['body'];
        $fields = [];
        foreach (['username', 'password'] as $key) {
            if (!isset($body[$key]) || !is_string($body[$key]) || trim($body[$key]) === '') {
                $fields[$key] = 'required';
            }
        }
        if ($fields !== []) {
            throw HttpError::validation($fields);
        }
        $username = self::normaliseUsername($body['username']);
        $password = $body['password'];

        $stmt = Db::pdo()->prepare(
            'SELECT u.id, u.username, u.password_hash, u.active AS user_active,
                    l.id AS location_id, l.name AS location_name, l.type AS location_type, l.active AS location_active
               FROM users u
               JOIN locations l ON l.id = u.location_id
              WHERE u.username = ?'
        );
        $stmt->execute([$username]);
        $row = $stmt->fetch();

        $passwordOk = password_verify($password, $row === false ? self::DUMMY_HASH : (string) $row['password_hash']);
        if ($row === false || !$passwordOk || (int) $row['user_active'] !== 1 || (int) $row['location_active'] !== 1) {
            throw HttpError::invalidCredentials();
        }

        app_session_start();
        session_regenerate_id(true);
        $_SESSION = ['uid' => (int) $row['id'], 'login_at' => time()];
        session_write_close();

        $user = self::userFromRow($row);
        self::$resolved = true;
        self::$user = $user;
        return [200, ['user' => self::publicUser($user)]];
    }

    /** R3 POST /api/logout - always 204. */
    public static function handleLogout(array $ctx): array
    {
        $cookie = $_COOKIE[SESSION_NAME] ?? null;
        if (is_string($cookie) && $cookie !== '') {
            app_session_start();
            $_SESSION = [];
            session_destroy();
        }
        setcookie(SESSION_NAME, '', [
            'expires'  => 1,
            'path'     => '/',
            'secure'   => env('SESSION_COOKIE_SECURE', '1') !== '0',
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        self::$resolved = true;
        self::$user = null;
        return [204, null];
    }

    /** R4 GET /api/me */
    public static function handleMe(array $ctx): array
    {
        return [200, ['user' => self::publicUser($ctx['user'])]];
    }

    // ---------------------------------------------------------------- helpers

    /** Usernames are stored and matched trimmed and lower-case (phone keyboards capitalise). */
    public static function normaliseUsername(string $username): string
    {
        return strtolower(trim($username));
    }

    private static function userFromRow(array $row): array
    {
        return [
            'id'       => (int) $row['id'],
            'username' => (string) $row['username'],
            'role'     => (string) $row['location_type'],
            'location' => [
                'id'   => (int) $row['location_id'],
                'name' => (string) $row['location_name'],
                'type' => (string) $row['location_type'],
            ],
        ];
    }
}

/**
 * SPEC name for the role guard: the logged-in user if their role is one of $roles.
 * 401 unauthenticated when not logged in, 403 forbidden for any other role.
 */
function require_role(string ...$roles): array
{
    return Auth::requireRole($roles);
}
