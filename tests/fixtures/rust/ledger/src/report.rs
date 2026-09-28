use crate::account::{Account, Summary};
use crate::money::Money;

pub fn total(accounts: &[Account]) -> Money {
    let mut sum = Money::from_cents(0);
    for account in accounts {
        sum = sum.add(account.total());
    }
    sum
}

pub fn render(accounts: &[Account]) -> String {
    let mut out = String::new();
    for account in accounts {
        out.push_str(&account.headline());
        out.push('\n');
    }
    let grand = total(accounts);
    out.push_str(&format!("total {}", grand));
    out
}
