package com.acme.shop.util;

public final class PriceFormatter {
    private PriceFormatter() {}

    public static String format(long cents) {
        long euros = cents / 100;
        return euros + "." + (cents % 100);
    }
}
