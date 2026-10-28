import "server-only";
import { MongoClient, type Db } from "mongodb";

// One MongoClient per server process (and across dev hot-reloads).
// The client connects lazily on first use, so importing this never needs the
// database (e.g. during `next build`).

const globalForMongo = globalThis as unknown as { _mongoClient?: MongoClient };

function mongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set. Add it to .env.local (see README).");
  return uri;
}

export function getMongoClient(): MongoClient {
  if (!globalForMongo._mongoClient) {
    globalForMongo._mongoClient = new MongoClient(mongoUri(), {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10_000,
      appName: "payment-tracker",
    });
  }
  return globalForMongo._mongoClient;
}

/** Database name comes from MONGODB_DB (default "payment_tracker"). */
export function getDb(): Db {
  return getMongoClient().db(process.env.MONGODB_DB || "payment_tracker");
}
