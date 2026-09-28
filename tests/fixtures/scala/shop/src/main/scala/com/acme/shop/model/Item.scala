package com.acme.shop.model

case class Item(sku: String, cents: Long) {
  def price(): Long = cents

  def describe(): String = {
    s"$sku @ $cents"
  }
}
