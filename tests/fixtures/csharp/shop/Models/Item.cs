namespace Acme.Shop.Models
{
    public class Item
    {
        private readonly string sku;

        public Item(string sku, long cents)
        {
            this.sku = sku;
            Cents = cents;
        }

        public long Cents { get; }

        public long Price() => Cents;

        public string Describe()
        {
            return $"{sku} @ {Cents}";
        }
    }
}
