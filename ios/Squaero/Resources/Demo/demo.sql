-- The demo database (issue #579, task 7.4): what App Review and a new user
-- open with no server, no account and no network. Stores, couriers, 1 284
-- orders and their deliveries, with foreign keys both ways, a view and NULLs,
-- so browsing, related data, editing, queries and export all have something
-- to show. Generated, not copied: the same rows on every phone.

PRAGMA foreign_keys = ON;

CREATE TABLE tiendas (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  ciudad TEXT NOT NULL
);

CREATE TABLE repartidores (
  id INTEGER PRIMARY KEY,
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
  nombre TEXT NOT NULL,
  capacidad INTEGER
);

CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
  categoria TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'en camino', 'entregado', 'cancelado')),
  total REAL,
  fecha DATE NOT NULL,
  nota TEXT
);

CREATE TABLE entregas (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  repartidor_id INTEGER NOT NULL REFERENCES repartidores(id),
  fecha DATETIME NOT NULL,
  tipo TEXT NOT NULL
);

INSERT INTO tiendas (id, nombre, ciudad) VALUES
  (1, 'Centro', 'Guadalajara'),
  (2, 'Norte', 'Guadalajara'),
  (3, 'Plaza Sur', 'Monterrey'),
  (4, 'Aeropuerto', 'Puebla'),
  (5, 'Puerto', 'Veracruz');

INSERT INTO repartidores (id, tienda_id, nombre, capacidad)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 12)
SELECT i, (i - 1) % 5 + 1, 'Repartidor ' || i, CASE WHEN i % 4 = 0 THEN NULL ELSE 20 + (i * 7) % 40 END FROM n;

INSERT INTO pedidos (id, numero, tienda_id, categoria, estado, total, fecha, nota)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1284)
SELECT
  i,
  printf('%04d/%d', i, 2022 + i % 4),
  (i * 7) % 5 + 1,
  CASE i % 4 WHEN 0 THEN 'hogar' WHEN 1 THEN 'ropa' WHEN 2 THEN 'electrónica' ELSE 'alimentos' END,
  CASE i % 7 WHEN 0 THEN 'cancelado' WHEN 1 THEN 'entregado' WHEN 2 THEN 'en camino' ELSE 'pendiente' END,
  CASE WHEN i % 5 = 0 THEN NULL ELSE round((i * 1373 % 90000) + 1500.5, 2) END,
  date('2022-01-03', '+' || (i * 3 % 1300) || ' days'),
  CASE WHEN i % 9 = 0 THEN 'Revisar dirección, "urgente"' WHEN i % 11 = 0 THEN 'Llamar antes de entregar' ELSE NULL END
FROM n;

INSERT INTO entregas (id, pedido_id, repartidor_id, fecha, tipo)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2400)
SELECT
  i,
  (i * 13) % 1284 + 1,
  (i * 5) % 12 + 1,
  datetime('2026-01-05 09:00', '+' || (i % 250) || ' days', '+' || ((i * 30) % 480) || ' minutes'),
  CASE i % 3 WHEN 0 THEN 'estándar' WHEN 1 THEN 'recogida' ELSE 'express' END
FROM n;

CREATE VIEW pedidos_pendientes AS
  SELECT p.id, p.numero, t.nombre AS tienda, p.categoria, p.fecha
  FROM pedidos p JOIN tiendas t ON t.id = p.tienda_id
  WHERE p.estado IN ('pendiente', 'en camino');
