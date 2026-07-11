//! Independent post-solve verification, ported from
//! `src/lib/solver/exact/validation.ts`. Recomputes every rate and objective
//! from recipe data and selected banks without trusting solver output.

use std::collections::{BTreeMap, BTreeSet};

use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{One, Zero};

use crate::bounds::compute_recipe_bounds;
use crate::optimizer::{OptimizerProblem, OptimizerResult, ProofStatus, SelectedBank};
use crate::patterns::is_canonical_splitter_machine_count;
use crate::rational::to_fraction_string;
use crate::underclocks::{is_legal_underclock, recipe_cycles_per_minute, recipe_rates_at_clock};

fn lane_tree_devices(count: &BigInt) -> BigInt {
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

fn routing_devices(destinations: &BigInt, output_lanes: &BigInt) -> BigInt {
    let additional = destinations - output_lanes;
    if additional > BigInt::zero() {
        (additional + BigInt::one()) / BigInt::from(2)
    } else {
        BigInt::zero()
    }
}

fn add_rate(target: &mut BTreeMap<usize, BigRational>, item: usize, amount: BigRational) {
    let slot = target.entry(item).or_insert_with(BigRational::zero);
    *slot += amount;
}

fn map_matches(
    actual: &BTreeMap<usize, BigRational>,
    expected_entries: &[(usize, BigRational)],
) -> bool {
    let mut expected: BTreeMap<usize, BigRational> = BTreeMap::new();
    for (item, rate) in expected_entries {
        add_rate(&mut expected, *item, rate.clone());
    }
    if actual.len() != expected.len() {
        return false;
    }
    expected
        .iter()
        .all(|(item, rate)| actual.get(item).map(|actual_rate| actual_rate == rate).unwrap_or(false))
}

fn validate_bank(
    problem: &OptimizerProblem,
    bank: &SelectedBank,
    produced: &mut BTreeMap<usize, BigRational>,
    consumed: &mut BTreeMap<usize, BigRational>,
    issues: &mut Vec<String>,
) {
    let recipe = &problem.graph.recipes[bank.recipe];
    let recipe_id = &recipe.id;
    if bank.multiplicity <= BigInt::zero() {
        issues.push(format!("Selected bank {recipe_id} has non-positive multiplicity"));
    }
    if !is_canonical_splitter_machine_count(&bank.machines) {
        issues.push(format!(
            "Selected bank {recipe_id} has non-canonical machine count {}",
            bank.machines
        ));
    }
    if !is_legal_underclock(recipe, &bank.clock) {
        issues.push(format!(
            "Selected bank {recipe_id} has illegal clock {}",
            to_fraction_string(&bank.clock)
        ));
    }
    if bank.clock <= BigRational::zero() || bank.clock > BigRational::one() {
        issues.push(format!("Selected bank {recipe_id} clock cannot produce exact rates"));
        return;
    }

    let rates = recipe_rates_at_clock(recipe, &bank.clock);
    let machine_factor = BigRational::from_integer(bank.machines.clone());
    let expected_inputs: Vec<(usize, BigRational)> = rates
        .inputs
        .iter()
        .map(|(item, rate)| (*item, rate.clone() * machine_factor.clone()))
        .collect();
    let expected_outputs: Vec<(usize, BigRational)> = rates
        .outputs
        .iter()
        .map(|(item, rate)| (*item, rate.clone() * machine_factor.clone()))
        .collect();
    if !map_matches(&bank.input_rates_per_bank, &expected_inputs) {
        issues.push(format!("Selected bank {recipe_id} reports incorrect input rates"));
    }
    if !map_matches(&bank.output_rates_per_bank, &expected_outputs) {
        issues.push(format!("Selected bank {recipe_id} reports incorrect output rates"));
    }
    let expected_effective = bank.clock.clone() * machine_factor;
    let expected_cycles = recipe_cycles_per_minute(recipe) * expected_effective.clone();
    if bank.effective_machines_per_bank != expected_effective {
        issues.push(format!("Selected bank {recipe_id} reports incorrect effective machines"));
    }
    if bank.cycles_per_minute_per_bank != expected_cycles {
        issues.push(format!("Selected bank {recipe_id} reports incorrect cycle rate"));
    }

    let multiplicity = BigRational::from_integer(bank.multiplicity.clone());
    for (item, rate) in expected_inputs.iter().chain(expected_outputs.iter()) {
        if *rate > problem.belt_capacity {
            issues.push(format!(
                "Selected bank {recipe_id} exceeds belt capacity for {}",
                problem.graph.items[*item].id
            ));
        }
    }
    for (item, rate) in &expected_inputs {
        add_rate(consumed, *item, rate.clone() * multiplicity.clone());
    }
    for (item, rate) in &expected_outputs {
        add_rate(produced, *item, rate.clone() * multiplicity.clone());
    }
}

/// Returns an empty list when the solution is valid; otherwise all issues.
pub fn validate_exact_solution(
    problem: &OptimizerProblem,
    result: &OptimizerResult,
) -> Vec<String> {
    let mut issues: Vec<String> = Vec::new();
    if !result.feasible || result.proof_status != ProofStatus::Optimal || result.objective.is_none()
    {
        return vec!["Only a proven OPTIMAL feasible solution can be validated".to_string()];
    }
    let objective = result.objective.as_ref().unwrap();

    let mut produced: BTreeMap<usize, BigRational> = BTreeMap::new();
    let mut consumed: BTreeMap<usize, BigRational> = BTreeMap::new();
    let mut effective_by_recipe: BTreeMap<usize, BigRational> = BTreeMap::new();
    let mut selected_keys: BTreeSet<String> = BTreeSet::new();
    let mut active_recipes: BTreeSet<usize> = BTreeSet::new();
    let mut output_lanes_by_item: BTreeMap<usize, BigInt> = BTreeMap::new();
    let mut physical_machines = BigInt::zero();
    let mut groups = BigInt::zero();
    let mut internal_devices = BigInt::zero();

    for bank in &result.selected_banks {
        let recipe = &problem.graph.recipes[bank.recipe];
        let key = format!("{}|{}|{}", recipe.id, bank.machines, to_fraction_string(&bank.clock));
        if !selected_keys.insert(key.clone()) {
            issues.push(format!("Duplicate selected bank pattern: {key}"));
        }
        validate_bank(problem, bank, &mut produced, &mut consumed, &mut issues);
        let total_effective = bank.clock.clone()
            * BigRational::from_integer(bank.machines.clone())
            * BigRational::from_integer(bank.multiplicity.clone());
        let slot = effective_by_recipe
            .entry(bank.recipe)
            .or_insert_with(BigRational::zero);
        *slot += total_effective;
        let _ = active_recipes.insert(bank.recipe);
        for output in &recipe.outputs {
            let lanes = output_lanes_by_item.entry(output.item).or_insert_with(BigInt::zero);
            *lanes += &bank.multiplicity;
        }
        physical_machines += &bank.machines * &bank.multiplicity;
        groups += &bank.multiplicity;
        internal_devices += lane_tree_devices(&bank.machines)
            * BigInt::from((recipe.inputs.len() + recipe.outputs.len()) as u64)
            * &bank.multiplicity;
    }

    match compute_recipe_bounds(&problem.graph, &problem.raw_availability) {
        Ok(bounds) => {
            for (recipe_index, effective) in &effective_by_recipe {
                let within = bounds
                    .get(recipe_index)
                    .map(|bound| *effective <= bound.max_effective_machines)
                    .unwrap_or(false);
                if !within {
                    issues.push(format!(
                        "Selected activity exceeds the raw-derived bound for {}",
                        problem.graph.recipes[*recipe_index].id
                    ));
                }
            }
        }
        Err(error) => issues.push(error),
    }

    let mut target_by_item: BTreeMap<usize, &crate::optimizer::TargetRate> = BTreeMap::new();
    for target in &result.targets {
        if target_by_item.insert(target.item, target).is_some() {
            issues.push(format!(
                "Duplicate reported target: {}",
                problem.graph.items[target.item].id
            ));
        }
    }
    if target_by_item.len() != problem.targets.len() {
        issues.push("Reported target set does not match the requested target set".to_string());
    }
    for spec in &problem.targets {
        let item_id = &problem.graph.items[spec.item].id;
        match target_by_item.get(&spec.item) {
            None => issues.push(format!("Missing reported target: {item_id}")),
            Some(target) => {
                if target.minimum != spec.minimum || target.weight != spec.weight {
                    issues.push(format!("Reported target metadata is incorrect for {item_id}"));
                }
                if target.rate < spec.minimum {
                    issues.push(format!("Target minimum is not met for {item_id}"));
                }
            }
        }
    }

    let requested_floors: BTreeMap<usize, BigRational> = problem
        .excess
        .iter()
        .map(|entry| (entry.item, entry.floor.clone()))
        .collect();
    let eligible_excess: Vec<usize> = problem
        .graph
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| !item.is_raw && !item.is_ingot)
        .map(|(index, _)| index)
        .collect();
    let mut excess_by_item: BTreeMap<usize, &crate::optimizer::ExcessRate> = BTreeMap::new();
    for excess in &result.excess {
        if excess_by_item.insert(excess.item, excess).is_some() {
            issues.push(format!(
                "Duplicate reported excess: {}",
                problem.graph.items[excess.item].id
            ));
        }
    }
    if excess_by_item.len() != eligible_excess.len()
        || eligible_excess.iter().any(|item| !excess_by_item.contains_key(item))
    {
        issues.push("Reported excess set must contain every manufactured non-ingot".to_string());
    }
    for (index, item) in problem.graph.items.iter().enumerate() {
        let excess = excess_by_item.get(&index);
        if item.is_ingot {
            if let Some(excess) = excess {
                if !excess.rate.is_zero() {
                    issues.push(format!("Ingot storage is forbidden: {}", item.id));
                }
            }
        }
        if item.is_raw || item.is_ingot {
            continue;
        }
        let floor = requested_floors.get(&index).cloned().unwrap_or_else(BigRational::zero);
        let Some(excess) = excess else { continue };
        if excess.floor != floor {
            issues.push(format!("Reported excess floor is incorrect for {}", item.id));
        }
        if excess.rate < floor {
            issues.push(format!("Excess floor is not met for {}", item.id));
        }
    }

    for (index, item) in problem.graph.items.iter().enumerate() {
        if item.is_raw {
            continue;
        }
        let target = target_by_item
            .get(&index)
            .map(|target| target.rate.clone())
            .unwrap_or_else(BigRational::zero);
        let excess = excess_by_item
            .get(&index)
            .map(|excess| excess.rate.clone())
            .unwrap_or_else(BigRational::zero);
        let left = produced.get(&index).cloned().unwrap_or_else(BigRational::zero);
        let right =
            consumed.get(&index).cloned().unwrap_or_else(BigRational::zero) + target + excess.clone();
        if left != right {
            issues.push(format!(
                "Exact conservation fails for {}: {} != {}",
                item.id,
                to_fraction_string(&left),
                to_fraction_string(&right)
            ));
        }
        if item.is_ingot && !excess.is_zero() {
            issues.push(format!("Ingot has non-zero excess: {}", item.id));
        }
    }

    let mut raw_by_item: BTreeMap<usize, &crate::optimizer::RawRate> = BTreeMap::new();
    for raw in &result.raws {
        if raw_by_item.insert(raw.item, raw).is_some() {
            issues.push(format!("Duplicate reported raw: {}", problem.graph.items[raw.item].id));
        }
    }
    let raw_items: Vec<usize> = problem
        .graph
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| item.is_raw)
        .map(|(index, _)| index)
        .collect();
    if raw_by_item.len() != raw_items.len() {
        issues.push("Reported raw set is incomplete".to_string());
    }
    for index in raw_items {
        let item = &problem.graph.items[index];
        let used = consumed.get(&index).cloned().unwrap_or_else(BigRational::zero);
        let Some(raw) = raw_by_item.get(&index) else {
            issues.push(format!("Missing reported raw: {}", item.id));
            continue;
        };
        if raw.used != used || raw.unlimited != item.is_unlimited {
            issues.push(format!("Reported raw use is incorrect for {}", item.id));
        }
        if item.is_unlimited {
            if raw.available.is_some() || raw.leftover.is_some() {
                issues.push(format!("Unlimited raw {} must not report a finite bound", item.id));
            }
            continue;
        }
        let available = problem
            .raw_availability
            .get(&index)
            .cloned()
            .unwrap_or_else(BigRational::zero);
        if used > available {
            issues.push(format!("Raw availability exceeded for {}", item.id));
        }
        let leftover = available.clone() - used;
        if raw.available.as_ref() != Some(&available) || raw.leftover.as_ref() != Some(&leftover) {
            issues.push(format!("Reported raw availability/leftover is incorrect for {}", item.id));
        }
    }

    let mut item_by_item: BTreeMap<usize, &crate::optimizer::ItemRate> = BTreeMap::new();
    for item_rate in &result.items {
        if item_by_item.insert(item_rate.item, item_rate).is_some() {
            issues.push(format!(
                "Duplicate reported item rate: {}",
                problem.graph.items[item_rate.item].id
            ));
        }
    }
    if item_by_item.len() != problem.graph.items.len() {
        issues.push("Reported item-rate set is incomplete".to_string());
    }
    for (index, item) in problem.graph.items.iter().enumerate() {
        let Some(rate) = item_by_item.get(&index) else {
            issues.push(format!("Missing reported item rate: {}", item.id));
            continue;
        };
        let expected_target = target_by_item
            .get(&index)
            .map(|target| target.rate.clone())
            .unwrap_or_else(BigRational::zero);
        let expected_excess = excess_by_item
            .get(&index)
            .map(|excess| excess.rate.clone())
            .unwrap_or_else(BigRational::zero);
        if rate.produced != produced.get(&index).cloned().unwrap_or_else(BigRational::zero)
            || rate.consumed != consumed.get(&index).cloned().unwrap_or_else(BigRational::zero)
            || rate.target_withdrawal != expected_target
            || rate.excess_withdrawal != expected_excess
        {
            issues.push(format!("Reported item rates are incorrect for {}", item.id));
        }
    }

    let scarce_raw_items_per_minute =
        problem.graph.scarce_raw_ids.iter().fold(BigRational::zero(), |total, item| {
            total + consumed.get(item).cloned().unwrap_or_else(BigRational::zero)
        });
    let weighted_target_output = result.targets.iter().fold(BigRational::zero(), |total, target| {
        total + target.rate.clone() * target.weight.clone()
    });
    let mut routing_splitter_devices = BigInt::zero();
    for (index, item) in problem.graph.items.iter().enumerate() {
        if item.is_raw {
            continue;
        }
        let mut destinations = BigInt::from(
            problem
                .graph
                .recipes
                .iter()
                .enumerate()
                .filter(|(recipe_index, recipe)| {
                    active_recipes.contains(recipe_index)
                        && recipe.inputs.iter().any(|input| input.item == index)
                })
                .count() as u64,
        );
        let target_rate = target_by_item
            .get(&index)
            .map(|target| target.rate.clone())
            .unwrap_or_else(BigRational::zero);
        if target_rate > BigRational::zero() {
            destinations += BigInt::one();
        }
        let excess_rate = excess_by_item
            .get(&index)
            .map(|excess| excess.rate.clone())
            .unwrap_or_else(BigRational::zero);
        if excess_rate > BigRational::zero() {
            destinations += BigInt::one();
        }
        routing_splitter_devices += routing_devices(
            &destinations,
            output_lanes_by_item.get(&index).unwrap_or(&BigInt::zero()),
        );
    }
    let total_devices = internal_devices.clone() + routing_splitter_devices.clone();

    if objective.scarce_raw_items_per_minute != scarce_raw_items_per_minute {
        issues.push("Reported scarce-raw objective is incorrect".to_string());
    }
    if objective.weighted_target_output != weighted_target_output {
        issues.push("Reported weighted-target objective is incorrect".to_string());
    }
    if objective.physical_machines != physical_machines {
        issues.push("Reported physical-machine objective is incorrect".to_string());
    }
    if objective.groups != groups {
        issues.push("Reported group objective is incorrect".to_string());
    }
    if objective.internal_splitter_merger_devices != internal_devices {
        issues.push("Reported internal-device objective is incorrect".to_string());
    }
    if objective.routing_splitter_devices != routing_splitter_devices {
        issues.push("Reported routing-device objective is incorrect".to_string());
    }
    if objective.total_splitter_merger_devices != total_devices {
        issues.push("Reported total-device objective is incorrect".to_string());
    }

    issues
}
