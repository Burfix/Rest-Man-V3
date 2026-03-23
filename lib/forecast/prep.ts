/**
 * lib/forecast/prep.ts — Prep guidance generator
 *
 * Generates practical kitchen prep recommendations based on
 * forecast covers, events, and venue patterns.
 */

import type { ForecastInput, PrepGuidanceItem, DemandSnapshot } from "@/types/forecast";

/**
 * Standard prep items for a full-service restaurant.
 * Quantities scale with covers. Categories drive prep priority.
 */
const BASE_PREP_ITEMS: Array<{
  itemName: string;
  itemCategory: string;
  unit: string;
  perCoverQty: number;         // base unit per cover
  eventUplift?: string[];      // event names that boost this item
  eventMultiplier?: number;    // multiplier when event active
}> = [
  { itemName: "Pizza Dough Balls",    itemCategory: "Bakery",      unit: "portions",  perCoverQty: 0.4,  eventUplift: ["Quiz Night"], eventMultiplier: 1.3 },
  { itemName: "Mozzarella",           itemCategory: "Dairy",       unit: "kg",        perCoverQty: 0.05, eventUplift: ["Quiz Night"], eventMultiplier: 1.3 },
  { itemName: "Pasta Portions",       itemCategory: "Mains",       unit: "portions",  perCoverQty: 0.3 },
  { itemName: "Salad Mix",            itemCategory: "Cold Kitchen", unit: "kg",       perCoverQty: 0.08 },
  { itemName: "Soup of the Day",      itemCategory: "Starters",    unit: "litres",    perCoverQty: 0.15 },
  { itemName: "Dessert Portions",     itemCategory: "Pastry",      unit: "portions",  perCoverQty: 0.25 },
  { itemName: "Bread Rolls",          itemCategory: "Bakery",      unit: "pieces",    perCoverQty: 1.2 },
  { itemName: "Steak Cuts",           itemCategory: "Grill",       unit: "portions",  perCoverQty: 0.2 },
  { itemName: "Seafood Portions",     itemCategory: "Grill",       unit: "portions",  perCoverQty: 0.15 },
  { itemName: "Cocktail Garnishes",   itemCategory: "Bar",         unit: "sets",      perCoverQty: 0.3, eventUplift: ["Salsa Night", "Sip & Paint"], eventMultiplier: 1.4 },
];

export function generatePrepGuidance(
  input: ForecastInput,
  demand: DemandSnapshot,
): PrepGuidanceItem[] {
  const covers = demand.totalForecastCovers;
  if (covers <= 0) return [];

  const items: PrepGuidanceItem[] = [];

  for (const base of BASE_PREP_ITEMS) {
    let qty = Math.ceil(covers * base.perCoverQty);

    // Apply event uplift
    let hasEventUplift = false;
    if (input.eventName && base.eventUplift?.includes(input.eventName) && base.eventMultiplier) {
      qty = Math.ceil(qty * base.eventMultiplier);
      hasEventUplift = true;
    }

    // Determine risk level
    let riskLevel: PrepGuidanceItem["riskLevel"] = "low";
    if (covers > 100 || hasEventUplift) riskLevel = "medium";
    if (covers > 140 && hasEventUplift) riskLevel = "high";

    // Build note
    let note = `Based on ${covers} forecast covers`;
    if (hasEventUplift) {
      note += ` with ${input.eventName} uplift (+${Math.round(((base.eventMultiplier ?? 1) - 1) * 100)}%)`;
    }
    if (riskLevel === "high") {
      note += ". Complete by 3pm to avoid mid-service shortages.";
    } else if (riskLevel === "medium") {
      note += ". Have backup stock accessible.";
    }

    items.push({
      itemName: base.itemName,
      itemCategory: base.itemCategory,
      estimatedQuantity: qty,
      unit: base.unit,
      riskLevel,
      note,
    });
  }

  // Sort: high risk first, then medium, then low
  const riskOrder = { high: 0, medium: 1, low: 2 };
  return items.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]);
}
