import { describe, it, expect } from "vitest";
import {
  mongoCollRef,
  mongoDropSql,
  mongoEmptySql,
  mongoRenameSql,
  mongoIndexListSql,
  mongoCreateIndexSql,
  mongoDropIndexSql,
  mongoKillSql,
  mongoStatementFromProfile,
  mongoExplainStatement,
} from "../../src/utils/mongoStatements";

describe("mongoCollRef", () => {
  it("uses db.<name> for a plain identifier, dotted names included", () => {
    expect(mongoCollRef("orders")).toBe("db.orders");
    expect(mongoCollRef("_tmp1")).toBe("db._tmp1");
    expect(mongoCollRef("system.profile")).toBe("db.system.profile");
  });

  it("goes through getCollection for anything else, quoted so it cannot break out", () => {
    expect(mongoCollRef("my-coll")).toBe('db.getCollection("my-coll")');
    expect(mongoCollRef("1abc")).toBe('db.getCollection("1abc")');
    expect(mongoCollRef('a"b')).toBe('db.getCollection("a\\"b")');
    expect(mongoCollRef("x\\")).toBe('db.getCollection("x\\\\")');
    expect(mongoCollRef("a b")).toBe('db.getCollection("a b")');
    expect(mongoCollRef("")).toBe('db.getCollection("")');
  });
});

describe("collection management statements", () => {
  it("drops and empties", () => {
    expect(mongoDropSql("orders")).toBe("db.orders.drop()");
    expect(mongoDropSql("my-coll")).toBe('db.getCollection("my-coll").drop()');
    expect(mongoEmptySql("orders")).toBe("db.orders.deleteMany({})");
    expect(mongoEmptySql("a.b")).toBe("db.a.b.deleteMany({})");
  });

  it("renames to a valid new name", () => {
    expect(mongoRenameSql("orders", "orders_old")).toBe('db.orders.renameCollection("orders_old")');
    expect(mongoRenameSql("my-coll", "  other ")).toBe(
      'db.getCollection("my-coll").renameCollection("other")',
    );
  });

  it("quotes the new name", () => {
    expect(mongoRenameSql("a", 'x"); db.dropDatabase(); ("')).toBe(
      'db.a.renameCollection("x\\"); db.dropDatabase(); (\\"")',
    );
  });

  it("refuses names a collection cannot have", () => {
    expect(mongoRenameSql("a", "")).toBeNull();
    expect(mongoRenameSql("a", "   ")).toBeNull();
    expect(mongoRenameSql("a", "a")).toBeNull();
    expect(mongoRenameSql("a", "b$c")).toBeNull();
    expect(mongoRenameSql("a", "b\0c")).toBeNull();
    expect(mongoRenameSql("a", "system.hack")).toBeNull();
  });
});

describe("index statements", () => {
  it("lists the indexes of a collection", () => {
    expect(mongoIndexListSql("orders")).toBe("db.orders.getIndexes()");
    expect(mongoIndexListSql("my-coll")).toBe('db.getCollection("my-coll").getIndexes()');
  });

  it("creates an index on ascending keys with its name, unique or not", () => {
    expect(mongoCreateIndexSql("orders", "sku_1", ["sku"], false)).toBe(
      'db.orders.createIndex({"sku": 1}, {"name": "sku_1"})',
    );
    expect(mongoCreateIndexSql("orders", "by_cust", ["cust.id", "date"], true)).toBe(
      'db.orders.createIndex({"cust.id": 1, "date": 1}, {"name": "by_cust", "unique": true})',
    );
  });

  it("quotes field and index names", () => {
    expect(mongoCreateIndexSql("c", 'n"x', ['f"g'], false)).toBe(
      'db.c.createIndex({"f\\"g": 1}, {"name": "n\\"x"})',
    );
  });

  it("drops an index by name", () => {
    expect(mongoDropIndexSql("orders", "sku_1")).toBe('db.orders.dropIndex("sku_1")');
    expect(mongoDropIndexSql("orders", 'a"b')).toBe('db.orders.dropIndex("a\\"b")');
  });
});

describe("mongoKillSql", () => {
  it("takes an integer opid, or a sharded cluster's shard:number", () => {
    expect(mongoKillSql("12345")).toBe("db.killOp(12345)");
    expect(mongoKillSql(" 9 ")).toBe("db.killOp(9)");
    expect(mongoKillSql("shard01:77")).toBe('db.killOp("shard01:77")');
    expect(mongoKillSql("rs-a.b:1")).toBe('db.killOp("rs-a.b:1")');
  });

  it("refuses everything else", () => {
    for (const bad of ["", "x", "-1", "1.5", "1)", 'a"b:1', "a:b", "a:1;b", " "]) {
      expect(mongoKillSql(bad)).toBeNull();
    }
  });
});

describe("mongoStatementFromProfile", () => {
  const ns = "shop.orders";

  it("rebuilds a find with its filter, projection, sort, skip and limit", () => {
    const cmd = JSON.stringify({
      find: "orders",
      filter: { status: "open", total: { $gt: 10 } },
      projection: { _id: 0, total: 1 },
      sort: { total: -1 },
      skip: 5,
      limit: 20,
      lsid: { id: { $binary: {} } },
      $db: "shop",
    });
    expect(mongoStatementFromProfile(ns, cmd)).toBe(
      'db.orders.find({"status":"open","total":{"$gt":10}}, {"_id":0,"total":1}).sort({"total":-1}).skip(5).limit(20)',
    );
  });

  it("rebuilds a bare find as find({})", () => {
    expect(mongoStatementFromProfile(ns, JSON.stringify({ find: "orders", filter: {} }))).toBe(
      "db.orders.find({})",
    );
    expect(mongoStatementFromProfile(ns, JSON.stringify({ find: "orders" }))).toBe("db.orders.find({})");
  });

  it("rebuilds an aggregate from its pipeline", () => {
    const cmd = JSON.stringify({ aggregate: "orders", pipeline: [{ $match: { a: 1 } }], cursor: {} });
    expect(mongoStatementFromProfile(ns, cmd)).toBe('db.orders.aggregate([{"$match":{"a":1}}])');
  });

  it("rebuilds count and distinct", () => {
    expect(mongoStatementFromProfile(ns, JSON.stringify({ count: "orders", query: { a: 1 } }))).toBe(
      'db.orders.countDocuments({"a":1})',
    );
    expect(
      mongoStatementFromProfile(ns, JSON.stringify({ distinct: "orders", key: "status", query: {} })),
    ).toBe('db.orders.distinct("status", {})');
  });

  it("addresses a collection whose name is not an identifier through getCollection", () => {
    expect(
      mongoStatementFromProfile("shop.my-coll", JSON.stringify({ find: "my-coll", filter: {} })),
    ).toBe('db.getCollection("my-coll").find({})');
    expect(mongoStatementFromProfile("shop.a.b", JSON.stringify({ find: "a.b", filter: {} }))).toBe(
      "db.a.b.find({})",
    );
  });

  it("offers nothing for writes, other commands, system collections or garbage", () => {
    expect(
      mongoStatementFromProfile(ns, JSON.stringify({ update: "orders", updates: [{ q: {}, u: {} }] })),
    ).toBeNull();
    expect(mongoStatementFromProfile(ns, JSON.stringify({ insert: "orders" }))).toBeNull();
    expect(mongoStatementFromProfile("shop.system.profile", JSON.stringify({ find: "x" }))).toBeNull();
    expect(mongoStatementFromProfile("noDot", JSON.stringify({ find: "x" }))).toBeNull();
    expect(mongoStatementFromProfile(ns, "not json")).toBeNull();
    expect(mongoStatementFromProfile(ns, "[1]")).toBeNull();
    expect(mongoStatementFromProfile(ns, "null")).toBeNull();
    expect(mongoStatementFromProfile(ns, "")).toBeNull();
  });

  it("ignores a non-positive skip and limit", () => {
    expect(
      mongoStatementFromProfile(ns, JSON.stringify({ find: "orders", filter: {}, skip: 0, limit: 0 })),
    ).toBe("db.orders.find({})");
  });
});

describe("mongoExplainStatement", () => {
  it("appends a queryPlanner explain, dropping a trailing semicolon", () => {
    expect(mongoExplainStatement("db.users.find({a: 1})")).toBe('db.users.find({a: 1}).explain("queryPlanner")');
    expect(mongoExplainStatement("  db.users.find().sort({a: 1}).limit(3);  ")).toBe(
      'db.users.find().sort({a: 1}).limit(3).explain("queryPlanner")',
    );
    expect(mongoExplainStatement("db.users.aggregate([{$match: {a: 1}}])")).toBe(
      'db.users.aggregate([{$match: {a: 1}}]).explain("queryPlanner")',
    );
  });

  it("keeps an explain the user already wrote", () => {
    expect(mongoExplainStatement('db.users.find().explain("executionStats")')).toBe(
      'db.users.find().explain("executionStats")',
    );
    expect(mongoExplainStatement("db.users.find().explain();")).toBe("db.users.find().explain()");
  });

  it("turns findOne into a find of one document", () => {
    expect(mongoExplainStatement("db.users.findOne({a: 1})")).toBe(
      'db.users.find({a: 1}).limit(1).explain("queryPlanner")',
    );
  });

  it("is null for something that is not a statement on the database", () => {
    expect(mongoExplainStatement("SELECT 1")).toBeNull();
    expect(mongoExplainStatement("")).toBeNull();
    expect(mongoExplainStatement("   ")).toBeNull();
  });
});
