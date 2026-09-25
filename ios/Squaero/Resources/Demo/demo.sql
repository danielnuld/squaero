-- The demo database (issue #579, task 7.4): what App Review and a new user
-- open with no server, no account and no network. Courts, rooms, 1 284 case
-- files and their hearings, with foreign keys both ways, a view and NULLs,
-- so browsing, related data, editing, queries and export all have something
-- to show. Generated, not copied: the same rows on every phone.

PRAGMA foreign_keys = ON;

CREATE TABLE juzgados (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  ciudad TEXT NOT NULL
);

CREATE TABLE salas (
  id INTEGER PRIMARY KEY,
  juzgado_id INTEGER NOT NULL REFERENCES juzgados(id),
  nombre TEXT NOT NULL,
  capacidad INTEGER
);

CREATE TABLE expedientes (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  juzgado_id INTEGER NOT NULL REFERENCES juzgados(id),
  materia TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('abierto', 'en trámite', 'resuelto', 'archivado')),
  monto REAL,
  abierto DATE NOT NULL,
  nota TEXT
);

CREATE TABLE audiencias (
  id INTEGER PRIMARY KEY,
  expediente_id INTEGER NOT NULL REFERENCES expedientes(id),
  sala_id INTEGER NOT NULL REFERENCES salas(id),
  fecha DATETIME NOT NULL,
  tipo TEXT NOT NULL
);

INSERT INTO juzgados (id, nombre, ciudad) VALUES
  (1, 'Primero Civil', 'Hermosillo'),
  (2, 'Segundo Civil', 'Hermosillo'),
  (3, 'Primero Familiar', 'Ciudad Obregón'),
  (4, 'Mercantil', 'Nogales'),
  (5, 'Laboral', 'Guaymas');

INSERT INTO salas (id, juzgado_id, nombre, capacidad)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 12)
SELECT i, (i - 1) % 5 + 1, 'Sala ' || i, CASE WHEN i % 4 = 0 THEN NULL ELSE 20 + (i * 7) % 40 END FROM n;

INSERT INTO expedientes (id, numero, juzgado_id, materia, estado, monto, abierto, nota)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1284)
SELECT
  i,
  printf('%04d/%d', i, 2022 + i % 4),
  (i * 7) % 5 + 1,
  CASE i % 4 WHEN 0 THEN 'civil' WHEN 1 THEN 'familiar' WHEN 2 THEN 'mercantil' ELSE 'laboral' END,
  CASE i % 7 WHEN 0 THEN 'archivado' WHEN 1 THEN 'resuelto' WHEN 2 THEN 'en trámite' ELSE 'abierto' END,
  CASE WHEN i % 5 = 0 THEN NULL ELSE round((i * 1373 % 90000) + 1500.5, 2) END,
  date('2022-01-03', '+' || (i * 3 % 1300) || ' days'),
  CASE WHEN i % 9 = 0 THEN 'Revisar anexos, "urgente"' WHEN i % 11 = 0 THEN 'Notificar a ambas partes' ELSE NULL END
FROM n;

INSERT INTO audiencias (id, expediente_id, sala_id, fecha, tipo)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2400)
SELECT
  i,
  (i * 13) % 1284 + 1,
  (i * 5) % 12 + 1,
  datetime('2026-01-05 09:00', '+' || (i % 250) || ' days', '+' || ((i * 30) % 480) || ' minutes'),
  CASE i % 3 WHEN 0 THEN 'inicial' WHEN 1 THEN 'intermedia' ELSE 'de juicio' END
FROM n;

CREATE VIEW expedientes_abiertos AS
  SELECT e.id, e.numero, j.nombre AS juzgado, e.materia, e.abierto
  FROM expedientes e JOIN juzgados j ON j.id = e.juzgado_id
  WHERE e.estado IN ('abierto', 'en trámite');
