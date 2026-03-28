import Link from "next/link";

export const metadata = {
  title: "Access Restricted — Ops Engine",
};

export default function AccessRestrictedPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-stone-100 dark:bg-stone-800">
        <span className="text-3xl">🔒</span>
      </div>
      <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100 mb-2">
        Access Restricted
      </h1>
      <p className="text-stone-500 dark:text-stone-400 max-w-md mb-8">
        This section is managed by Head Office. If you need access,
        please contact your area manager or administrator.
      </p>
      <Link
        href="/dashboard"
        className="rounded-xl bg-stone-900 dark:bg-stone-100 px-6 py-2.5 text-sm font-medium text-white dark:text-stone-900 transition hover:bg-stone-800 dark:hover:bg-stone-200"
      >
        Back to Command Centre
      </Link>
    </div>
  );
}
