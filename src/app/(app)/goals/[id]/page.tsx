import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { GoalEntryForm } from "@/components/GoalForms";
import { Card, CardTitle, Metric, Note, PageHeader, Pill, ProgressBar, btnSecondary } from "@/components/ui";
import { Pencil, Trash } from "@/components/icons";
import { formatDate } from "@/lib/dates";
import { GOAL_STATUS_LABEL, viewGoal } from "@/lib/goals";
import { formatINR } from "@/lib/money";
import { FREQUENCY_LABEL } from "@/lib/types";
import { archiveGoalAction } from "@/server/finance-actions";
import { getGoal } from "@/server/finance-repo";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Goal" };

const statusTone = { COMPLETED: "gain", ON_TRACK: "save", BEHIND: "pending", OVERDUE: "overdue", NO_DEADLINE: "neutral" } as const;

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [goal, today] = await Promise.all([getGoal(user.id, id), getToday()]);
  if (!goal) notFound();
  const g = viewGoal(goal, today);

  const archive = async () => {
    "use server";
    return archiveGoalAction(id, !goal.archived);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link href="/goals" className="text-xs font-semibold text-ink-3 hover:text-ink">
            ← Savings goals
          </Link>
        }
        title={g.name}
        description={g.description ?? `${g.category} · ${g.priority[0] + g.priority.slice(1).toLowerCase()} priority`}
        actions={
          <>
            <Pill tone={statusTone[g.status]}>{GOAL_STATUS_LABEL[g.status]}</Pill>
            <Link href={`/goals/${g.id}/edit`} className={btnSecondary}>
              <Pencil width={14} height={14} /> Edit
            </Link>
            <ActionButton
              run={archive}
              redirectTo={goal.archived ? undefined : "/goals"}
              successMessage={goal.archived ? "Goal restored." : "Goal archived. Its history is kept."}
              confirm={goal.archived ? undefined : { title: `Archive ${g.name}?`, body: "It disappears from your goals and forecasts. Its contribution history is kept.", label: "Archive" }}
              className={btnSecondary}
            >
              <Trash width={14} height={14} /> {goal.archived ? "Restore" : "Archive"}
            </ActionButton>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm text-ink-2">Saved so far</div>
            <div className="num text-4xl font-extrabold tracking-tight text-save">{formatINR(g.savedPaise)}</div>
          </div>
          <div className="text-right text-sm text-ink-2">
            Target <span className="num font-semibold text-ink">{formatINR(g.targetPaise)}</span>
            {g.targetDate && <> by {formatDate(g.targetDate, today)}</>}
          </div>
        </div>
        <div className="mt-4">
          <ProgressBar value={g.progress} tone={g.status === "COMPLETED" ? "gain" : g.status === "BEHIND" || g.status === "OVERDUE" ? "pending" : "save"} label="Goal progress" />
          <div className="mt-1 text-right text-xs text-ink-3">{Math.round(g.progress * 100)}%</div>
        </div>
      </Card>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric index={0} label="Remaining" value={formatINR(g.remainingPaise)} />
        <Metric
          index={1}
          label="Needed per month"
          value={g.requiredMonthlyPaise === null ? "—" : formatINR(g.requiredMonthlyPaise)}
          sub={g.targetDate ? (g.daysLeft !== null && g.daysLeft >= 0 ? `${g.daysLeft} days left` : "Target date has passed") : "No target date"}
          info="Remaining amount divided by the whole months left until the target date, rounded up."
        />
        <Metric
          index={2}
          label="Contribution plan"
          value={g.plan ? formatINR(g.plan.amountPaise) : "—"}
          sub={g.plan ? `${FREQUENCY_LABEL[g.plan.frequency]}${g.nextContribution ? ` · next ${formatDate(g.nextContribution, today)}` : ""}` : "No plan set"}
          tone="save"
        />
        <Metric
          index={3}
          label="Projected completion"
          value={g.projectedDate ? formatDate(g.projectedDate, today) : "—"}
          sub={g.plan ? "If the plan continues, no interest" : "Add a plan to project"}
          tone={g.status === "BEHIND" ? "pending" : "neutral"}
          info="When the remaining amount is covered by planned contributions from today. Assumes no interest or returns."
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px] [&>*]:min-w-0">
        <Card>
          <CardTitle hint="Every contribution and withdrawal. The balance is always the sum of these.">History</CardTitle>
          {g.entries.length === 0 ? (
            <p className="text-sm text-ink-3">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {g.entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{e.type === "CONTRIBUTION" ? "Contribution" : "Withdrawal"}</div>
                    <div className="truncate text-xs text-ink-3">
                      {formatDate(e.date, today)}
                      {e.note && ` · ${e.note}`}
                    </div>
                  </div>
                  <span className={`num font-semibold ${e.type === "CONTRIBUTION" ? "text-save" : "text-ink-2"}`}>
                    {e.type === "CONTRIBUTION" ? "+" : "−"}
                    {formatINR(e.amountPaise)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Record money</CardTitle>
          {goal.archived ? <p className="text-sm text-ink-3">Restore this goal to record money.</p> : <GoalEntryForm goalId={g.id} today={today} savedPaise={g.savedPaise} />}
          <div className="mt-4">
            <Note>Goal money is set aside from your own cash: it isn&apos;t counted as spending or income.</Note>
          </div>
        </Card>
      </div>
    </div>
  );
}
