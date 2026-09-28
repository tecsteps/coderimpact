package com.acme.shop.model;

public class Item {
    private final String sku;
    private final long cents;

    public Item(String sku, long cents) {
        this.sku = sku;
        this.cents = cents;
    }

    public long price() {
        return cents;
    }

    public String describe() {
        return sku + " @ " + cents;
    }
}
