<?php
// ============================================================
// M1-ordering - R8 GET /api/hq/orders, R9 POST /api/hq/orders/{id}/status (SPEC 4.3)
// ============================================================
// HQ only (enforced by public/api.php). $ctx['params']['id'] is the raw path segment;
// Http::positiveId() turns it into an int or null (null = 404). No FinCon call.
// Status moves strictly forward: pending < in_process < out_for_delivery < delivered,
// forward skips allowed; anything else is 409 invalid_transition.
// ============================================================

declare(strict_types=1);

require_once APP_SRC . '/OrderView.php';

const HQ_ORDERS_LIMIT = 200;

/** R8 - every truck location's orders, newest first, at most 200. */
function hq_handle_list_orders(array $ctx): array
{
    $status = null;
    if (array_key_exists('status', $ctx['query'])) {
        $status = $ctx['query']['status'];
        if (!is_string($status) || !in_array($status, ORDER_STATUSES, true)) {
            throw HttpError::validation(['status' => 'must be one of ' . implode(', ', ORDER_STATUSES)]);
        }
    }
    return [200, ['orders' => order_view_list(null, $status, HQ_ORDERS_LIMIT)]];
}

/** R9 - move an order's status forward. */
function hq_handle_update_status(array $ctx): array
{
    $new = $ctx['body']['status'] ?? null;
    if (!is_string($new) || !in_array($new, ORDER_STATUSES, true)) {
        throw HttpError::validation(['status' => 'must be one of ' . implode(', ', ORDER_STATUSES)]);
    }
    $id = Http::positiveId($ctx['params']['id'] ?? null);
    if ($id === null) {
        throw HttpError::notFound();
    }

    Db::transaction(static function (PDO $pdo) use ($id, $new): void {
        $stmt = $pdo->prepare(
            "SELECT o.status FROM orders o JOIN locations l ON l.id = o.location_id
              WHERE o.id = ? AND l.type = 'truck'"
        );
        $stmt->execute([$id]);
        $current = $stmt->fetchColumn();
        if ($current === false) {
            throw HttpError::notFound();
        }
        $from = array_search((string) $current, ORDER_STATUSES, true);
        $to = array_search($new, ORDER_STATUSES, true);
        if ($from === false || $to <= $from) {
            throw HttpError::invalidTransition('An order can only move forward: ' . implode(' > ', ORDER_STATUSES) . '.');
        }
        // The status guard makes a concurrent change lose cleanly instead of moving backwards.
        $update = $pdo->prepare('UPDATE orders SET status = ?, status_updated_at = ? WHERE id = ? AND status = ?');
        $update->execute([$new, app_now(), $id, (string) $current]);
        if ($update->rowCount() !== 1) {
            throw HttpError::invalidTransition();
        }
    });

    $order = order_view_get($id, null);
    if ($order === null) {
        throw HttpError::notFound();
    }
    return [200, ['order' => $order]];
}
