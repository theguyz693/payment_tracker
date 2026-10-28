import { PageSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return <PageSkeleton stats={0} cards={2} />;
}
