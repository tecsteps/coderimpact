#ifndef INVENTORY_H
#define INVENTORY_H

#include "util.h"

struct Item {
    const char *name;
    long price;
    int quantity;
};

typedef struct Inventory {
    struct Item items[MAX_ITEMS];
    int count;
} Inventory;

void inventory_init(Inventory *inv);
int inventory_add(Inventory *inv, const char *name, double price, int quantity);
long inventory_total(const Inventory *inv);
long item_value(const struct Item *item);

#endif
