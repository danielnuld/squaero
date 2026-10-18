import { describe, expect, it } from "vitest";
import { tokenizeSql } from "../../src/utils/sqlTokens";

// The tokenizer under the editor's semantic layer (issue #660).

const kinds = (sql: string, engine?: string) => tokenizeSql(sql, engine).map((t) => `${t.kind}:${t.value}`);

describe("tokenizeSql", () => {
  it("cuts code into words, numbers and punctuation with offsets", () => {
    const toks = tokenizeSql("SELECT a.b, 1.5 FROM t");
    expect(toks.map((t) => t.text)).toEqual(["SELECT", "a", ".", "b", ",", "1.5", "FROM", "t"]);
    expect(toks[1]).toMatchObject({ kind: "word", start: 7, end: 8 });
    expect(toks[5].kind).toBe("number");
  });

  it("drops comments and keeps strings opaque", () => {
    expect(kinds("SELECT 'from x' -- where y\n/* join */ FROM t")).toEqual([
      "word:SELECT", "string:'from x'", "word:FROM", "word:t",
    ]);
  });

  it("reads delimited identifiers per dialect", () => {
    expect(kinds('SELECT "a""b" FROM t', "postgres")).toEqual(["word:SELECT", 'quoted:a"b', "word:FROM", "word:t"]);
    expect(kinds("SELECT `my col` FROM t", "mysql")[1]).toBe("quoted:my col");
    expect(kinds('SELECT "x"', "mysql")[1]).toBe('string:"x"');
    expect(kinds("SELECT [my]]col] FROM t", "mssql")[1]).toBe("quoted:my]col");
    expect(kinds('SELECT "x"', "mssql")[1]).toBe("quoted:x");
    // Informix delimits nothing: "x" is a string and { } is a comment.
    expect(kinds('SELECT "x" {note} FROM t', "informix")).toEqual(['word:SELECT', 'string:"x"', "word:FROM", "word:t"]);
  });

  it("keeps the offsets of the original text, quotes included", () => {
    const [, q] = tokenizeSql('SELECT "Año"', "sqlite");
    expect(q).toMatchObject({ kind: "quoted", value: "Año", start: 7, end: 12 });
  });

  it("recognizes parameters and casts", () => {
    expect(kinds("WHERE a = ? AND b = :id AND c = $1 AND d::int = @v")).toEqual([
      "word:WHERE", "word:a", "punct:=", "param:?", "word:AND", "word:b", "punct:=", "param::id",
      "word:AND", "word:c", "punct:=", "param:$1", "word:AND", "word:d", "punct:::", "word:int",
      "punct:=", "param:@v",
    ]);
  });

  it("reads non-ASCII names as words", () => {
    expect(kinds("SELECT año FROM categorías")).toEqual(["word:SELECT", "word:año", "word:FROM", "word:categorías"]);
  });

  it("never throws on unterminated input", () => {
    expect(() => tokenizeSql("SELECT 'abc")).not.toThrow();
    expect(() => tokenizeSql('SELECT "abc', "postgres")).not.toThrow();
    expect(() => tokenizeSql("SELECT [abc", "mssql")).not.toThrow();
    expect(kinds("SELECT [abc", "mssql")[1]).toBe("quoted:abc");
    expect(tokenizeSql("")).toEqual([]);
  });
});
