using System.Collections.Generic;

namespace Acme.Shop.Models;

public class Order
{
    private readonly string id;
    private readonly List<Item> items = new List<Item>();

    public Order(string id)
    {
        this.id = id;
    }

    public static Order Empty()
    {
        return new Order("empty");
    }

    public void AddItem(Item item)
    {
        items.Add(item);
    }

    public long Total()
    {
        long sum = 0;
        foreach (var item in items)
        {
            sum += item.Price();
        }
        return sum;
    }

    public string Describe()
    {
        return id + ": " + Total();
    }

    public string Summary()
    {
        return Describe();
    }
}
