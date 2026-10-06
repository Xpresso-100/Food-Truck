<?php
// ============================================================
// M1-ordering - shared order -> JSON serializer (SPEC 4.2)
// ============================================================
// Owned by M1. M2 (src/OrdersRead.php) calls it read-only.
// Builds the SPEC 4.2 `order` object from orders + order_lines rows: money through
// Http::money(), timestamps through app_iso(). Never sent to franchise users.
// G1 placeholder: M1 defines the functions.
// ============================================================

declare(strict_types=1);
