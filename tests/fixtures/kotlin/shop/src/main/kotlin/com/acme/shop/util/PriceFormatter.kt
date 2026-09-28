package com.acme.shop.util

object PriceFormatter {
    const val CURRENCY = "EUR"

    fun format(cents: Long): String {
        val euros = cents / 100
        return "$euros.${cents % 100} $CURRENCY"
    }
}

fun formatAll(values: List<Long>): List<String> = values.map { v -> PriceFormatter.format(v) }
