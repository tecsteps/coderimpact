package com.acme.shop.service

import com.acme.shop.model.{Item, Order}
import com.acme.shop.repo.OrderRepository
import com.acme.shop.util.PriceFormatter

class OrderService(repo: OrderRepository) extends Service {
  override def run(): Unit = {
    val order = place("o-1", 1250)
    val total = order.total()
    val label = PriceFormatter.format(total)
    log(label)
    log(order.describe())
  }

  def place(key: String, cents: Long): Order = {
    val order = new Order(key)
    order.addItem(Item("sku-" + key, cents))
    repo.save(key, order)
    val fallback = Order.empty()
    if (order.total() > 0) order else fallback
  }

  private def log(message: String): Unit = {
    println(message)
  }
}
