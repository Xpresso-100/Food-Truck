<?php
// ============================================================
// Food Truck - FinCon stock reader interface (shared, frozen after G1)
// ============================================================
// READ ONLY. Phase 1 never writes to FinCon (locked rule A2). This interface has
// exactly one method and it reads. Do not add a method that sets, updates, inserts,
// creates, posts, writes, deletes or saves anything: the acceptance tests check it.
//
// Adapters: MockFinconStockReader (tests, dev) and TunnelFinconStockReader (production,
// Cloudflare Tunnel). Pick one with fincon_stock_reader() in factory.php.
// ============================================================

declare(strict_types=1);

interface FinconStockReader
{
    public const OK             = 'OK';
    public const UNREACHABLE    = 'FINCON_UNREACHABLE';    // network or tunnel down, or a non-2xx reply
    public const AUTH_FAILED    = 'FINCON_AUTH_FAILED';    // Cloudflare Access 403 or FinCon Basic auth 401
    public const MAINTENANCE    = 'FINCON_MAINTENANCE';    // daily 15:25-15:30 SAST window
    public const ERROR          = 'FINCON_ERROR';          // unparseable 2xx, FinCon ErrorInfo, client fault
    public const NOT_CONFIGURED = 'FINCON_NOT_CONFIGURED'; // adapter settings missing or invalid

    /**
     * Read on-hand quantities for the given FinCon ItemNos.
     *
     * Never throws. Every failure comes back as a value so the caller can fail open.
     *
     * @param list<string> $itemNos FinCon ItemNos to read (products.fincon_item_no of active products only)
     * @return array{status: string, items: array<string, float>, error: ?string}
     *   status 'OK': items maps each ItemNo FinCon returned to the InStock of its first StockLoc.
     *                ItemNos FinCon did not return are absent. ItemNos that were not requested are
     *                never present.
     *   any other status: items is [] and error is a short message with no credentials and no
     *                FinCon response body.
     */
    public function readStockQuantities(array $itemNos): array;
}
