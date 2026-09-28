namespace Acme.Shop.Util;

public static class PriceFormatter
{
    public static string Format(long cents)
    {
        var euros = cents / 100;
        return $"{euros}.{cents % 100}";
    }
}
