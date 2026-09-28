package com.acme.shop.model

data class Item(val sku: String, val cents: Long) {
    fun price(): Long = cents

    fun describe(): String {
        return "$sku @ $cents"
    }
}
