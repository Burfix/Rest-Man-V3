import type { SupabaseClient } from "@supabase/supabase-js";

/** Fetch the most recent MICROS net-sales figure. */
export async function getLatestRevenueFigure(
  supabase: SupabaseClient
): Promise<{ sales: number | null; date: string | null }> {
  const { data } = await supabase
    .from("micros_sales_daily")
    .select("business_date, net_sales")
    .order("business_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { sales: data?.net_sales ?? null, date: data?.business_date ?? null };
}
