import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getSessionUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log in" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getSessionUser()) redirect("/dashboard");
  const { next } = await searchParams;
  return <AuthForm mode="login" next={next} />;
}
