import Link from "next/link";
import { ProjectionCalculator } from "@/components/GoalForms";
import { Card, CardTitle, EmptyBlock, Metric, Note, PageHeader, Pill, ProgressBar, btnPrimary } from "@/components/ui";
import { Plus, Target } from "@/components/icons";
import { formatDate } from "@/lib/dates";
import { GOAL_STATUS_LABEL, type GoalView } from "@/lib/goals";
import { formatINR } from "@/lib/money";
import { loadFinancialPicture } from "@/server/loaders";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Savings Goals" };

const statusTone = { COMPLETED: "gain", ON_TRACK: "save", BEHIND: "pending", OVERDUE: "overdue", NO_DEADLINE: "neutral" } as const;
const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

export default async function GoalsPage() {
  const user = await requireUser();
  const today = await getToday();
  const { goals, cash } = await loadFinancialPicture(user.id, today);
  const active = goals.filter((g) => g.status !== "COMPLETED").sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || (a.targetDate ?? "9").localeCompare(b.targetDate ?? "9"));
  const done = goals.filter((g) => g.status === "COMPLETED");
  const saved = goals.reduce((a, g) => a + g.savedPaise, 0);
  const target = goals.reduce((a, g) => a + g.targetPaise, 0);
  const monthlyNeeded = active.reduce((a, g) => a + (g.requiredMonthlyPaise ?? 0), 0);
  const behind = active.filter((g) => g.status === "BEHIND" || g.status === "OVERDUE").length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Savings Goals"
        description="Money you're setting aside for things ahead. Balances come from the contributions and withdrawals you record."
        actions={
          <Link href="/goals/new" className={btnPrimary}>
            <Plus width={15} height={15} /> New goal
          </Link>
        }
      />

      {goals.length > 0 && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric index={0} label="Set aside" value={formatINR(saved)} tone="save" sub={`of ${formatINR(target)} targeted`} />
          <Metric index={1} label="Still to save" value={formatINR(Math.max(0, target - saved))} sub={`${active.length} active goal${active.length === 1 ? "" : "s"}`} />
          <Metric
            index={2}
            label="Needed per month"
            value={formatINR(monthlyNeeded)}
            sub="to hit every dated goal on time"
            info="The sum of each goal's required monthly saving (remaining amount ÷ months left). Goals without a target date aren't included."
          />
          <Metric index={3} label="Behind schedule" value={String(behind)} tone={behind ? "pending" : "neutral"} sub={behind ? "goals need attention" : "everything on track"} />
        </section>
      )}

      {cash && saved > cash.paise && (
        <Note tone="warn">
          You&apos;ve earmarked {formatINR(saved)} for goals but your estimated cash is {formatINR(cash.paise)}. The same rupees can&apos;t fund both. Check your cash balance in Settings or record a withdrawal.
        </Note>
      )}

      {goals.length === 0 ? (
        <EmptyBlock
          icon={<Target width={20} height={20} />}
          title="No goals yet"
          hint="Create a goal for a laptop, semester fees, an insurance premium or an emergency fund, and see how much to save each month."
          action={
            <Link href="/goals/new" className={btnPrimary}>
              <Plus width={15} height={15} /> Create your first goal
            </Link>
          }
        />
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...active, ...done].map((g, i) => (
            <GoalCard key={g.id} g={g} today={today} index={i} />
          ))}
        </section>
      )}

      <Card>
        <CardTitle hint="A quick what-if. It doesn't create or change any goal.">Savings calculator</CardTitle>
        <ProjectionCalculator today={today} />
      </Card>
    </div>
  );
}

function GoalCard({ g, today, index }: { g: GoalView; today: string; index: number }) {
  return (
    <Link
      href={`/goals/${g.id}`}
      className="rise group block rounded-2xl border border-line bg-surface p-4 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_6px_20px_-12px_rgb(20_28_43/0.35)]"
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold group-hover:underline">{g.name}</div>
          <div className="text-xs text-ink-3">
            {g.category} · {g.priority[0] + g.priority.slice(1).toLowerCase()} priority
          </div>
        </div>
        <Pill tone={statusTone[g.status]}>{GOAL_STATUS_LABEL[g.status]}</Pill>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <div className="num text-xl font-bold">{formatINR(g.savedPaise)}</div>
        <div className="num text-sm text-ink-3">of {formatINR(g.targetPaise)}</div>
      </div>
      <div className="mt-2">
        <ProgressBar value={g.progress} tone={g.status === "COMPLETED" ? "gain" : g.status === "BEHIND" || g.status === "OVERDUE" ? "pending" : "save"} label={`${g.name} progress`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-2">
        <div>
          {g.targetDate ? (
            <>
              <span className="text-ink-3">By </span>
              {formatDate(g.targetDate, today)}
            </>
          ) : (
            <span className="text-ink-3">No target date</span>
          )}
        </div>
        <div className="text-right">
          {g.status === "COMPLETED" ? (
            "Target reached 🎉"
          ) : g.requiredMonthlyPaise ? (
            <>
              <span className="num font-semibold">{formatINR(g.requiredMonthlyPaise)}</span>
              <span className="text-ink-3">/mo needed</span>
            </>
          ) : g.projectedDate ? (
            <>
              <span className="text-ink-3">Done by </span>
              {formatDate(g.projectedDate, today)}
            </>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
