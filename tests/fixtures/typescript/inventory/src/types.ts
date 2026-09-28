export type Sku = string;

export enum Status {
  Active = "active",
  Archived = "archived",
}

export interface Item {
  sku: Sku;
  qty: number;
  status: Status;
}

export interface Repository<T> {
  find(id: string): T | undefined;
  save(item: T): void;
}
