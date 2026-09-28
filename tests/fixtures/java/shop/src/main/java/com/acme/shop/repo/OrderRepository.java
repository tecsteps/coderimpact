package com.acme.shop.repo;

import com.acme.shop.model.Order;
import java.util.HashMap;
import java.util.Map;

public class OrderRepository {
    private final Map<String, Order> store = new HashMap<>();

    public void save(String key, Order order) {
        store.put(key, order);
    }

    public Order find(String key) {
        return store.get(key);
    }
}
