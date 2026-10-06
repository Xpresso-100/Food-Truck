<?php
// ============================================================
// Food Truck - FinCon stock reader over the Cloudflare Tunnel (shared, frozen after G1)
// ============================================================
// Production adapter (FINCON_ADAPTER=tunnel). Mirrors the reference fincon_client.php:
//   xneelo PHP -> HTTPS + CF-Access headers -> Cloudflare edge -> cloudflared -> FinCon DataSnap REST
//
// READ ONLY. It calls exactly three DataSnap methods and nothing else:
//   Login                      POST .../FinconAPI/"Login"/                       {"_parameters":[DATA_ID,USER,PASS,false]}
//   GetStockQuantitiesForOpt2  POST .../FinconAPI/"GetStockQuantitiesForOpt2"/<ConnectID>/0/  {"ItemList":[{"ItemNo":..}]}
//   Logout                     GET  .../FinconAPI/"Logout"/<ConnectID>/
// The quotes wrap the method name only and are sent literally (proven live in the reference).
//
// Every setting comes from environment variables (SPEC section 7). Two auth layers on
// every call: the Cloudflare Access service-token headers and FinCon's HTTP Basic auth.
// Connect timeout 5s, request timeout 15s, 30s per stock batch of <= 100 ItemNos.
// Logout is always called once Login succeeded, even after a failure.
// 401/403 -> FINCON_AUTH_FAILED, other non-2xx -> FINCON_UNREACHABLE, unparseable 2xx ->
// FINCON_ERROR, 15:25-15:30 SAST -> FINCON_MAINTENANCE. Never logs credentials, the
// ConnectID or response bodies. Never throws.
// ============================================================

declare(strict_types=1);

require_once __DIR__ . '/FinconStockReader.php';

final class TunnelFinconStockReader implements FinconStockReader
{
    private const METHOD_LOGIN  = 'Login';
    private const METHOD_STOCK  = 'GetStockQuantitiesForOpt2';
    private const METHOD_LOGOUT = 'Logout';
    private const ALLOWED_METHODS = [self::METHOD_LOGIN, self::METHOD_STOCK, self::METHOD_LOGOUT];

    private const BATCH_SIZE      = 100;
    private const LOC_NO          = '0';   // FinCon returns "00"; one location exists
    private const CONNECT_TIMEOUT = 5;
    private const REQUEST_TIMEOUT = 15;
    private const BATCH_TIMEOUT   = 30;

    /** @param array<string,string> $config keys: base_url, cf_client_id, cf_client_secret, srv_user, srv_pass, data_id, user, pass */
    public function __construct(private readonly array $config)
    {
    }

    /** Build from FINCON_* environment variables. */
    public static function fromEnv(): self
    {
        return new self([
            'base_url'         => (string) env('FINCON_BASE_URL', ''),
            'cf_client_id'     => (string) env('FINCON_CF_CLIENT_ID', ''),
            'cf_client_secret' => (string) env('FINCON_CF_CLIENT_SECRET', ''),
            'srv_user'         => (string) env('FINCON_SRV_USER', ''),
            'srv_pass'         => (string) env('FINCON_SRV_PASS', ''),
            'data_id'          => (string) env('FINCON_DATA_ID', ''),
            'user'             => (string) env('FINCON_USER', ''),
            'pass'             => (string) env('FINCON_PASS', ''),
        ]);
    }

    public function readStockQuantities(array $itemNos): array
    {
        try {
            $wanted = [];
            foreach ($itemNos as $itemNo) {
                if (is_string($itemNo) && $itemNo !== '') {
                    $wanted[$itemNo] = true;
                }
            }
            if ($wanted === []) {
                return self::result(self::OK);
            }
            if (!$this->isConfigured()) {
                return self::result(self::NOT_CONFIGURED, 'FinCon tunnel settings are missing or invalid');
            }
            if (self::inMaintenanceWindow()) {
                return self::result(self::MAINTENANCE, 'FinCon daily maintenance window');
            }

            $login = $this->login();
            if ($login['status'] !== self::OK) {
                return self::result($login['status'], $login['error']);
            }
            $connectId = (string) $login['connect_id'];

            try {
                $items = [];
                foreach (array_chunk(array_keys($wanted), self::BATCH_SIZE) as $chunk) {
                    $itemList = [];
                    foreach ($chunk as $itemNo) {
                        $itemList[] = ['ItemNo' => (string) $itemNo];
                    }
                    $call = $this->callJson(self::METHOD_STOCK, [$connectId, self::LOC_NO], ['ItemList' => $itemList], self::BATCH_TIMEOUT);
                    if ($call['status'] !== self::OK) {
                        return self::result($call['status'], $call['error']);
                    }
                    $stock = (isset($call['data']['Stock']) && is_array($call['data']['Stock'])) ? $call['data']['Stock'] : [];
                    foreach ($stock as $row) {
                        if (!is_array($row) || !isset($row['ItemNo'])) {
                            continue;
                        }
                        $itemNo = (string) $row['ItemNo'];
                        // Tenant boundary: the FinCon item master is shared with another company.
                        // Anything that was not requested is dropped here, unnamed and unlogged.
                        if (!isset($wanted[$itemNo])) {
                            continue;
                        }
                        $items[$itemNo] = self::firstInStock($row);
                    }
                }
                return ['status' => self::OK, 'items' => $items, 'error' => null];
            } finally {
                $this->logout($connectId);
            }
        } catch (Throwable $e) {
            error_log('FINCON | client fault: ' . get_class($e));
            return self::result(self::ERROR, 'FinCon client error');
        }
    }

    /** FinCon's daily maintenance window, 15:25-15:30 Africa/Johannesburg inclusive. */
    public static function inMaintenanceWindow(?DateTimeInterface $at = null): bool
    {
        $tz = new DateTimeZone('Africa/Johannesburg');
        $now = $at === null
            ? new DateTimeImmutable('now', $tz)
            : (new DateTimeImmutable('@' . $at->getTimestamp()))->setTimezone($tz);
        $mins = ((int) $now->format('H')) * 60 + (int) $now->format('i');
        return $mins >= (15 * 60 + 25) && $mins <= (15 * 60 + 30);
    }

    // ---------------------------------------------------------------- DataSnap calls

    /** @return array{status: string, connect_id: ?string, error: ?string} */
    private function login(): array
    {
        $call = $this->callJson(self::METHOD_LOGIN, [], [
            '_parameters' => [$this->config['data_id'], $this->config['user'], $this->config['pass'], false],
        ], self::REQUEST_TIMEOUT);
        if ($call['status'] !== self::OK) {
            return ['status' => $call['status'], 'connect_id' => null, 'error' => $call['error']];
        }
        $payload = $call['data'];
        $connectId = isset($payload['ConnectID']) && $payload['ConnectID'] !== '' ? (string) $payload['ConnectID'] : null;
        if (!empty($payload['Connected']) && $connectId !== null) {
            return ['status' => self::OK, 'connect_id' => $connectId, 'error' => null];
        }
        $status = self::inMaintenanceWindow() ? self::MAINTENANCE : self::ERROR;
        return ['status' => $status, 'connect_id' => null, 'error' => 'FinCon did not return a connected session'];
    }

    /** Best effort; never throws. */
    private function logout(string $connectId): void
    {
        if ($connectId === '') {
            return;
        }
        try {
            $this->httpGet($this->buildUrl(self::METHOD_LOGOUT, [$connectId]), self::REQUEST_TIMEOUT);
        } catch (Throwable $e) {
            error_log('FINCON | logout fault: ' . get_class($e));
        }
    }

    /** POST a JSON body to a DataSnap method. @return array{status: string, data: ?array, error: ?string} */
    private function callJson(string $method, array $params, array $body, int $timeout): array
    {
        $resp = $this->httpPost($this->buildUrl($method, $params), $body, $timeout);
        $transport = self::mapTransport($resp);
        if ($transport !== null) {
            return ['status' => $transport['status'], 'data' => null, 'error' => $transport['error']];
        }
        $decoded = json_decode($resp['body'], true);
        $payload = null;
        if (is_array($decoded)) {
            $payload = (isset($decoded['result']) && is_array($decoded['result']) && array_key_exists(0, $decoded['result']))
                ? $decoded['result'][0]
                : $decoded;
        }
        if (!is_array($payload)) {
            return ['status' => self::ERROR, 'data' => null,
                    'error' => 'FinCon returned HTTP ' . $resp['http'] . ' with an unparseable body (' . strlen($resp['body']) . ' bytes)'];
        }
        if (!empty($payload['ErrorInfo'])) {
            return ['status' => self::ERROR, 'data' => null, 'error' => 'FinCon reported an error'];
        }
        return ['status' => self::OK, 'data' => $payload, 'error' => null];
    }

    // ---------------------------------------------------------------- transport

    private function buildUrl(string $method, array $params): string
    {
        if (!in_array($method, self::ALLOWED_METHODS, true)) {
            throw new LogicException('FinCon method is not on the read-only allowlist');
        }
        $url = rtrim($this->config['base_url'], '/') . '/datasnap/rest/FinconAPI/"' . $method . '"';
        foreach ($params as $param) {
            $url .= '/' . rawurlencode((string) $param);
        }
        return $url . '/';
    }

    /** @return array{errno: int, http: int, body: string} */
    private function httpGet(string $url, int $timeout): array
    {
        $ch = curl_init($url);
        $this->curlCommon($ch, $timeout, ['Accept: application/json']);
        return self::curlFinish($ch);
    }

    /** @return array{errno: int, http: int, body: string} */
    private function httpPost(string $url, array $body, int $timeout): array
    {
        $json = json_encode($body, JSON_THROW_ON_ERROR);
        $ch = curl_init($url);
        $this->curlCommon($ch, $timeout, [
            'Accept: application/json',
            'Content-Type: application/json',
            'Content-Length: ' . strlen($json),
        ]);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
        return self::curlFinish($ch);
    }

    /** Both auth layers on every call: Cloudflare Access headers and FinCon HTTP Basic. */
    private function curlCommon(CurlHandle $ch, int $timeout, array $headers): void
    {
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
        curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, self::CONNECT_TIMEOUT);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
        curl_setopt($ch, CURLOPT_HTTPAUTH, CURLAUTH_BASIC);
        curl_setopt($ch, CURLOPT_USERPWD, $this->config['srv_user'] . ':' . $this->config['srv_pass']);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array_merge([
            'CF-Access-Client-Id: ' . $this->config['cf_client_id'],
            'CF-Access-Client-Secret: ' . $this->config['cf_client_secret'],
        ], $headers));
    }

    /** @return array{errno: int, http: int, body: string} */
    private static function curlFinish(CurlHandle $ch): array
    {
        $body = curl_exec($ch);
        $errno = curl_errno($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ['errno' => $errno, 'http' => $http, 'body' => is_string($body) ? $body : ''];
    }

    /** @return array{status: string, error: string}|null null when the transport is OK */
    private static function mapTransport(array $resp): ?array
    {
        if ($resp['http'] === 403) {
            return ['status' => self::AUTH_FAILED, 'error' => 'Cloudflare Access denied (HTTP 403)'];
        }
        if ($resp['http'] === 401) {
            return ['status' => self::AUTH_FAILED, 'error' => 'FinCon rejected the server credentials (HTTP 401)'];
        }
        if ($resp['errno'] !== 0 || $resp['body'] === '') {
            $status = self::inMaintenanceWindow() ? self::MAINTENANCE : self::UNREACHABLE;
            return ['status' => $status, 'error' => 'No response from the FinCon tunnel (cURL ' . $resp['errno'] . ')'];
        }
        if ($resp['http'] < 200 || $resp['http'] > 299) {
            return ['status' => self::UNREACHABLE, 'error' => 'FinCon returned HTTP ' . $resp['http']];
        }
        return null;
    }

    // ---------------------------------------------------------------- helpers

    private function isConfigured(): bool
    {
        if (!function_exists('curl_init')) {
            return false;
        }
        foreach ($this->config as $value) {
            if (!is_string($value) || $value === '') {
                return false;
            }
        }
        return str_starts_with(strtolower($this->config['base_url']), 'https://');
    }

    private static function firstInStock(array $row): float
    {
        if (isset($row['StockLoc']) && is_array($row['StockLoc'])) {
            foreach ($row['StockLoc'] as $loc) {
                if (is_array($loc)) {
                    return isset($loc['InStock']) && is_numeric($loc['InStock']) ? (float) $loc['InStock'] : 0.0;
                }
            }
        }
        return 0.0;
    }

    /** @return array{status: string, items: array<string, float>, error: ?string} */
    private static function result(string $status, ?string $error = null): array
    {
        return ['status' => $status, 'items' => [], 'error' => $status === self::OK ? null : $error];
    }
}
