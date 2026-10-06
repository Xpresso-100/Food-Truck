<?php
// ============================================================
// Food Truck - HTTP helpers (shared, frozen after G1)
// ============================================================
// JSON responses, the error envelope, JSON body parsing and the 415 check.
//
// Handler contract (see public/api.php):
//   function some_handler(array $ctx): array
//     returns [int $status, ?array $payload]     e.g. [200, ['items' => $items]]
//     throws  HttpError for any error response   e.g. throw HttpError::validation(['lines' => 'required'])
// ============================================================

declare(strict_types=1);

/** An error response: {"error":{"code":..,"message":..[,"fields":{..}]}} with an HTTP status. */
final class HttpError extends RuntimeException
{
    /**
     * @param array<string,string> $fields  field path => reason (422 only)
     * @param array<string,string> $headers extra response headers, e.g. Allow on a 405
     */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $fields = [],
        public readonly array $headers = []
    ) {
        parent::__construct($message);
    }

    public static function unauthenticated(): self
    {
        return new self(401, 'unauthenticated', 'Please sign in.');
    }

    public static function invalidCredentials(): self
    {
        return new self(401, 'invalid_credentials', 'Username or password is incorrect.');
    }

    public static function forbidden(): self
    {
        return new self(403, 'forbidden', 'You do not have access to this.');
    }

    public static function notFound(): self
    {
        return new self(404, 'not_found', 'Not found.');
    }

    /** @param list<string> $allowed */
    public static function methodNotAllowed(array $allowed = []): self
    {
        $headers = $allowed === [] ? [] : ['Allow' => implode(', ', $allowed)];
        return new self(405, 'method_not_allowed', 'Method not allowed.', [], $headers);
    }

    public static function invalidTransition(string $message = 'That status change is not allowed.'): self
    {
        return new self(409, 'invalid_transition', $message);
    }

    public static function unsupportedMediaType(): self
    {
        return new self(415, 'unsupported_media_type', 'Content-Type must be application/json.');
    }

    /** @param array<string,string> $fields */
    public static function validation(array $fields = [], string $message = 'Validation failed.'): self
    {
        return new self(422, 'validation_failed', $message, $fields);
    }

    public static function notImplemented(): self
    {
        return new self(501, 'not_implemented', 'Not implemented yet.');
    }
}

final class Http
{
    /**
     * Send a JSON response. Every response carries Content-Type application/json and
     * Cache-Control no-store; a 204 has an empty body.
     */
    public static function send(int $status, ?array $payload): void
    {
        http_response_code($status);
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        if ($status === 204) {
            ini_set('default_mimetype', '');
            header_remove('Content-Type');
            return;
        }
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($payload ?? new stdClass(),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
    }

    /** Send the error envelope for an HttpError. */
    public static function sendError(HttpError $e): void
    {
        $error = ['code' => $e->errorCode, 'message' => $e->getMessage()];
        if ($e->fields !== []) {
            $error['fields'] = $e->fields;
        }
        foreach ($e->headers as $name => $value) {
            header($name . ': ' . $value);
        }
        self::send($e->status, ['error' => $error]);
    }

    /** 415 unless the request Content-Type is application/json (parameters such as charset allowed). */
    public static function requireJsonContentType(): void
    {
        $type = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
        $mime = strtolower(trim(explode(';', (string) $type, 2)[0]));
        if ($mime !== 'application/json') {
            throw HttpError::unsupportedMediaType();
        }
    }

    /**
     * Parse the request body as a JSON object. 415 for a wrong Content-Type, 422 for
     * malformed JSON or a body that is not an object. Nested objects arrive as PHP
     * associative arrays; JSON numbers keep their type (2 is int, 2.0 and 2.5 are float).
     *
     * @return array<string,mixed>
     */
    public static function jsonBody(): array
    {
        self::requireJsonContentType();
        $raw = (string) file_get_contents('php://input');
        try {
            $decoded = json_decode($raw, false, 64, JSON_BIGINT_AS_STRING | JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw HttpError::validation([], 'Request body is not valid JSON.');
        }
        if (!$decoded instanceof stdClass) {
            throw HttpError::validation([], 'Request body must be a JSON object.');
        }
        return json_decode($raw, true, 64, JSON_BIGINT_AS_STRING | JSON_THROW_ON_ERROR);
    }

    /** Integer cents to a JSON money number with at most 2 decimals: 21050 -> 210.5, 42100 -> 421, 0 -> 0. */
    public static function money(int $cents): int|float
    {
        if ($cents % 100 === 0) {
            return intdiv($cents, 100);
        }
        return round($cents / 100, 2);
    }

    /** A path id that is a positive integer ("12"), or null for anything else ("0", "-1", "abc", "1.5"). */
    public static function positiveId(mixed $raw): ?int
    {
        if (!is_string($raw) || preg_match('/^[1-9][0-9]{0,17}$/', $raw) !== 1) {
            return null;
        }
        return (int) $raw;
    }
}
