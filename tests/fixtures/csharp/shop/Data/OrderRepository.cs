using System.Collections.Generic;
using Acme.Shop.Models;

namespace Acme.Shop.Data;

public class OrderRepository
{
    private readonly Dictionary<string, Order> store = new();

    public void Save(string key, Order order)
    {
        store[key] = order;
    }

    public Order Find(string key)
    {
        return store[key];
    }
}
