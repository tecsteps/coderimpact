package com.acme.shop.model

import scala.collection.mutable.ListBuffer

class Order(val id: String) {
  private val items = ListBuffer[Item]()

  def this() = this("anonymous")

  def addItem(item: Item): Unit = {
    items += item
  }

  def total(): Long = {
    var sum = 0L
    for (item <- items) {
      sum += item.price()
    }
    sum
  }

  def describe(): String = {
    id + ": " + total()
  }

  def summary(): String = describe()
}

object Order {
  def empty(): Order = new Order("empty")
}
