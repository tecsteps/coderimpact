use std::fmt;

pub const CENTS_PER_UNIT: i64 = 100;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Money {
    cents: i64,
}

impl Money {
    pub fn new(units: i64) -> Self {
        Money { cents: units * CENTS_PER_UNIT }
    }

    pub fn from_cents(cents: i64) -> Self {
        Money { cents }
    }

    pub fn add(&self, other: Money) -> Money {
        Money::from_cents(self.cents + other.cents)
    }

    pub fn cents(&self) -> i64 {
        self.cents
    }
}

impl fmt::Display for Money {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{:02}", self.cents / CENTS_PER_UNIT, self.cents % CENTS_PER_UNIT)
    }
}

pub fn parse(text: &str) -> Option<Money> {
    let cents: i64 = text.trim().replace('.', "").parse().ok()?;
    Some(Money::from_cents(cents))
}
