#include "inventory.h"

static int added_count = 0;

static int clamp(int value, int limit) {
    return value > limit ? limit : value;
}

static int find_slot(const Inventory *inv, const char *name) {
    for (int i = 0; i < inv->count; i++) {
        if (inv->items[i].name == name) {
            return i;
        }
    }
    return -1;
}

void inventory_init(Inventory *inv) {
    inv->count = 0;
}

int inventory_add(Inventory *inv, const char *name, double price, int quantity) {
    int slot = find_slot(inv, name);
    if (slot < 0) {
        slot = inv->count;
        inv->count = clamp(inv->count + 1, MAX_ITEMS);
    }
    struct Item *item = &inv->items[slot];
    item->name = name;
    item->price = round_cents(price);
    item->quantity = MIN(quantity, 999);
    added_count++;
    return slot;
}

long item_value(const struct Item *item) {
    return item->price * item->quantity;
}

long inventory_total(const Inventory *inv) {
    long total = 0;
    for (int i = 0; i < inv->count; i++) {
        total += item_value(&inv->items[i]);
    }
    return total;
}
