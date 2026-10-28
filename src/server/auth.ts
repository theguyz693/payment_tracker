import "server-only";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { getDb, getMongoClient } from "./mongo";

function createAuth() {
  // Atlas supports transactions. A local standalone mongod does not: set MONGODB_TRANSACTIONS=false.
  const useTransactions = process.env.MONGODB_TRANSACTIONS !== "false";

  return betterAuth({
    appName: "Payment Tracker",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : [],
    database: mongodbAdapter(getDb(), {
      client: useTransactions ? getMongoClient() : undefined,
      transaction: useTransactions,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      requireEmailVerification: false, // future: turn on with an email provider
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // extend once a day while in use
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: {
      // On by default in production. Stored in MongoDB so it works across serverless instances.
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60 * 10, max: 10 },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { _auth?: Auth };

/** Lazily created so `next build` doesn't need database credentials. */
export function getAuth(): Auth {
  globalForAuth._auth ??= createAuth();
  return globalForAuth._auth;
}
