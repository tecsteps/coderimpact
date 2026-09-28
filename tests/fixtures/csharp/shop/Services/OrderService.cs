using System;
using Acme.Shop.Data;
using Acme.Shop.Models;
using Acme.Shop.Util;

namespace Acme.Shop.Services
{
    public class OrderService : IService
    {
        private readonly OrderRepository repo;

        public OrderService(OrderRepository repo)
        {
            this.repo = repo;
        }

        public void Run()
        {
            Order order = Place("o-1", 1250);
            string label = PriceFormatter.Format(order.Total());
            Log(label);
            Log(order.Describe());
        }

        public Order Place(string key, long cents)
        {
            var order = new Order(key);
            order.AddItem(new Item("sku-" + key, cents));
            repo.Save(key, order);
            Order fallback = Order.Empty();
            return order != null ? order : fallback;
        }

        private void Log(string message)
        {
            Console.WriteLine(message);
        }
    }
}
