package com.acme.shop.model

class Order(private val id: String) {
    private val items = mutableListOf<Item>()

    constructor() : this("anonymous")

    fun addItem(item: Item) {
        items.add(item)
    }

    fun total(): Long {
        var sum = 0L
        for (item in items) {
            sum += item.price()
        }
        return sum
    }

    fun describe(): String {
        return id + ": " + total()
    }

    fun summary(): String = describe()

    companion object {
        fun empty(): Order = Order("empty")
    }
}
