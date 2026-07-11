//! Legal underclock enumeration, ported from `src/lib/solver/exact/underclocks.ts`.

use std::collections::BTreeSet;

use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{One, Zero};

use crate::graph::Recipe;
use crate::rational::{floor_bigint, is_integer};

pub fn recipe_cycles_per_minute(recipe: &Recipe) -> BigRational {
    BigRational::from_integer(BigInt::from(60)) / recipe.duration_sec.clone()
}

pub struct RatesAtClock {
    pub inputs: Vec<(usize, BigRational)>,
    pub outputs: Vec<(usize, BigRational)>,
}

pub fn recipe_rates_at_clock(recipe: &Recipe, clock: &BigRational) -> RatesAtClock {
    assert!(
        *clock > BigRational::zero() && *clock <= BigRational::one(),
        "Clock must be in (0, 1]"
    );
    let cycles = recipe_cycles_per_minute(recipe) * clock;
    RatesAtClock {
        inputs: recipe
            .inputs
            .iter()
            .map(|input| (input.item, input.amount.clone() * cycles.clone()))
            .collect(),
        outputs: recipe
            .outputs
            .iter()
            .map(|output| (output.item, output.amount.clone() * cycles.clone()))
            .collect(),
    }
}

/// Every reduced clock in (0, 1] for which at least one port rate of one
/// machine is an integer number of items per minute.
pub fn legal_underclocks(recipe: &Recipe) -> Vec<BigRational> {
    let cycles = recipe_cycles_per_minute(recipe);
    assert!(cycles > BigRational::zero(), "Recipe must have a positive cycle rate");

    let mut clocks: BTreeSet<BigRational> = BTreeSet::new();
    for amount in recipe.inputs.iter().chain(recipe.outputs.iter()) {
        let full_rate = amount.amount.clone() * cycles.clone();
        assert!(full_rate > BigRational::zero(), "Recipe has a non-positive rate");

        let largest_integer_rate = floor_bigint(&full_rate);
        let mut integer_rate = BigInt::one();
        while integer_rate <= largest_integer_rate {
            let clock = BigRational::from_integer(integer_rate.clone()) / full_rate.clone();
            if clock > BigRational::zero() && clock <= BigRational::one() {
                let _ = clocks.insert(clock);
            }
            integer_rate += BigInt::one();
        }
    }
    clocks.into_iter().collect()
}

pub fn is_legal_underclock(recipe: &Recipe, clock: &BigRational) -> bool {
    if *clock <= BigRational::zero() || *clock > BigRational::one() {
        return false;
    }
    let rates = recipe_rates_at_clock(recipe, clock);
    rates
        .inputs
        .iter()
        .chain(rates.outputs.iter())
        .any(|(_, rate)| !rate.is_zero() && is_integer(rate))
}
