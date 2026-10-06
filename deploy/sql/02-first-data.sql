-- Food Truck first data. Run in phpMyAdmin AFTER 01-schema.sql, ONE statement at a time.
-- Prefix each statement with:  USE <your truck database name>;
-- Whoever prepares the bundle replaces every REPLACE_ value first. No real values live in git.
-- Password hashes: run  php deploy/tools/make-hash.php  (password on STDIN) and paste the output.

-- Locations. Keep HQ = 1 and truck = 2.
INSERT INTO locations (id, name, type, active) VALUES (1, 'Xpresso HQ Warehouse', 'hq', 1);
INSERT INTO locations (id, name, type, active) VALUES (2, 'Xpresso Food Truck', 'truck', 1);

-- Users. The role is the type of the location.
INSERT INTO users (username, password_hash, location_id, active, created_at)
VALUES ('REPLACE_TRUCK_USERNAME', 'REPLACE_BCRYPT_HASH', 2, 1, NOW());
INSERT INTO users (username, password_hash, location_id, active, created_at)
VALUES ('REPLACE_HQ_USERNAME', 'REPLACE_BCRYPT_HASH', 1, 1, NOW());

-- Products (money is whole cents: R210.50 = 21050). One row per product.
-- fincon_item_no may be NULL (no stock status shown for that product).
INSERT INTO products (sku, name, category, unit, moq, franchise_price_cents, cost_price_cents, fincon_item_no, active, updated_at)
VALUES ('REPLACE_SKU', 'REPLACE_NAME', 'REPLACE_CATEGORY', 'each', 1, 0, 0, NULL, 1, NOW());
