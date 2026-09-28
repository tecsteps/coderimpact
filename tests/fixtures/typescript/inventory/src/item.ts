import { Item, Sku, Status } from "./types";

export function createItem(sku: Sku, qty = 0): Item {
  const status = qty > 0 ? Status.Active : Status.Archived;
  return { sku, qty, status };
}

export const restock = (item: Item, amount: number): Item => {
  const qty = item.qty + amount;
  return createItem(item.sku, qty);
};
