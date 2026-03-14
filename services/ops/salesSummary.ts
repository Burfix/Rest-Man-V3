/**
 * Sales summary service — latest weekly POS upload analytics.
 */

import { createServerClient } from "@/lib/supabase/server";
import { HistoricalSale, SalesItem, SalesUpload, SalesSummary } from "@/types";

export async function getLatestSalesSummary(topN = 5): Promise<SalesSummary> {
  const supabase = createServerClient();

  // Most recent upload — order by uploaded_at so a late-filed report
  // (covering an older week) doesn't shadow a more-recent upload.
  const { data: uploadData, error: uploadError } = await supabase
    .from("sales_uploads")
    .select("*")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (uploadError) {
    throw new Error(`[OpsSvc/Sales] ${uploadError.message}`);
  }

  if (!uploadData) {
    return { upload: null, topItems: [], bottomItems: [] };
  }

  const upload = uploadData as SalesUpload;

  // All items for this upload, ordered descending by qty
  const { data: itemsData, error: itemsError } = await supabase
    .from("sales_items")
    .select("*")
    .eq("upload_id", upload.id)
    .order("quantity_sold", { ascending: false });

  if (itemsError) {
    throw new Error(`[OpsSvc/Sales] ${itemsError.message}`);
  }

  const items = (itemsData ?? []) as SalesItem[];

  return {
    upload,
    topItems: items.slice(0, topN),
    bottomItems: [...items].reverse().slice(0, topN),
  };
}

/** All uploads — for the /dashboard/sales history page */
export async function getAllSalesUploads(): Promise<SalesUpload[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("sales_uploads")
    .select("*")
    .order("week_start", { ascending: false });

  if (error) {
    throw new Error(`[OpsSvc/Sales] ${error.message}`);
  }

  return (data ?? []) as SalesUpload[];
}

/** All items for a given upload */
export async function getSalesItemsByUpload(uploadId: string): Promise<SalesItem[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("sales_items")
    .select("*")
    .eq("upload_id", uploadId)
    .order("quantity_sold", { ascending: false });

  if (error) {
    throw new Error(`[OpsSvc/Sales] ${error.message}`);
  }

  return (data ?? []) as SalesItem[];
}

/** All historical daily sales — ordered newest first */
export async function getHistoricalSales(): Promise<HistoricalSale[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("historical_sales")
    .select("*")
    .order("sale_date", { ascending: false });

  if (error) {
    throw new Error(`[OpsSvc/HistoricalSales] ${error.message}`);
  }

  return (data ?? []) as HistoricalSale[];
}

/** Historical sales for a specific date range (inclusive), ordered oldest first */
export async function getHistoricalSalesForWeek(
  from: string,
  to: string
): Promise<HistoricalSale[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("historical_sales")
    .select("*")
    .gte("sale_date", from)
    .lte("sale_date", to)
    .order("sale_date", { ascending: true });

  if (error) {
    throw new Error(`[OpsSvc/HistoricalSales] ${error.message}`);
  }

  return (data ?? []) as HistoricalSale[];
}
