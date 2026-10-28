import { notFound } from "next/navigation";
import { GoalForm } from "@/components/GoalForms";
import { PageHeader } from "@/components/ui";
import { getGoal } from "@/server/finance-repo";
import { getToday, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit goal" };

export default async function EditGoalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [goal, today] = await Promise.all([getGoal(user.id, id), getToday()]);
  if (!goal) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={`Edit ${goal.name}`} description="Changing the target or plan never changes the contributions you've recorded." />
      <GoalForm initial={goal} today={today} />
    </div>
  );
}
