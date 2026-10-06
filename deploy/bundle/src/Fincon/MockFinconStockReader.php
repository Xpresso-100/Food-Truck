<?php
// ============================================================
// Food Truck - mock FinCon stock reader (shared, frozen after G1)
// ============================================================
// Used by the tests and local dev (FINCON_ADAPTER=mock). SPEC section 6:
//   FINCON_MOCK_STOCK  optional JSON file, re-read on every call:
//                        {"items":{"<ItemNo>": <InStock>, ...}}  serves those quantities
//                        {"fail":true}                            the read fails as unreachable
//                      unset or missing file = DEFAULT_QUANTITIES
//   FINCON_MOCK_LOG    every call appends one JSON line:
//                        {"ts":..,"method":"Login"|"GetStockQuantitiesForOpt2"|"Logout","kind":"read"[,"items":[..]]}
// The mock has no method that writes, so kind is always "read".
// ============================================================

declare(strict_types=1);

require_once __DIR__ . '/FinconStockReader.php';

final class MockFinconStockReader implements FinconStockReader
{
    /** SPEC section 6 default quantities. CUP34 belongs to the inactive PKD034. */
    public const DEFAULT_QUANTITIES = [
        'BEANS'  => 40,
        'MILK2L' => 5,
        'CUP250' => 0,
        'CUPLID' => 6,
        'CUP34'  => 12,
    ];

    private const BATCH_SIZE = 100;

    public function __construct(
        private readonly ?string $stockFile = null,
        private readonly ?string $logFile = null
    ) {
    }

    public function readStockQuantities(array $itemNos): array
    {
        try {
            $wanted = self::normalise($itemNos);
            if ($wanted === []) {
                return ['status' => self::OK, 'items' => [], 'error' => null];
            }

            $source = $this->loadSource();
            $this->log('Login');
            if ($source === null) {
                return ['status' => self::ERROR, 'items' => [], 'error' => 'Mock FinCon stock file is not valid JSON'];
            }
            if (!empty($source['fail'])) {
                return ['status' => self::UNREACHABLE, 'items' => [], 'error' => 'Mock FinCon is unreachable'];
            }

            $quantities = $source['items'];
            $items = [];
            foreach (array_chunk($wanted, self::BATCH_SIZE) as $chunk) {
                $this->log('GetStockQuantitiesForOpt2', $chunk);
                foreach ($chunk as $itemNo) {
                    if (array_key_exists($itemNo, $quantities)) {
                        $items[$itemNo] = (float) $quantities[$itemNo];
                    }
                }
            }
            $this->log('Logout');
            return ['status' => self::OK, 'items' => $items, 'error' => null];
        } catch (Throwable $e) {
            return ['status' => self::ERROR, 'items' => [], 'error' => 'Mock FinCon client error'];
        }
    }

    /** @return array{fail: bool, items: array<string, int|float>}|null null when the file is not valid JSON */
    private function loadSource(): ?array
    {
        if ($this->stockFile === null || !is_file($this->stockFile)) {
            return ['fail' => false, 'items' => self::DEFAULT_QUANTITIES];
        }
        $decoded = json_decode((string) file_get_contents($this->stockFile), true);
        if (!is_array($decoded)) {
            return null;
        }
        if (!empty($decoded['fail'])) {
            return ['fail' => true, 'items' => []];
        }
        $items = [];
        foreach ((is_array($decoded['items'] ?? null) ? $decoded['items'] : []) as $itemNo => $qty) {
            if (is_int($qty) || is_float($qty)) {
                $items[(string) $itemNo] = $qty;
            }
        }
        return ['fail' => false, 'items' => $items];
    }

    /** @param list<string>|null $items */
    private function log(string $method, ?array $items = null): void
    {
        if ($this->logFile === null) {
            return;
        }
        $line = [
            'ts'     => (new DateTimeImmutable('now', new DateTimeZone('Africa/Johannesburg')))->format(DATE_ATOM),
            'method' => $method,
            'kind'   => 'read',
        ];
        if ($items !== null) {
            $line['items'] = array_values($items);
        }
        file_put_contents($this->logFile, json_encode($line, JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
    }

    /** @return list<string> unique, non-empty ItemNos in request order */
    private static function normalise(array $itemNos): array
    {
        $out = [];
        foreach ($itemNos as $itemNo) {
            if (is_string($itemNo) && $itemNo !== '' && !in_array($itemNo, $out, true)) {
                $out[] = $itemNo;
            }
        }
        return $out;
    }
}
