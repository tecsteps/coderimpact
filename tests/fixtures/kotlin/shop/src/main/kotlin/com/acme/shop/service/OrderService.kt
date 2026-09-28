package com.acme.shop.service

import com.acme.shop.model.Item
import com.acme.shop.model.Order
import com.acme.shop.repo.OrderRepository
import com.acme.shop.util.PriceFormatter
import com.acme.shop.util.format
import com.acme.shop.util.formatAll

class OrderService(private val repo: OrderRepository) : Service {
    override fun run() {
        val order = place("o-1", 1250)
        val label = PriceFormatter.format(order.total())
        log(label)
        log(order.describe())
        formatAll(listOf(order.total()))
    }

    fun place(key: String, cents: Long): Order {
        val order = Order(key)
        order.addItem(Item("sku-$key", cents))
        repo.save(key, order)
        val fallback = Order.empty()
        return if (order.total() > 0) order else fallback
    }

    private fun log(message: String) {
        println(format(message))
    }
}
