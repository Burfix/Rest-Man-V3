/**
 * MICROS Inventory Management — Sync Service
 *
 * Connects to the Oracle MICROS POS Web Services SOAP API to sync:
 *   • Item list       → inventory_items
 *   • Stock on hand   → micros_stock_on_hand
 *   • Cost centers    → micros_cost_centers
 *   • Vendors         → micros_vendors
 *
 * Authentication: SOAP Header with User + Password (RNA credentials).
 * Base URL: {inv_app_server_url}/POSWebService/Service.svc
 *
 * Credentials are resolved from environment variables (MICROS_INV_USERNAME,
 * MICROS_INV_PASSWORD) — never stored as plaintext in the database.
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { XMLParser } from "fast-xml-parser";
import type {
  MicrosInvConnection,
  MicrosItemRaw,
  MicrosStockOnHandRaw,
  MicrosCostCenterRaw,
  MicrosVendorRaw,
  InventorySyncResult,
} from "@/types/micros-inventory";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── SOAP constants ──────────────────────────────────────────────────────────

const SOAP_ACTIONS: Record<string, string> = {
  GetItemList:         "http://www.micros.com/pos/webservices/GetItemList",
  GetStockOnHandList:  "http://www.micros.com/pos/webservices/GetStockOnHandList",
  GetCostCenterList:   "http://www.micros.com/pos/webservices/GetCostCenterList",
  GetVendorList:       "http://www.micros.com/pos/webservices/GetVendorList",
  GetOpenOrderList:    "http://www.micros.com/pos/webservices/GetOpenOrderList",
  SendTransactionList: "http://www.micros.com/pos/webservices/SendTransactionList",
};

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: true,
  isArray: (name) => {
    // Force these to always be arrays even when single element
    const arrayTags = ["Item", "StockOnHand", "CostCenter", "Vendor", "Order", "OrderItem"];
    return arrayTags.includes(name);
  },
});

const REQUEST_TIMEOUT_MS = 30_000;

// ── SOAP envelope builder ───────────────────────────────────────────────────

export function buildSoapEnvelope(
  method: string,
  bodyXml: string,
  username: string,
  password: string,
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:pos="http://www.micros.com/pos/webservices/">
  <soapenv:Header>
    <pos:AuthenticationHeader>
      <pos:User>${escapeXml(username)}</pos:User>
      <pos:Password>${escapeXml(password)}</pos:Password>
    </pos:AuthenticationHeader>
  </soapenv:Header>
  <soapenv:Body>
    <pos:${method}>
      ${bodyXml}
    </pos:${method}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Generic SOAP caller ─────────────────────────────────────────────────────

export async function callInventoryAPI(
  connection: MicrosInvConnection,
  method: string,
  bodyXml = "",
): Promise<any> {
  const baseUrl = connection.inv_app_server_url?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("inv_app_server_url is not configured");

  const username = resolveUsername(connection);
  const password = resolvePassword(connection);
  if (!username || !password) {
    throw new Error("Inventory API credentials not configured");
  }

  const soapAction = SOAP_ACTIONS[method];
  if (!soapAction) throw new Error(`Unknown SOAP method: ${method}`);

  const envelope = buildSoapEnvelope(method, bodyXml, username, password);
  const url = `${baseUrl}/POSWebService/Service.svc`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": soapAction,
      },
      body: envelope,
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      logger.error("[MicrosInv] SOAP HTTP error", {
        method,
        status: res.status,
        body: text.slice(0, 500),
      });
      throw new Error(`SOAP HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const parsed = XML_PARSER.parse(text);
    const body = findSoapBody(parsed);

    if (!body) {
      throw new Error("Could not locate SOAP Body in response");
    }

    // Navigate to the method result element
    const resultKey = `${method}Response`;
    const result = body[resultKey] ?? body[`${method}Result`] ?? body;

    // Check for SOAP-level Success flag
    const success = result?.Success ?? result?.success;
    if (success === false || success === "false") {
      const errorCode = result?.ErrorCode ?? result?.errorCode ?? "UNKNOWN";
      const message = result?.Message ?? result?.message ?? "Unknown SOAP error";
      throw new Error(`MICROS IM error [${errorCode}]: ${message}`);
    }

    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function findSoapBody(parsed: any): any {
  // Traverse envelope → body regardless of namespace prefix
  if (parsed?.Envelope?.Body) return parsed.Envelope.Body;
  for (const key of Object.keys(parsed ?? {})) {
    if (key.toLowerCase().includes("envelope")) {
      const envelope = parsed[key];
      for (const bk of Object.keys(envelope ?? {})) {
        if (bk.toLowerCase().includes("body")) return envelope[bk];
      }
    }
  }
  return null;
}

// ── Credential resolution ───────────────────────────────────────────────────

function resolveUsername(conn: MicrosInvConnection): string {
  return process.env.MICROS_INV_USERNAME ?? conn.inv_username ?? "";
}

function resolvePassword(conn: MicrosInvConnection): string {
  // Password is ALWAYS from env — never stored in DB
  return process.env.MICROS_INV_PASSWORD ?? "";
}

// ── Connection loader ───────────────────────────────────────────────────────

async function getConnection(connectionId: string): Promise<MicrosInvConnection> {
  const supabase = createServerClient();
  const { data, error } = await (supabase as any)
    .from("micros_connections")
    .select("id, site_id, inv_app_server_url, inv_username, inv_password_enc, inv_pos_sequence, inv_last_sync_at, inv_enabled")
    .eq("id", connectionId)
    .single();

  if (error || !data) {
    throw new Error(`Connection ${connectionId} not found: ${error?.message ?? "no data"}`);
  }
  return data as MicrosInvConnection;
}

// ── Sync: Item List ─────────────────────────────────────────────────────────

export async function syncItemList(connectionId: string): Promise<InventorySyncResult> {
  const conn = await getConnection(connectionId);
  if (!conn.inv_enabled) return { inserted: 0, updated: 0, errors: ["Inventory sync is disabled"] };

  const siteId = conn.site_id;
  if (!siteId) return { inserted: 0, updated: 0, errors: ["No site_id on connection"] };

  const supabase = createServerClient();
  const result: InventorySyncResult = { inserted: 0, updated: 0, errors: [] };

  try {
    const response = await callInventoryAPI(conn, "GetItemList");
    const items = extractArray<MicrosItemRaw>(response, "Item");

    logger.info("[MicrosInv] GetItemList returned", { count: items.length });

    for (const item of items) {
      try {
        const row = {
          store_id:           siteId,
          name:               String(item.Name ?? ""),
          micros_item_number: Number(item.Number),
          micros_item_id:     String(item.Number),
          micros_item_group:  item.ItemGroup ? String(item.ItemGroup) : null,
          micros_store_unit:  item.Unit ? String(item.Unit) : null,
          micros_sales_price: item.SalesPrice != null ? Number(item.SalesPrice) : null,
          unit:               item.Unit ? String(item.Unit) : "ea",
          sync_source:        "micros_inventory",
          last_synced_at:     new Date().toISOString(),
        };

        const { data: existing } = await (supabase as any)
          .from("inventory_items")
          .select("id")
          .eq("store_id", siteId)
          .eq("micros_item_number", row.micros_item_number)
          .maybeSingle();

        if (existing) {
          // Update — don't overwrite user-edited fields like category, current_stock
          const { error: ue } = await (supabase as any)
            .from("inventory_items")
            .update({
              name:               row.name,
              micros_item_group:  row.micros_item_group,
              micros_store_unit:  row.micros_store_unit,
              micros_sales_price: row.micros_sales_price,
              micros_item_id:     row.micros_item_id,
              sync_source:        row.sync_source,
              last_synced_at:     row.last_synced_at,
            })
            .eq("id", existing.id);

          if (ue) {
            result.errors.push(`Update item ${item.Number}: ${ue.message}`);
          } else {
            result.updated++;
          }
        } else {
          // Insert new item
          const { error: ie } = await (supabase as any)
            .from("inventory_items")
            .insert(row);

          if (ie) {
            result.errors.push(`Insert item ${item.Number}: ${ie.message}`);
          } else {
            result.inserted++;
          }
        }
      } catch (e: any) {
        result.errors.push(`Item ${item.Number}: ${e.message}`);
      }
    }

    // Update connection timestamp
    await (supabase as any)
      .from("micros_connections")
      .update({ inv_last_sync_at: new Date().toISOString() })
      .eq("id", connectionId);

  } catch (e: any) {
    logger.error("[MicrosInv] syncItemList failed", { connectionId, error: e.message });
    result.errors.push(e.message);
  }

  return result;
}

// ── Sync: Stock on Hand ─────────────────────────────────────────────────────

export async function syncStockOnHand(connectionId: string): Promise<InventorySyncResult> {
  const conn = await getConnection(connectionId);
  if (!conn.inv_enabled) return { inserted: 0, updated: 0, errors: ["Inventory sync is disabled"] };

  const siteId = conn.site_id;
  if (!siteId) return { inserted: 0, updated: 0, errors: ["No site_id on connection"] };

  const supabase = createServerClient();
  const result: InventorySyncResult = { inserted: 0, updated: 0, errors: [] };
  const today = new Date().toLocaleDateString("en-CA");

  try {
    // Fetch all items with a micros_item_number
    const { data: items } = await (supabase as any)
      .from("inventory_items")
      .select("micros_item_number")
      .eq("store_id", siteId)
      .not("micros_item_number", "is", null);

    const itemNumbers = ((items ?? []) as { micros_item_number: number }[])
      .map((i) => i.micros_item_number);

    if (itemNumbers.length === 0) {
      result.errors.push("No inventory items with micros_item_number — run item sync first");
      return result;
    }

    // Call GetStockOnHandList for each item
    for (const itemNum of itemNumbers) {
      try {
        const bodyXml = `<pos:item><pos:ItemID>${itemNum}</pos:ItemID></pos:item>`;
        const response = await callInventoryAPI(conn, "GetStockOnHandList", bodyXml);
        const sohList = extractArray<MicrosStockOnHandRaw>(response, "StockOnHand");

        for (const soh of sohList) {
          const row = {
            site_id:             siteId,
            connection_id:       connectionId,
            item_number:         Number(soh.ItemNumber ?? itemNum),
            item_name:           soh.Item ? String(soh.Item) : null,
            cost_center_name:    soh.CostCenter ? String(soh.CostCenter) : null,
            cost_center_number:  0,   // Default; parse from CostCenter if structured
            qty_amount:          soh.Qty?.Amount != null ? Number(soh.Qty.Amount) : null,
            qty_unit:            soh.Qty?.Unit ? String(soh.Qty.Unit) : null,
            synced_at:           new Date().toISOString(),
            business_date:       today,
          };

          const { error: ue } = await (supabase as any)
            .from("micros_stock_on_hand")
            .upsert(row, {
              onConflict: "connection_id,item_number,cost_center_number,business_date",
            });

          if (ue) {
            result.errors.push(`SOH item ${itemNum}: ${ue.message}`);
          } else {
            result.updated++;
          }
        }

        if (sohList.length === 0) {
          // No stock data for this item — still counts as processed
          result.updated++;
        }
      } catch (e: any) {
        result.errors.push(`SOH item ${itemNum}: ${e.message}`);
      }
    }
  } catch (e: any) {
    logger.error("[MicrosInv] syncStockOnHand failed", { connectionId, error: e.message });
    result.errors.push(e.message);
  }

  return result;
}

// ── Sync: Cost Centers ──────────────────────────────────────────────────────

export async function syncCostCenters(connectionId: string): Promise<InventorySyncResult> {
  const conn = await getConnection(connectionId);
  if (!conn.inv_enabled) return { inserted: 0, updated: 0, errors: ["Inventory sync is disabled"] };

  const supabase = createServerClient();
  const result: InventorySyncResult = { inserted: 0, updated: 0, errors: [] };

  try {
    const response = await callInventoryAPI(conn, "GetCostCenterList");
    const centers = extractArray<MicrosCostCenterRaw>(response, "CostCenter");

    logger.info("[MicrosInv] GetCostCenterList returned", { count: centers.length });

    for (const cc of centers) {
      try {
        const row = {
          connection_id: connectionId,
          name:          String(cc.Name ?? ""),
          number:        Number(cc.Number),
          location_id:   cc.LocationID != null ? Number(cc.LocationID) : null,
          synced_at:     new Date().toISOString(),
        };

        const { error: ue } = await (supabase as any)
          .from("micros_cost_centers")
          .upsert(row, { onConflict: "connection_id,number" });

        if (ue) {
          result.errors.push(`Cost center ${cc.Number}: ${ue.message}`);
        } else {
          result.updated++;
        }
      } catch (e: any) {
        result.errors.push(`Cost center ${cc.Number}: ${e.message}`);
      }
    }
  } catch (e: any) {
    logger.error("[MicrosInv] syncCostCenters failed", { connectionId, error: e.message });
    result.errors.push(e.message);
  }

  return result;
}

// ── Sync: Vendors ───────────────────────────────────────────────────────────

export async function syncVendors(connectionId: string): Promise<InventorySyncResult> {
  const conn = await getConnection(connectionId);
  if (!conn.inv_enabled) return { inserted: 0, updated: 0, errors: ["Inventory sync is disabled"] };

  const supabase = createServerClient();
  const result: InventorySyncResult = { inserted: 0, updated: 0, errors: [] };

  try {
    const response = await callInventoryAPI(conn, "GetVendorList");
    const vendors = extractArray<MicrosVendorRaw>(response, "Vendor");

    logger.info("[MicrosInv] GetVendorList returned", { count: vendors.length });

    for (const v of vendors) {
      try {
        const row = {
          connection_id:               connectionId,
          name:                        String(v.Name ?? ""),
          number:                      Number(v.Number),
          address:                     v.Address ? String(v.Address) : null,
          email:                       v.Email ? String(v.Email) : null,
          phone:                       v.Phone ? String(v.Phone) : null,
          tax_id:                      v.TaxID ? String(v.TaxID) : null,
          external_invoice_processing: v.ExternalInvoiceProcessing === true,
          synced_at:                   new Date().toISOString(),
        };

        const { error: ue } = await (supabase as any)
          .from("micros_vendors")
          .upsert(row, { onConflict: "connection_id,number" });

        if (ue) {
          result.errors.push(`Vendor ${v.Number}: ${ue.message}`);
        } else {
          result.updated++;
        }
      } catch (e: any) {
        result.errors.push(`Vendor ${v.Number}: ${e.message}`);
      }
    }
  } catch (e: any) {
    logger.error("[MicrosInv] syncVendors failed", { connectionId, error: e.message });
    result.errors.push(e.message);
  }

  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Safely extract an array from a parsed SOAP response.
 * fast-xml-parser may return a single object instead of an array for 1-element
 * results, so we normalise here.
 */
function extractArray<T>(response: any, tag: string): T[] {
  if (!response) return [];

  // Walk common result paths
  const data =
    response?.Data?.[tag] ??
    response?.data?.[tag] ??
    response?.[`${tag}List`] ??
    response?.[tag] ??
    response?.Data ??
    response?.data ??
    [];

  if (Array.isArray(data)) return data as T[];
  if (typeof data === "object" && data !== null) return [data] as T[];
  return [];
}
