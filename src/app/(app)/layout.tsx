import { BottomNav, Sidebar, TopBar } from "@/components/AppNav";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { requireUser } from "@/server/session";

// Every route in this group requires a signed-in user.
// (Pages and server actions also call requireUser() themselves.)
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const u = { name: user.name, email: user.email };
  return (
    <>
      <Sidebar user={u} />
      <div className="lg:pl-60">
        <TopBar user={u} />
        <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 sm:pb-16 lg:pt-8">{children}</main>
      </div>
      <BottomNav />
      <KeyboardShortcuts />
    </>
  );
}
