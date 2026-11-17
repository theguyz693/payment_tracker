// Setup for real-MongoDB integration tests.
//
// Connection: MONGODB_TEST_URI, else MONGODB_URI from .env.local. Must be a
// replica set (Atlas) for the transaction tests.
// Safety: tests only ever use a fresh database named pt_it_<random>_test,
// created here and dropped after the file finishes. They never touch the
// app's configured database.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";

function fromEnvFile(key: string): string | undefined {
  try {
    const text = readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8");
    const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const uri = process.env.MONGODB_TEST_URI || fromEnvFile("MONGODB_URI");
if (!uri) throw new Error("Integration tests need MONGODB_TEST_URI (or MONGODB_URI in .env.local).");
const dbName = `pt_it_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}_test`;
if (!/^pt_it_[a-z0-9]+_[a-f0-9]+_test$/.test(dbName)) throw new Error("Refusing to use a non-test database.");

process.env.MONGODB_URI = uri;
process.env.MONGODB_DB = dbName;
process.env.BETTER_AUTH_SECRET ||= "integration-test-secret-integration-test-secret";
delete process.env.MONGODB_TRANSACTIONS;

beforeAll(async () => {
  const { ensureIndexes } = await import("@/server/models");
  await ensureIndexes();
});

afterAll(async () => {
  const { getMongoClient, getDb } = await import("@/server/mongo");
  const db = getDb();
  if (db.databaseName !== dbName || !db.databaseName.endsWith("_test")) throw new Error("Refusing to drop a non-test database.");
  // A least-privilege user may not drop databases; dropping its collections
  // empties the throwaway database just as well (MongoDB removes it when empty).
  try {
    await db.dropDatabase();
  } catch {
    for (const c of await db.listCollections({}, { nameOnly: true }).toArray()) await db.dropCollection(c.name);
  }
  await getMongoClient().close();
});
