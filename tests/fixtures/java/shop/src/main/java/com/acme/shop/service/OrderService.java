package com.acme.shop.service;

import com.acme.shop.model.Item;
import com.acme.shop.model.Order;
import com.acme.shop.repo.OrderRepository;
import com.acme.shop.util.PriceFormatter;

public class OrderService implements Service {
    private final OrderRepository repo;

    public OrderService(OrderRepository repo) {
        this.repo = repo;
    }

    @Override
    public void run() {
        Order order = place("o-1", 1250);
        String label = PriceFormatter.format(order.total());
        log(label);
        log(order.describe());
    }

    public Order place(String key, long cents) {
        Order order = new Order(key);
        order.addItem(new Item("sku-" + key, cents));
        repo.save(key, order);
        Order fallback = Order.empty();
        return order != null ? order : fallback;
    }

    private void log(String message) {
        System.out.println(message);
    }
}
