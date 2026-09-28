use crate::money::Money;

pub trait Summary {
    fn summary(&self) -> String;

    fn headline(&self) -> String {
        let text = self.summary();
        format!("== {} ==", text)
    }
}

pub struct Account {
    pub name: String,
    balance: Money,
    history: Vec<Money>,
}

impl Account {
    pub fn new(name: &str) -> Self {
        Account { name: name.to_string(), balance: Money::new(0), history: Vec::new() }
    }

    pub fn deposit(&mut self, amount: Money) {
        self.record(amount);
        self.balance = self.balance.add(amount);
    }

    fn record(&mut self, amount: Money) {
        self.history.push(amount);
    }

    pub fn total(&self) -> Money {
        let mut sum = Money::from_cents(0);
        for entry in &self.history {
            sum = sum.add(*entry);
        }
        sum
    }
}

impl Summary for Account {
    fn summary(&self) -> String {
        format!("{}: {}", self.name, self.total())
    }
}

pub fn parse(line: &str) -> Option<Account> {
    let name = line.split(':').next()?;
    Some(Account::new(name))
}

pub fn open(line: &str) -> Option<Account> {
    parse(line)
}
