import { GoalForm } from "@/components/GoalForms";
import { PageHeader } from "@/components/ui";
import { getToday, requireUser } from "@/server/session";

export const metadata = { title: "New goal" };

export default async function NewGoalPage() {
  await requireUser();
  const today = await getToday();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="New savings goal" description="What are you saving for, how much, and by when?" />
      <GoalForm today={today} />
    </div>
  );
}
