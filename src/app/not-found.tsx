import Link from "next/link";
import { SearchIllustration } from "@/components/Illustrations";

export default function NotFound() {
  return (
    <div className="page-enter mx-auto flex max-w-sm flex-col items-center px-4 py-20 text-center">
      <SearchIllustration />
      <h1 className="mt-4 text-xl font-bold">This page could not be found</h1>
      <p className="mt-1 text-sm text-ink-2">The item may have been removed, or the link is wrong.</p>
      <Link
        href="/dashboard"
        className="press mt-6 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-on-ink hover:opacity-90"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
