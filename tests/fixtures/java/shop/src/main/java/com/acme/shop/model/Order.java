package com.acme.shop.model;

import java.util.ArrayList;
import java.util.List;

public class Order {
    private final String id;
    private final List<Item> items = new ArrayList<>();

    public Order(String id) {
        this.id = id;
    }

    public static Order empty() {
        return new Order("empty");
    }

    public void addItem(Item item) {
        items.add(item);
    }

    public long total() {
        long sum = 0;
        for (Item item : items) {
            sum += item.price();
        }
        return sum;
    }

    public String describe() {
        return id + ": " + total();
    }

    public String summary() {
        return describe();
    }
}
