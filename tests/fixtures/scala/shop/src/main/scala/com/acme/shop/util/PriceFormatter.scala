package com.acme.shop.util

object PriceFormatter {
  val Currency = "EUR"

  def format(cents: Long): String = {
    val euros = cents / 100
    s"$euros.${cents % 100} $Currency"
  }

  def formatAll(values: Seq[Long]): Seq[String] = values.map(v => format(v))
}
