package com.acme.shop.repo

import com.acme.shop.model.Order
import scala.collection.mutable

class OrderRepository {
  private val store = mutable.Map[String, Order]()

  def save(key: String, order: Order): Unit = {
    store(key) = order
  }

  def find(key: String): Option[Order] = store.get(key)
}
