import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landing } from "@/components/landing/Landing";
import { getSessionUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Payment Tracker — know where your money is going",
  description:
    "Track payments, recurring expenses, bills, and money you're expecting — all in one beautifully simple place.",
};

// Public landing page. Signed-in users go straight to their dashboard.
export default async function Home() {
  let signedIn = false;
  try {
    signedIn = !!(await getSessionUser());
  } catch (e) {
    // If the session check fails (e.g. database unreachable), still show the landing page.
    console.error("[landing] session check failed", e);
  }
  if (signedIn) redirect("/dashboard");
  return <Landing />;
}
