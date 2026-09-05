import { describe, it, expect } from "vitest";
import { runnableRoutineDdl } from "../../src/utils/routineDdl";

// Issue #456: the definition on screen is the one that can be run back. Same
// rule views got in #454, applied to procedures, functions and triggers.
describe("runnableRoutineDdl", () => {
  it("puts a DROP before a MySQL procedure, which has no OR REPLACE", () => {
    const ddl = "CREATE DEFINER=`root`@`%` PROCEDURE `alta`(IN n INT)\nBEGIN\n  SELECT n;\nEND";
    expect(runnableRoutineDdl("mysql", ddl, "alta")).toBe(
      "DROP PROCEDURE IF EXISTS `alta`;\n\n" + ddl + ";",
    );
  });

  it("drops a MySQL trigger by name", () => {
    const ddl = "CREATE DEFINER=`root`@`%` TRIGGER `t_ins` BEFORE INSERT ON `t` FOR EACH ROW SET @a = 1";
    expect(runnableRoutineDdl("mariadb", ddl, "t_ins")).toBe(
      "DROP TRIGGER IF EXISTS `t_ins`;\n\n" + ddl + ";",
    );
  });

  it("leaves a definition that already replaces itself alone", () => {
    const ddl = "CREATE OR REPLACE FUNCTION public.f(a integer)\n RETURNS integer\n AS $$ BEGIN RETURN a; END; $$ LANGUAGE plpgsql";
    expect(runnableRoutineDdl("postgres", ddl, "f")).toBe(ddl + ";");
  });

  it("adds OR REPLACE where the engine has it", () => {
    const ddl = "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql";
    expect(runnableRoutineDdl("postgresql", ddl, "f")).toBe(
      "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;",
    );
  });

  it("drops a PostgreSQL trigger by its table, which is how PostgreSQL drops one", () => {
    const ddl = "CREATE TRIGGER t_stamp BEFORE UPDATE ON public.docs FOR EACH ROW EXECUTE FUNCTION stamp()";
    expect(runnableRoutineDdl("postgres", ddl, "t_stamp")).toBe(
      "DROP TRIGGER IF EXISTS t_stamp ON public.docs;\n\n" + ddl + ";",
    );
  });

  it("drops an Informix procedure, whose body ends in END PROCEDURE", () => {
    const ddl = "create procedure alta(n int)\n  define x int;\n  let x = n;\nend procedure";
    expect(runnableRoutineDdl("informix", ddl, "alta")).toBe(
      "DROP PROCEDURE IF EXISTS alta;\n\n" + ddl + ";",
    );
  });

  it("drops a SQLite trigger", () => {
    const ddl = "CREATE TRIGGER t AFTER INSERT ON x BEGIN UPDATE y SET n = 1; END";
    expect(runnableRoutineDdl("sqlite", ddl, "t")).toBe(
      "DROP TRIGGER IF EXISTS t;\n\n" + ddl + ";",
    );
  });

  it("drops a MySQL event", () => {
    const ddl = "CREATE DEFINER=`root`@`%` EVENT `limpia` ON SCHEDULE EVERY 1 DAY DO DELETE FROM t";
    expect(runnableRoutineDdl("mysql", ddl, "limpia")).toBe(
      "DROP EVENT IF EXISTS `limpia`;\n\n" + ddl + ";",
    );
  });

  it("takes the trailing semicolon the catalog may already carry", () => {
    expect(runnableRoutineDdl("mysql", "CREATE PROCEDURE p() BEGIN SELECT 1; END;\n", "p")).toBe(
      "DROP PROCEDURE IF EXISTS p;\n\nCREATE PROCEDURE p() BEGIN SELECT 1; END;",
    );
  });

  it("returns text that is not a routine definition untouched", () => {
    expect(runnableRoutineDdl("mysql", "-- no definition available", "p")).toBe(
      "-- no definition available",
    );
  });
});
