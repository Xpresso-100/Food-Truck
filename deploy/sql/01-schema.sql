-- Food Truck schema - MySQL (production). SPEC section 2.
-- Own database (suggested name xpresso_truck). Never run against xpresso_clients.
-- One statement per block: phpMyAdmin on xneelo runs them one at a time.
-- Applied by: php bin/migrate.php  (idempotent; every statement is IF NOT EXISTS)
-- Money is integer cents. Truck order lines are R0 with the cost value stored.

CREATE TABLE IF NOT EXISTS locations (
  id      INT NOT NULL AUTO_INCREMENT,
  name    VARCHAR(120) NOT NULL,
  type    VARCHAR(16)  NOT NULL,
  active  TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  CONSTRAINT chk_locations_type CHECK (type IN ('hq','truck','franchise'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id             INT NOT NULL AUTO_INCREMENT,
  username       VARCHAR(60)  NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  location_id    INT NOT NULL,
  active         TINYINT NOT NULL DEFAULT 1,
  created_at     DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  CONSTRAINT fk_users_location FOREIGN KEY (location_id) REFERENCES locations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  sku                    VARCHAR(20)  NOT NULL,
  name                   VARCHAR(150) NOT NULL,
  category               VARCHAR(60)  NOT NULL,
  unit                   VARCHAR(20)  NOT NULL,
  moq                    INT NOT NULL DEFAULT 1,
  franchise_price_cents  INT NOT NULL,
  cost_price_cents       INT NOT NULL,
  fincon_item_no         VARCHAR(25) NULL,
  active                 TINYINT NOT NULL DEFAULT 1,
  updated_at             DATETIME NOT NULL,
  PRIMARY KEY (sku),
  CONSTRAINT chk_products_franchise_price CHECK (franchise_price_cents >= 0),
  CONSTRAINT chk_products_cost_price CHECK (cost_price_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id                  INT NOT NULL AUTO_INCREMENT,
  location_id         INT NOT NULL,
  created_by_user_id  INT NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  note                VARCHAR(500) NULL,
  subtotal_cents      INT NOT NULL DEFAULT 0,
  vat_cents           INT NOT NULL DEFAULT 0,
  total_cents         INT NOT NULL DEFAULT 0,
  cost_total_cents    INT NOT NULL,
  created_at          DATETIME NOT NULL,
  status_updated_at   DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_orders_location_created (location_id, created_at),
  CONSTRAINT fk_orders_location FOREIGN KEY (location_id) REFERENCES locations (id),
  CONSTRAINT fk_orders_user FOREIGN KEY (created_by_user_id) REFERENCES users (id),
  CONSTRAINT chk_orders_status CHECK (status IN ('pending','in_process','out_for_delivery','delivered')),
  CONSTRAINT chk_orders_subtotal CHECK (subtotal_cents = 0),
  CONSTRAINT chk_orders_vat CHECK (vat_cents = 0),
  CONSTRAINT chk_orders_total CHECK (total_cents = 0),
  CONSTRAINT chk_orders_cost_total CHECK (cost_total_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_lines (
  id                INT NOT NULL AUTO_INCREMENT,
  order_id          INT NOT NULL,
  sku               VARCHAR(20)  NOT NULL,
  product_name      VARCHAR(150) NOT NULL,
  unit              VARCHAR(20)  NOT NULL,
  qty               INT NOT NULL,
  unit_price_cents  INT NOT NULL DEFAULT 0,
  line_total_cents  INT NOT NULL DEFAULT 0,
  unit_cost_cents   INT NOT NULL,
  line_cost_cents   INT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_order_lines_order (order_id),
  CONSTRAINT fk_order_lines_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT chk_order_lines_qty CHECK (qty BETWEEN 1 AND 999),
  CONSTRAINT chk_order_lines_unit_price CHECK (unit_price_cents = 0),
  CONSTRAINT chk_order_lines_line_total CHECK (line_total_cents = 0),
  CONSTRAINT chk_order_lines_unit_cost CHECK (unit_cost_cents >= 0),
  CONSTRAINT chk_order_lines_line_cost CHECK (line_cost_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_cache (
  item_no    VARCHAR(25) NOT NULL,
  in_stock   DECIMAL(12,3) NOT NULL,
  synced_at  DATETIME NOT NULL,
  PRIMARY KEY (item_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
