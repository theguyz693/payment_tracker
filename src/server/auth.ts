import "server-only";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { deleteAllUserData } from "./account";
import { getDb, getMongoClient } from "./mongo";

const TOKEN_BEARING_PATHS = new Set(["/get-session", "/sign-in/email", "/sign-up/email", "/list-sessions"]);

/** Copy of an auth response without any `token` fields (top level, session, or list items). */
export function stripTokens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTokens);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "token") continue;
    out[k] = k === "session" || k === "sessions" ? stripTokens(v) : v;
  }
  return out;
}

function createAuth() {
  // Atlas supports transactions. A local standalone mongod does not: set MONGODB_TRANSACTIONS=false.
  const useTransactions = process.env.MONGODB_TRANSACTIONS !== "false";
  const secret = process.env.BETTER_AUTH_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!secret) throw new Error("BETTER_AUTH_SECRET must be set in production.");
    if (secret.length < 32) console.warn("[auth] BETTER_AUTH_SECRET is shorter than 32 characters. Generate a longer one (see README).");
  }

  return betterAuth({
    appName: "Payment Tracker",
    secret,
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
      // Changing or resetting the password signs out every other device.
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // extend once a day while in use
      // No cookie cache: every request checks the session in the database, so
      // signing out other devices or deleting the account takes effect at once.
      cookieCache: { enabled: false },
    },
    user: {
      deleteUser: {
        enabled: true,
        // Remove everything the user owns before Better Auth deletes the
        // user, their sessions and their credential account.
        beforeDelete: async (user) => {
          const counts = await deleteAllUserData(user.id);
          console.info("[auth] deleted account data", counts);
        },
      },
    },
    hooks: {
      // Session tokens live only in the httpOnly cookie. Better Auth also puts
      // them in some JSON responses (for bearer-token clients, which this app
      // doesn't use), where page JavaScript could read them: strip them.
      after: createAuthMiddleware(async (ctx) => {
        if (!TOKEN_BEARING_PATHS.has(ctx.path)) return;
        const returned = ctx.context.returned;
        if (!returned || typeof returned !== "object" || returned instanceof Response) return;
        return ctx.json(stripTokens(returned) as Record<string, unknown>);
      }),
      // Account deletion always needs the current password (Better Auth would
      // otherwise accept any session younger than a day).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/delete-user") {
          const password = (ctx.body as { password?: unknown } | undefined)?.password;
          if (typeof password !== "string" || password.length === 0) {
            throw new APIError("BAD_REQUEST", { message: "Enter your password to delete your account." });
          }
        }
      }),
    },
    rateLimit: {
      // On by default in production. Stored in MongoDB so it works across serverless instances.
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60 * 10, max: 10 },
        "/change-password": { window: 60 * 10, max: 10 },
        "/delete-user": { window: 60 * 10, max: 5 },
      },
    },
    advanced: {
      // Vercel sets x-forwarded-for to the real client IP (overwriting anything
      // the client sent), so it's safe to rate-limit on. Behind another proxy,
      // configure trustedProxies instead.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      // Secure (HTTPS-only, __Secure- prefixed) cookies whenever the app runs on https.
      useSecureCookies: process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
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
