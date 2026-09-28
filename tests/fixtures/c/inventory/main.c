#include "inventory.h"

void report_print(const Inventory *inv);

int main(void) {
    Inventory inv;
    inventory_init(&inv);
    inventory_add(&inv, "apple", 0.5, 12);
    inventory_add(&inv, "pear", 0.75, 4);
    Inventory *ptr = &inv;
    report_print(ptr);
    return inventory_total(ptr) > 0 ? 0 : 1;
}
