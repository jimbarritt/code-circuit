import ts from "typescript";
import type { Detector } from "../types.ts";
import { type Hit, type Resolver, type Site, siteDetector, unwrap } from "./clients.ts";

const TYPEORM_OPS = new Set(["find", "findBy", "findOne", "findOneBy", "findOneOrFail", "findOneByOrFail", "findAndCount", "findAndCountBy", "findByIds", "count", "countBy", "exist", "exists", "existsBy", "sum", "average", "minimum", "maximum", "save", "insert", "update", "upsert", "delete", "remove", "softDelete", "softRemove", "restore", "recover", "increment", "decrement", "clear", "query", "createQueryBuilder", "preload"]);
const MIKRO_ENTITY_OPS = new Set(["find", "findOne", "findOneOrFail", "findAll", "findAndCount", "findByCursor", "count", "nativeInsert", "nativeUpdate", "nativeDelete", "upsert", "upsertMany", "insert", "insertMany", "createQueryBuilder", "qb"]);
const MIKRO_OBJECT_OPS = new Set(["persist", "persistAndFlush", "remove", "removeAndFlush", "flush", "refresh", "populate", "lock", "execute"]);
const PRISMA_OPS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany", "count", "aggregate", "groupBy"]);
const PRISMA_RAW = new Set(["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe", "$runCommandRaw"]);
const MONGOOSE_OPS = new Set(["find", "findOne", "findById", "findByIdAndUpdate", "findByIdAndDelete", "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace", "create", "insertMany", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "countDocuments", "estimatedDocumentCount", "exists", "aggregate", "distinct", "bulkWrite"]);
const SEQUELIZE_OPS = new Set(["findAll", "findOne", "findByPk", "findOrCreate", "findAndCountAll", "create", "bulkCreate", "update", "destroy", "upsert", "count", "max", "min", "sum", "increment", "decrement", "truncate"]);
const DRIZZLE_OPS = new Set(["findMany", "findFirst"]);
const KYSELY_OPS = new Set(["selectFrom", "insertInto", "updateTable", "deleteFrom", "replaceInto", "mergeInto"]);
const UNIT_OF_WORK = { target: "(unit of work)", resolved: true };

const db = (protocol: string, method: string, t: { target: string; resolved: boolean }, rule: string): Hit => ({ kind: "database", protocol, method, ...t, rule });
const named = (s: Site) => (s.client.name !== undefined ? { target: s.client.name, resolved: !!s.client.resolved } : { target: s.recv?.getText() ?? "?", resolved: false });

/** Entity of a MikroORM persist or remove argument: `new User()`, `repo.create(...)` or `em.create(User, ...)` in a local. */
const entityOf = (r: Resolver, arg: ts.Expression | undefined): { target: string; resolved: boolean } => {
  if (!arg) return UNIT_OF_WORK;
  const e = unwrap(arg);
  const init = ts.isIdentifier(e) ? r.initOf(e) : e;
  const x = init && unwrap(init);
  if (x && ts.isNewExpression(x) && ts.isIdentifier(x.expression)) return { target: x.expression.text, resolved: true };
  if (x && ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "create") {
    const c = r.clientOf(x.expression.expression);
    if (c?.lib === "mikro-repo" && c.name) return { target: c.name, resolved: !!c.resolved };
    const first = x.arguments[0] && unwrap(x.arguments[0]);
    if (c?.lib === "mikro-em" && first && ts.isIdentifier(first)) return { target: first.text, resolved: true };
  }
  return { target: arg.getText(), resolved: false };
};

/** SQL of a query call: a string, or `{ text }` / `{ sql }`. */
const sql = (r: Resolver, arg: ts.Expression | undefined) => {
  const obj = arg && ts.isObjectLiteralExpression(unwrap(arg)) ? r.prop(arg, "text") ?? r.prop(arg, "sql") : undefined;
  return r.val(obj ?? arg);
};

/** Table of a drizzle table object: `pgTable('users', ...)`. */
const table = (r: Resolver, arg: ts.Expression | undefined) => {
  const init = arg && r.initOf(arg);
  const call = init && unwrap(init);
  if (call && ts.isCallExpression(call) && /Table$/.test(call.expression.getText())) return r.val(call.arguments[0]);
  return r.val(arg);
};

export const databaseDetector: Detector = siteDetector("database", (s, r) => {
  const { client: c, method: m, args } = s;
  switch (c.lib) {
    case "typeorm-repo":
      if (!TYPEORM_OPS.has(m)) return undefined;
      return db("typeorm", m, m === "query" ? sql(r, args[0]) : named(s), "typeorm-repository");
    case "typeorm-em": {
      if (m === "query") return db("typeorm", m, sql(r, args[0]), "typeorm-data-source");
      if (!TYPEORM_OPS.has(m) || !args[0]) return undefined;
      const e = unwrap(args[0]);
      return db("typeorm", m, ts.isIdentifier(e) ? { target: e.text, resolved: true } : r.val(e), "typeorm-entity-manager");
    }
    case "mikro-em":
      if (MIKRO_ENTITY_OPS.has(m) && args[0]) {
        const e = unwrap(args[0]);
        return db("mikro-orm", m, ts.isIdentifier(e) ? { target: e.text, resolved: true } : r.val(e), "mikro-orm-entity-manager");
      }
      if (!MIKRO_OBJECT_OPS.has(m)) return undefined;
      return db("mikro-orm", m, m === "execute" ? sql(r, args[0]) : m === "flush" ? UNIT_OF_WORK : entityOf(r, args[0]), "mikro-orm-entity-manager");
    case "mikro-repo":
      if (!MIKRO_ENTITY_OPS.has(m) && !MIKRO_OBJECT_OPS.has(m)) return undefined;
      return db("mikro-orm", m, named(s), "mikro-orm-repository");
    case "mikro-qb":
      return /^(execute|getResult|getResultList|getResultAndCount|getSingleResult|getCount)$/.test(m) ? db("mikro-orm", m, { target: s.recv?.getText() ?? "?", resolved: false }, "mikro-orm-query-builder") : undefined;
    case "prisma-model":
      return PRISMA_OPS.has(m) ? db("prisma", m, named(s), "prisma-model") : undefined;
    case "prisma":
      return PRISMA_RAW.has(m) ? db("prisma", m, sql(r, args[0]), "prisma-raw") : undefined;
    case "mongoose-model":
      return MONGOOSE_OPS.has(m) ? db("mongoose", m, named(s), "mongoose-model") : undefined;
    case "sequelize-model":
      return SEQUELIZE_OPS.has(m) ? db("sequelize", m, named(s), "sequelize-model") : undefined;
    case "sequelize":
      return m === "query" ? db("sequelize", m, sql(r, args[0]), "sequelize-query") : undefined;
    case "knex":
      if (m === "raw") return db("knex", m, sql(r, args[0]), "knex-raw");
      if (m === "()" && !ts.isPropertyAccessExpression(s.call.parent)) return db("knex", "select", r.val(args[0]), "knex-table");
      return m === "table" || m === "from" || m === "into" ? db("knex", m, r.val(args[0]), "knex-table") : undefined;
    case "knex-query":
      return db("knex", m, named(s), "knex-table");
    case "drizzle": {
      if (m === "execute") return db("drizzle", m, sql(r, args[0]), "drizzle-query");
      if (m === "insert" || m === "update" || m === "delete") return db("drizzle", m, table(r, args[0]), "drizzle-query");
      if (m !== "select" && m !== "selectDistinct") return undefined;
      const p = s.call.parent;
      const from = ts.isPropertyAccessExpression(p) && p.name.text === "from" && ts.isCallExpression(p.parent) ? p.parent.arguments[0] : undefined;
      return db("drizzle", m, from ? table(r, from) : { target: s.call.getText(), resolved: false }, "drizzle-query");
    }
    case "drizzle-model":
      return DRIZZLE_OPS.has(m) ? db("drizzle", m, named(s), "drizzle-query") : undefined;
    case "kysely":
      return KYSELY_OPS.has(m) ? db("kysely", m, r.val(args[0]), "kysely-query") : undefined;
    case "kysely-raw":
      return m === "execute" ? db("kysely", "sql", { target: s.recv?.getText() ?? "?", resolved: false }, "kysely-sql") : undefined;
    case "pg": case "mysql":
      return m === "query" || m === "execute" ? db(c.lib, m, sql(r, args[0]), `${c.lib}-query`) : undefined;
  }
  return undefined;
});
