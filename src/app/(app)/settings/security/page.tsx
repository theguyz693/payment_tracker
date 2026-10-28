import Link from "next/link";
import { ChangePasswordForm, DeleteAccountForm, SignOutOthersButton } from "@/components/SecurityForms";
import { Card, CardTitle, Note, PageHeader, Pill, Tabs, btnSecondary } from "@/components/ui";
import { Download } from "@/components/icons";
import { listMySessions, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy & security" };

const EXPORTS = [
  { kind: "all", label: "Everything (JSON)", hint: "All records in one file, amounts as stored." },
  { kind: "items", label: "Payments & receivables", hint: "Every item, including deleted ones." },
  { kind: "goals", label: "Savings goals", hint: "Goals with every contribution and withdrawal." },
  { kind: "loans", label: "Loans", hint: "Loan terms and prepayments." },
  { kind: "investments", label: "Investments", hint: "Every buy, sale and payout." },
];

/** "Chrome on Windows" from a user-agent string (best effort, display only). */
function device(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export default async function SecurityPage() {
  const user = await requireUser();
  const sessions = await listMySessions();
  const others = sessions.filter((s) => !s.current).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Tabs
        active="security"
        tabs={[
          { key: "general", label: "General", href: "/settings" },
          { key: "security", label: "Privacy & security", href: "/settings/security" },
        ]}
      />
      <PageHeader title="Privacy & security" description="Your sign-ins, your data, and your account." />

      <Card>
        <CardTitle hint="Devices currently signed in to this account">Active sessions</CardTitle>
        <ul className="divide-y divide-line">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <div>
                <div className="flex items-center gap-2 font-medium">
                  {device(s.userAgent)} {s.current && <Pill tone="gain">This device</Pill>}
                </div>
                <div className="text-xs text-ink-3">
                  Signed in {fmt(s.createdAt)} · last active {fmt(s.updatedAt)}
                  {s.ipAddress && !/^[0:.]+$/.test(s.ipAddress) && ` · ${s.ipAddress}`}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <SignOutOthersButton others={others} />
        </div>
        <p className="mt-2 text-xs text-ink-3">Sessions last 30 days and are extended while you use the app. Signing out ends a session immediately.</p>
      </Card>

      <Card>
        <CardTitle hint="Changing your password signs out every other device.">Password</CardTitle>
        <ChangePasswordForm />
      </Card>

      <Card>
        <CardTitle hint="Only your own records, straight from the database.">Download your data</CardTitle>
        <ul className="divide-y divide-line">
          {EXPORTS.map((e) => (
            <li key={e.kind} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div>
                <div className="font-medium">{e.label}</div>
                <div className="text-xs text-ink-3">{e.hint}</div>
              </div>
              <a href={`/api/export/${e.kind}`} download className={btnSecondary}>
                <Download width={14} height={14} /> {e.kind === "all" ? "JSON" : "CSV"}
              </a>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div>
              <div className="font-medium">Payment history ledger</div>
              <div className="text-xs text-ink-3">Filterable on the History page.</div>
            </div>
            <Link href="/transactions/history" className={btnSecondary}>
              Open
            </Link>
          </li>
        </ul>
      </Card>

      <Card>
        <CardTitle>What we store</CardTitle>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>Your name, email and a salted scrypt hash of your password (never the password itself).</li>
          <li>The payments, goals, loans and investments you enter, linked to your account only.</li>
          <li>For each sign-in: the time, browser and IP address, to show you this list and limit login attempts.</li>
          <li>Market prices are fetched by our server; your holdings are never sent to price providers.</li>
        </ul>
        <div className="mt-3">
          <Note>
            See the <Link href="/privacy" className="underline">privacy policy</Link> for details.
          </Note>
        </div>
      </Card>

      <Card className="border-overdue/40">
        <CardTitle>Delete account</CardTitle>
        <DeleteAccountForm email={user.email} />
      </Card>
    </div>
  );
}
