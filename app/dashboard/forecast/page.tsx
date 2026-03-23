import GMCoPilot from "@/components/dashboard/forecast/GMCoPilot";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

export default function ForecastPage() {
  return (
    <main className="min-h-screen bg-stone-50 dark:bg-stone-950 p-4 md:p-6 lg:p-8">
      <GMCoPilot />
    </main>
  );
}
