package com.acme.shop.repo

import com.acme.shop.model.Order

class OrderRepository {
    private val store = HashMap<String, Order>()

    fun save(key: String, order: Order) {
        store[key] = order
    }

    fun find(key: String): Order? = store[key]
}
