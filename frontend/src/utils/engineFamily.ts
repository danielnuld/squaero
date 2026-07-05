// The engine "family" a driver name belongs to: aliases collapse to one name so
// per-engine logic (SQL dialect, catalog queries, capabilities) can switch on a
// single value. MySQL/MariaDB → "mysql"; PostgreSQL/postgres → "postgres";
// everything else passes through lower-cased. Previously duplicated privately in
// routines/triggers/serverMonitor/userAdmin/treeObjects/indexes (issue #186).
export function engineFamily(engine: string): string {
  const e = (engine || "").toLowerCase();
  if (e === "mysql" || e === "mariadb") return "mysql";
  if (e === "postgres" || e === "postgresql") return "postgres";
  return e;
}
