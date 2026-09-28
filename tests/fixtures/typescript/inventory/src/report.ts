import type { Item } from "./types";

export const formatLine = (item: Item): string => `${item.sku}: ${item.qty}`;

export function count(items: Item[]): number {
  let total = 0;
  for (const item of items) {
    total += item.qty;
  }
  return total;
}
