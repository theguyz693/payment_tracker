import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isValidTimeZone, today } from "@/lib/dates";
import { getAuth } from "./auth";
import { ensureIndexes } from "./models";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** The signed-in user for this request, or null. Verified server-side from the session cookie. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  await ensureIndexes();
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email };
});

/**
 * Use in every page and server action that touches user data.
 * The user id ALWAYS comes from here — never from the client.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

const FALLBACK_TZ = process.env.DEFAULT_TIMEZONE || "Asia/Kolkata";

/** The user's timezone (set by the browser in a cookie), used to decide what "today" is. */
export async function getTimeZone(): Promise<string> {
  const tz = (await cookies()).get("tz")?.value;
  return isValidTimeZone(tz) ? tz : FALLBACK_TZ;
}

export async function getToday(): Promise<string> {
  return today(await getTimeZone());
}
