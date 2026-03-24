import InventoryClient from "@/components/dashboard/inventory/InventoryClient";
import StockOnHand from "@/components/dashboard/inventory/StockOnHand";
import InventoryPageTabs from "@/components/dashboard/inventory/InventoryPageTabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function InventoryPage() {
  return (
    <main className="min-h-screen bg-stone-50 dark:bg-stone-950 p-4 md:p-6 lg:p-8">
      <InventoryPageTabs
        stockOnHand={<StockOnHand />}
        inventoryClient={<InventoryClient />}
      />
    </main>
  );
}
