mod account;
mod money;
mod report;

use account::Account;

fn main() {
    let mut alice = Account::new("alice");
    let deposit = money::parse("12.50").unwrap_or(Money::from_cents(0));
    alice.deposit(deposit);
    let bob = account::open("bob: 3").expect("valid line");
    let accounts = vec![alice, bob];
    let text = report::render(&accounts);
    println!("{}", text);
}

use money::Money;
