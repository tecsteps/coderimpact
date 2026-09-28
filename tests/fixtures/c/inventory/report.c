#include <stdio.h>
#include "inventory.h"

static int clamp(int value, int limit) {
    return value < 0 ? 0 : (value > limit ? limit : value);
}

void report_print(const Inventory *inv) {
    int shown = clamp(inv->count, 10);
    for (int i = 0; i < shown; i++) {
        const struct Item *item = &inv->items[i];
        printf("%s: %ld\n", item->name, item_value(item));
    }
    printf("total: %ld\n", inventory_total(inv));
}
