// The demo database the media screenshots are taken against.
//
// It lives in the repository on purpose. The dataset behind the previous
// screenshots was built by hand and then lost, so the next release had nothing to
// reproduce them from — which is why this file exists rather than a note saying
// "create a sales database".
//
// Written for MySQL, which is what the published screenshots show (the editor
// quotes with backticks there). It fills every branch the object tree displays —
// tables, a view, routines, triggers, events — because a tree with empty folders
// makes the product look emptier than it is.
//
// The data is invented: Sonoran cities and Spanish names, so accents appear
// naturally in the grid instead of being a special case nobody sees.

export const DEMO_DB = "ventas";

/** Statements that build the demo, in order. Idempotent: it drops first. */
export const DEMO_SQL: readonly string[] = [
  `DROP DATABASE IF EXISTS \`${DEMO_DB}\``,
  `CREATE DATABASE \`${DEMO_DB}\` CHARACTER SET utf8mb4`,

  // --- tables ---------------------------------------------------------------
  `CREATE TABLE \`${DEMO_DB}\`.clientes (
     id INT PRIMARY KEY AUTO_INCREMENT,
     nombre VARCHAR(60) NOT NULL,
     email VARCHAR(80),
     ciudad VARCHAR(40),
     saldo DECIMAL(10,2),
     activo BOOLEAN,
     alta DATE
   )`,
  `CREATE TABLE \`${DEMO_DB}\`.productos (
     id INT PRIMARY KEY AUTO_INCREMENT,
     sku VARCHAR(20) NOT NULL UNIQUE,
     nombre VARCHAR(80) NOT NULL,
     categoria VARCHAR(40),
     precio DECIMAL(10,2) NOT NULL,
     existencias INT NOT NULL
   )`,
  `CREATE TABLE \`${DEMO_DB}\`.pedidos (
     id INT PRIMARY KEY AUTO_INCREMENT,
     cliente_id INT NOT NULL,
     fecha DATE NOT NULL,
     estado VARCHAR(20) NOT NULL,
     total DECIMAL(10,2),
     CONSTRAINT fk_pedidos_cliente FOREIGN KEY (cliente_id)
       REFERENCES \`${DEMO_DB}\`.clientes (id)
   )`,
  `CREATE TABLE \`${DEMO_DB}\`.detalle_pedido (
     id INT PRIMARY KEY AUTO_INCREMENT,
     pedido_id INT NOT NULL,
     producto_id INT NOT NULL,
     cantidad INT NOT NULL,
     precio_unitario DECIMAL(10,2) NOT NULL,
     CONSTRAINT fk_detalle_pedido FOREIGN KEY (pedido_id)
       REFERENCES \`${DEMO_DB}\`.pedidos (id),
     CONSTRAINT fk_detalle_producto FOREIGN KEY (producto_id)
       REFERENCES \`${DEMO_DB}\`.productos (id)
   )`,

  // --- rows -----------------------------------------------------------------
  `INSERT INTO \`${DEMO_DB}\`.clientes (nombre, email, ciudad, saldo, activo, alta) VALUES
     ('María López',   'maria.lopez@correo.mx', 'Hermosillo',   1250.00, true,  '2023-02-14'),
     ('Juan Pérez',    'jperez@correo.mx',      'Nogales',       980.50, true,  '2023-03-01'),
     ('Ana Gómez',     'ana.gomez@correo.mx',   'Guaymas',          NULL, false, '2023-05-22'),
     ('Luis Ramírez',  'lramirez@correo.mx',    'Cd. Obregón',  4321.99, true,  '2024-01-09'),
     ('Sofía Torres',  'storres@correo.mx',     'Hermosillo',      12.00, true,  '2024-04-18'),
     ('Carlos Ruiz',   'cruiz@correo.mx',       'Navojoa',        777.77, false, '2024-06-30'),
     ('Elena Díaz',    'ediaz@correo.mx',       'Caborca',        230.10, true,  '2024-08-12'),
     ('Miguel Ángel',  'mangel@correo.mx',      'Nogales',       5400.00, true,  '2024-11-03'),
     ('Paola Núñez',   'pnunez@correo.mx',      'Hermosillo',      88.25, true,  '2025-01-27'),
     ('Roberto Sil',   'rsil@correo.mx',        'Guaymas',       1590.40, false, '2025-03-15'),
     ('Verónica Paz',  'vpaz@correo.mx',        'Agua Prieta',    640.00, true,  '2025-05-02'),
     ('Andrés Solís',  'asolis@correo.mx',      'Puerto Peñasco', 315.75, true,  '2025-06-19')`,
  `INSERT INTO \`${DEMO_DB}\`.productos (sku, nombre, categoria, precio, existencias) VALUES
     ('SKU-1001', 'Teclado mecánico',      'Periféricos',  1299.00, 42),
     ('SKU-1002', 'Monitor 27"',           'Pantallas',    5890.00, 11),
     ('SKU-1003', 'Ratón inalámbrico',     'Periféricos',   549.50, 87),
     ('SKU-1004', 'Base refrigerante',     'Accesorios',    389.90,  0),
     ('SKU-1005', 'Disco SSD 1 TB',        'Almacenamiento',1750.00, 23),
     ('SKU-1006', 'Cámara web HD',         'Periféricos',   899.00,  6),
     ('SKU-1007', 'Concentrador USB-C',    'Accesorios',    420.00, 34),
     ('SKU-1008', 'Audífonos con micrófono','Audio',        999.99, 18)`,
  `INSERT INTO \`${DEMO_DB}\`.pedidos (cliente_id, fecha, estado, total) VALUES
     (1, '2025-06-02', 'entregado',  2598.00),
     (4, '2025-06-11', 'enviado',    5890.00),
     (2, '2025-06-18', 'pendiente',  1099.00),
     (8, '2025-06-24', 'entregado',  7640.00),
     (5, '2025-07-01', 'cancelado',   549.50),
     (9, '2025-07-08', 'entregado',  1750.00),
     (11,'2025-07-15', 'pendiente',   899.00),
     (7, '2025-07-21', 'enviado',    1419.99)`,
  `INSERT INTO \`${DEMO_DB}\`.detalle_pedido (pedido_id, producto_id, cantidad, precio_unitario) VALUES
     (1, 1, 2, 1299.00),
     (2, 2, 1, 5890.00),
     (3, 3, 2,  549.50),
     (4, 2, 1, 5890.00),
     (4, 5, 1, 1750.00),
     (5, 3, 1,  549.50),
     (6, 5, 1, 1750.00),
     (7, 6, 1,  899.00),
     (8, 8, 1,  999.99),
     (8, 7, 1,  420.00)`,

  // --- a view, so the tree's Vistas branch is not empty ---------------------
  `CREATE VIEW \`${DEMO_DB}\`.ventas_por_ciudad AS
     SELECT c.ciudad, COUNT(p.id) AS pedidos, SUM(p.total) AS importe
     FROM \`${DEMO_DB}\`.clientes c
     LEFT JOIN \`${DEMO_DB}\`.pedidos p ON p.cliente_id = c.id
     GROUP BY c.ciudad`,

  // --- routines -------------------------------------------------------------
  `CREATE PROCEDURE \`${DEMO_DB}\`.recalcular_totales()
     UPDATE \`${DEMO_DB}\`.pedidos p
     SET total = (
       SELECT COALESCE(SUM(d.cantidad * d.precio_unitario), 0)
       FROM \`${DEMO_DB}\`.detalle_pedido d WHERE d.pedido_id = p.id
     )`,
  `CREATE FUNCTION \`${DEMO_DB}\`.saldo_con_iva(saldo DECIMAL(10,2))
     RETURNS DECIMAL(10,2) DETERMINISTIC
     RETURN saldo * 1.16`,

  // --- a trigger and an event ------------------------------------------------
  `CREATE TRIGGER \`${DEMO_DB}\`.trg_pedido_alta
     BEFORE INSERT ON \`${DEMO_DB}\`.pedidos
     FOR EACH ROW SET NEW.estado = COALESCE(NEW.estado, 'pendiente')`,
  `CREATE EVENT \`${DEMO_DB}\`.ev_recalculo_diario
     ON SCHEDULE EVERY 1 DAY
     DO UPDATE \`${DEMO_DB}\`.pedidos SET estado = estado WHERE 1 = 0`,
];

/**
 * The connection the screenshots are taken through.
 *
 * A container of its own, separate from the e2e fixtures. Two reasons: the test
 * database would otherwise appear in the object tree of a published screenshot, and
 * a release chore should not be able to disturb the suite's data.
 *
 *   docker run -d --name quaero-demo-mysql -e MYSQL_ROOT_PASSWORD=demo123  *     -p 13307:3306 mysql:8 --event-scheduler=ON
 */
export const DEMO_CONNECTION = {
  id: "demo-ventas",
  name: "Ventas (demo)",
  driver: "mysql",
  params: {
    host: "127.0.0.1",
    port: "13307",
    user: "root",
    password: "demo123",
    database: DEMO_DB,
  },
} as const;
