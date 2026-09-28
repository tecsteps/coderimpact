import { Item, Repository, Sku } from "./types";
import { restock } from "./item";

export abstract class BaseStore {
  abstract describe(): string;
}

export class MemoryStore extends BaseStore implements Repository<Item> {
  private items = new Map<Sku, Item>();

  constructor(private readonly name: string) {
    super();
  }

  find(id: string): Item | undefined {
    return this.items.get(id);
  }

  save(item: Item): void {
    this.items.set(item.sku, item);
  }

  refill(sku: Sku, amount: number): Item | undefined {
    const current = this.find(sku);
    if (!current) return undefined;
    const next = restock(current, amount);
    this.save(next);
    return next;
  }

  count = (): number => this.items.size;

  describe(): string {
    return `${this.name} (${this.count()} items)`;
  }
}
