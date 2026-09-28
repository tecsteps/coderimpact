import { MemoryStore } from "./store";
import { createItem } from "./item";
import { count, formatLine } from "./report";

function run(): void {
  const store = new MemoryStore("main");
  store.save(createItem("A-1", 3));
  const found = store.refill("A-1", 2);
  if (found) {
    console.log(formatLine(found));
    console.log(store.count(), count([found]));
  }
  console.log(store.describe());
}

run();
