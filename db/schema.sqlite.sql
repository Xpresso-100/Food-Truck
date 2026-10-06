-- Food Truck schema - SQLite (tests and dev). SPEC section 2.
-- Applied by: php bin/migrate.php  (idempotent; every statement is IF NOT EXISTS)
-- Money is integer cents. Truck order lines are R0 with the cost value stored.

CREATE TABLE IF NOT EXISTS locations (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    VARCHAR(120) NOT NULL,
  type    VARCHAR(16)  NOT NULL CHECK (type IN ('hq','truck','franchise')),
  active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       VARCHAR(60)  NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  location_id    INTEGER NOT NULL REFERENCES locations(id),
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  sku                    VARCHAR(20)  NOT NULL PRIMARY KEY,
  name                   VARCHAR(150) NOT NULL,
  category               VARCHAR(60)  NOT NULL,
  unit                   VARCHAR(20)  NOT NULL,
  moq                    INTEGER NOT NULL DEFAULT 1,
  franchise_price_cents  INTEGER NOT NULL CHECK (franchise_price_cents >= 0),
  cost_price_cents       INTEGER NOT NULL CHECK (cost_price_cents >= 0),
  fincon_item_no         VARCHAR(25) NULL,
  active                 INTEGER NOT NULL DEFAULT 1,
  updated_at             DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id         INTEGER NOT NULL REFERENCES locations(id),
  created_by_user_id  INTEGER NOT NULL REFERENCES users(id),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','in_process','out_for_delivery','delivered')),
  note                VARCHAR(500) NULL,
  subtotal_cents      INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents = 0),
  vat_cents           INTEGER NOT NULL DEFAULT 0 CHECK (vat_cents = 0),
  total_cents         INTEGER NOT NULL DEFAULT 0 CHECK (total_cents = 0),
  cost_total_cents    INTEGER NOT NULL CHECK (cost_total_cents >= 0),
  created_at          DATETIME NOT NULL,
  status_updated_at   DATETIME NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_location_created ON orders (location_id, created_at);

CREATE TABLE IF NOT EXISTS order_lines (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders(id),
  sku               VARCHAR(20)  NOT NULL,
  product_name      VARCHAR(150) NOT NULL,
  unit              VARCHAR(20)  NOT NULL,
  qty               INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 999),
  unit_price_cents  INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_cents = 0),
  line_total_cents  INTEGER NOT NULL DEFAULT 0 CHECK (line_total_cents = 0),
  unit_cost_cents   INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  line_cost_cents   INTEGER NOT NULL CHECK (line_cost_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines (order_id);

CREATE TABLE IF NOT EXISTS stock_cache (
  item_no    VARCHAR(25) NOT NULL PRIMARY KEY,
  in_stock   DECIMAL(12,3) NOT NULL,
  synced_at  DATETIME NOT NULL
);
