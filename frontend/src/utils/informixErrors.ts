// Readable text for Informix errors (issue #559). Over DRDA (libdrda, #557) the
// server sends only the SQLCODE, SQLSTATE and message tokens, never the text:
//
//   SQLCODE -206, SQLSTATE 42000: e2e_items
//   SQLCODE -268, ISAM -100, SQLSTATE 23000: informix.u101_3
//
// This module turns that into a sentence in the app's language. The wording is
// ours (IBM's message files are copyrighted), and a code with no entry yields
// null so the caller shows the raw text — never an invented meaning. Pure.

import type { Locale } from "./translate";

export interface Sqlca {
  code: number;
  isam?: number;
  sqlstate: string;
  /** Message tokens, in order (libdrda joins them with ", "). */
  tokens: string[];
}

const SQLCA_RE = /SQLCODE (-?\d+)(?:, ISAM (-?\d+))?, SQLSTATE (\w{5})(?:: (.*))?$/s;

/** Pull the SQLCODE, ISAM code, SQLSTATE and tokens out of a driver message. */
export function parseSqlca(msg: string): Sqlca | null {
  const m = SQLCA_RE.exec(msg);
  if (!m) return null;
  return {
    code: Number(m[1]),
    isam: m[2] !== undefined ? Number(m[2]) : undefined,
    sqlstate: m[3],
    tokens: m[4] ? m[4].split(", ") : [],
  };
}

// {0}, {1}… are the message tokens. Each token's meaning was measured against a
// real Informix 15 over DRDA (e.g. -692 names the referenced key, not the
// foreign key; -236 and -703 name the table); the raw message is shown too.
const TEXTS: Record<number, Record<Locale, string>> = {
  [-201]: { es: "Error de sintaxis en la sentencia.", en: "Syntax error in the statement." },
  [-206]: { es: "La tabla {0} no existe en la base de datos.", en: "Table {0} does not exist in the database." },
  [-217]: { es: "La columna {0} no está en ninguna tabla de la consulta.", en: "Column {0} is not in any table of the query." },
  [-236]: { es: "El INSERT en {0} no tiene tantas columnas como valores.", en: "The INSERT into {0} has a different number of columns and values." },
  [-239]: { es: "Valor duplicado en un índice único: la fila no se insertó.", en: "Duplicate value in a unique index: the row was not inserted." },
  [-268]: { es: "Se viola la restricción única {0}: ese valor ya existe.", en: "Unique constraint {0} violated: that value already exists." },
  [-310]: { es: "La tabla {0} ya existe.", en: "Table {0} already exists." },
  [-391]: { es: "La columna {0} no admite NULL.", en: "Column {0} does not accept NULL." },
  [-691]: { es: "Falta la fila referenciada por la llave foránea {0}.", en: "The row referenced by foreign key {0} is missing." },
  [-692]: { es: "Otra tabla aún referencia la llave {0} de esta fila.", en: "Another table still references key {0} of this row." },
  [-703]: { es: "Una columna de la llave primaria de {0} no puede ser NULL.", en: "A primary key column of {0} cannot be NULL." },
  [-107]: { es: "El registro está bloqueado por otra sesión.", en: "The record is locked by another session." },
  [-243]: { es: "No se pudo posicionar en la tabla (bloqueada por otra sesión).", en: "Could not position in the table (locked by another session)." },
  [-244]: { es: "No se pudo leer la fila siguiente (bloqueada por otra sesión).", en: "Could not read the next row (locked by another session)." },
  [-245]: { es: "No se pudo posicionar por el índice (bloqueado por otra sesión).", en: "Could not position through the index (locked by another session)." },
  [-255]: { es: "No hay ninguna transacción abierta.", en: "No transaction is open." },
  [-256]: { es: "La base de datos no tiene registro de transacciones.", en: "The database has no transaction log." },
  [-329]: { es: "La base de datos no existe o no hay permiso para abrirla.", en: "The database does not exist or cannot be opened." },
  [-387]: { es: "No tienes permiso de conexión a esta base de datos.", en: "You have no connect permission on this database." },
  [-908]: { es: "No se pudo conectar con el servidor de base de datos.", en: "Could not connect to the database server." },
  [-930]: { es: "No se encuentra el servidor de base de datos.", en: "The database server cannot be found." },
  [-1204]: { es: "Año inválido en la fecha.", en: "Invalid year in the date." },
  [-1205]: { es: "Mes inválido en la fecha.", en: "Invalid month in the date." },
  [-1213]: { es: "No se pudo convertir el texto en número.", en: "The text could not be converted to a number." },
  [-1218]: { es: "No se pudo convertir el texto en fecha.", en: "The text could not be converted to a date." },
  [-23103]: {
    es: "Falló la conversión de juego de caracteres: revisa la codificación de la conexión.",
    en: "Code-set conversion failed: check the connection's encoding.",
  },
};

/**
 * The readable sentence for an Informix error message, or null when it carries
 * no SQLCODE or the code has no entry (or lacks the token its sentence needs).
 */
export function informixErrorText(msg: string, locale: Locale): string | null {
  const ca = parseSqlca(msg);
  const text = ca && TEXTS[ca.code]?.[locale];
  if (!ca || !text) return null;
  let missing = false;
  const out = text.replace(/\{(\d+)\}/g, (_, i) => {
    const tok = ca.tokens[Number(i)];
    if (tok === undefined) missing = true;
    return tok ?? "";
  });
  return missing ? null : out;
}
