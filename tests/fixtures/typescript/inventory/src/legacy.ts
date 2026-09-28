import type { Item } from "./types";

export function formatLine(item: Item): string {
  return [item.sku, item.qty].join(" x ");
}
