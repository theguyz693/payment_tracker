import { SettingsForm } from "@/components/SettingsForm";
import { Card, CardTitle, Note, PageHeader, Tabs } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { formatINR, paiseToInput } from "@/lib/money";
import { loadFinancialPicture } from "@/server/loaders";
import { getTimeZone, getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const today = await getToday();
  const [fp, tz] = await Promise.all([loadFinancialPicture(user.id, today), getTimeZone()]);
  const { settings, cash } = fp;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Tabs
        active="general"
        tabs={[
          { key: "general", label: "General", href: "/settings" },
          { key: "security", label: "Privacy & security", href: "/settings/security" },
        ]}
      />
      <PageHeader title="Settings" description="Preferences that power forecasts and net worth." />

      <Card>
        <CardTitle hint="Used for the projected balance in the forecast and for net worth.">Starting cash balance</CardTitle>
        <SettingsForm
          cashBalance={settings.cashBalancePaise === null ? "" : paiseToInput(settings.cashBalancePaise)}
          cashAsOf={settings.cashAsOf ?? ""}
          today={today}
        />
        {cash && (
          <div className="mt-4 rounded-xl bg-canvas px-4 py-3 text-sm">
            <div className="text-ink-2">Estimated cash today</div>
            <div className="num text-xl font-bold">{formatINR(cash.paise)}</div>
            <div className="mt-1 text-xs text-ink-3">
              {formatINR(settings.cashBalancePaise ?? 0)} on {formatDate(cash.asOf, today)}, plus money received and minus payments and investments recorded since.
            </div>
          </div>
        )}
        <div className="mt-4">
          <Note>
            This is an estimate. It only knows about money you record here, so update it now and then from your bank balance. Money set aside for goals is still your cash; it isn&apos;t subtracted.
          </Note>
        </div>
      </Card>

      <Card>
        <CardTitle>Account</CardTitle>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-3">Name</dt>
            <dd className="font-medium">{user.name || "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Email</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Timezone (from your browser)</dt>
            <dd className="font-medium">{tz}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Currency</dt>
            <dd className="font-medium">Indian rupee (₹)</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
