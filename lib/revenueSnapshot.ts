import type { SupabaseClient } from "@supabase/supabase-js";

/** Fetch the most recent daily ops revenue figure (sales_net_vat). */
export async function getLatestRevenueFigure(
  supabase: SupabaseClient
): Promise<{ sales: number | null; date: string | null }> {
  const { data } = await supabase
    .from("daily_operations_reports")
    .select("report_date, sales_net_vat")
    .order("report_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { sales: data?.sales_net_vat ?? null, date: data?.report_date ?? null };
}
