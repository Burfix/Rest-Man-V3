import InventoryClient from "@/components/dashboard/inventory/InventoryClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function InventoryPage() {
  return (
    <main className="min-h-screen bg-stone-50 dark:bg-stone-950 p-4 md:p-6 lg:p-8">
      <InventoryClient />
    </main>
  );
}
