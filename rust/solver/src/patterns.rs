//! Belt-safe machine-bank pattern enumeration, ported from
//! `src/lib/solver/exact/bank-patterns.ts`.

use std::collections::BTreeSet;

use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{One, Zero};

use crate::bounds::RecipeBound;
use crate::graph::RecipeGraph;
use crate::rational::floor_bigint;
use crate::underclocks::{legal_underclocks, recipe_cycles_per_minute, recipe_rates_at_clock};

#[derive(Debug, Clone)]
pub struct BankPattern {
    pub recipe: usize,
    pub machines: BigInt,
    pub clock: BigRational,
    pub effective_machines: BigRational,
    pub cycles_per_minute: BigRational,
    pub input_rates: Vec<(usize, BigRational)>,
    pub output_rates: Vec<(usize, BigRational)>,
}

/// All 2^a * 3^b counts up to a finite bound, ascending.
pub fn canonical_splitter_machine_counts(max_machines: &BigInt) -> Vec<BigInt> {
    let zero = BigInt::zero();
    assert!(*max_machines >= zero, "maxMachines cannot be negative");
    if max_machines.is_zero() {
        return Vec::new();
    }

    let two = BigInt::from(2);
    let three = BigInt::from(3);
    let mut counts: BTreeSet<BigInt> = BTreeSet::new();
    let mut power_of_two = BigInt::one();
    while power_of_two <= *max_machines {
        let mut count = power_of_two.clone();
        while count <= *max_machines {
            let _ = counts.insert(count.clone());
            count *= three.clone();
        }
        power_of_two *= two.clone();
    }
    counts.into_iter().collect()
}

pub fn is_canonical_splitter_machine_count(count: &BigInt) -> bool {
    if *count <= BigInt::zero() {
        return false;
    }
    let two = BigInt::from(2);
    let three = BigInt::from(3);
    let mut remainder = count.clone();
    while (&remainder % &two).is_zero() {
        remainder /= &two;
    }
    while (&remainder % &three).is_zero() {
        remainder /= &three;
    }
    remainder.is_one()
}

/// Minimum splitter (or merger) devices in a full equal-lane tree.
pub fn equal_lane_tree_devices(count: &BigInt) -> BigInt {
    assert!(
        is_canonical_splitter_machine_count(count),
        "Machine count is not splitter-friendly: {count}"
    );
    if count.is_one() {
        return BigInt::zero();
    }

    let two = BigInt::from(2);
    let three = BigInt::from(3);
    let mut remaining = count.clone();
    let mut lanes = BigInt::one();
    let mut devices = BigInt::zero();
    while (&remaining % &two).is_zero() {
        devices += &lanes;
        lanes *= &two;
        remaining /= &two;
    }
    while (&remaining % &three).is_zero() {
        devices += &lanes;
        lanes *= &three;
        remaining /= &three;
    }
    devices
}

/// Generates every legal equal-clock machine-bank pattern that fits one belt
/// for each recipe input and output and stays within the recipe's raw bound.
///
/// Sorted by descending clock, then ascending machine count (TS parity).
pub fn generate_machine_bank_patterns(
    graph: &RecipeGraph,
    bound: &RecipeBound,
    belt_capacity: &BigRational,
) -> Vec<BankPattern> {
    assert!(*belt_capacity > BigRational::zero(), "Belt capacity must be positive");

    let recipe = &graph.recipes[bound.recipe];
    let cycles_per_machine = recipe_cycles_per_minute(recipe);
    let mut patterns: Vec<BankPattern> = Vec::new();

    for clock in legal_underclocks(recipe) {
        let mut count_limit = floor_bigint(&(bound.max_effective_machines.clone() / clock.clone()));
        let rates = recipe_rates_at_clock(recipe, &clock);
        for (_, rate) in rates.inputs.iter().chain(rates.outputs.iter()) {
            if *rate <= BigRational::zero() {
                continue;
            }
            let by_belt = floor_bigint(&(belt_capacity.clone() / rate.clone()));
            if by_belt < count_limit {
                count_limit = by_belt;
            }
        }
        if bound.max_machines < count_limit {
            count_limit = bound.max_machines.clone();
        }
        if count_limit <= BigInt::zero() {
            continue;
        }

        for machines in canonical_splitter_machine_counts(&count_limit) {
            let machine_factor = BigRational::from_integer(machines.clone());
            let effective_machines = clock.clone() * machine_factor.clone();
            patterns.push(BankPattern {
                recipe: bound.recipe,
                machines,
                clock: clock.clone(),
                effective_machines: effective_machines.clone(),
                cycles_per_minute: cycles_per_machine.clone() * effective_machines,
                input_rates: rates
                    .inputs
                    .iter()
                    .map(|(item, rate)| (*item, rate.clone() * machine_factor.clone()))
                    .collect(),
                output_rates: rates
                    .outputs
                    .iter()
                    .map(|(item, rate)| (*item, rate.clone() * machine_factor.clone()))
                    .collect(),
            });
        }
    }

    patterns.sort_by(|left, right| {
        right
            .clock
            .cmp(&left.clock)
            .then_with(|| left.machines.cmp(&right.machines))
    });
    patterns
}
