<?php
// ============================================================
// Food Truck - FinCon adapter factory (shared, frozen after G1)
// ============================================================
// FINCON_ADAPTER=mock   -> MockFinconStockReader (tests, dev). Refused in production.
// FINCON_ADAPTER=tunnel -> TunnelFinconStockReader (production, settings from env)
// Unset: tunnel when APP_ENV=production, otherwise mock.
// Anything else returns a reader that always fails, so stock fails open to in_stock.
// ============================================================

declare(strict_types=1);

require_once __DIR__ . '/FinconStockReader.php';
require_once __DIR__ . '/MockFinconStockReader.php';
require_once __DIR__ . '/TunnelFinconStockReader.php';

/** Always fails with FINCON_NOT_CONFIGURED. Used for a missing or invalid FINCON_ADAPTER. */
final class UnconfiguredFinconStockReader implements FinconStockReader
{
    public function readStockQuantities(array $itemNos): array
    {
        return ['status' => self::NOT_CONFIGURED, 'items' => [], 'error' => 'FinCon adapter is not configured'];
    }
}

function fincon_stock_reader(): FinconStockReader
{
    $production = app_env() === 'production';
    $adapter = env('FINCON_ADAPTER', $production ? 'tunnel' : 'mock');

    if ($adapter === 'tunnel') {
        return TunnelFinconStockReader::fromEnv();
    }
    if ($adapter === 'mock' && !$production) {
        return new MockFinconStockReader(env('FINCON_MOCK_STOCK'), env('FINCON_MOCK_LOG'));
    }
    error_log('FINCON | FINCON_ADAPTER is invalid for this environment; stock will fail open');
    return new UnconfiguredFinconStockReader();
}
