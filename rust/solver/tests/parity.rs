//! Parity tests ported from `src/lib/solver/exact/optimizer.test.ts`,
//! including the exhaustive brute-force oracle over the tiny model.

use std::collections::BTreeMap;

use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::{One, Zero};
use serde_json::json;

use satisfactory_exact_solver::bounds::compute_recipe_bounds;
use satisfactory_exact_solver::data::SolverInputJson;
use satisfactory_exact_solver::graph::validate_recipe_graph;
use satisfactory_exact_solver::optimizer::{
    solve_exact_production, NormalizedExcess, NormalizedTarget, OptimizerProblem, OptimizerResult,
    ProofStatus,
};
use satisfactory_exact_solver::patterns::{equal_lane_tree_devices, generate_machine_bank_patterns};
use satisfactory_exact_solver::rational::{floor_bigint, parse_rational, to_fraction_string};
use satisfactory_exact_solver::validation::validate_exact_solution;

fn tiny_input_json() -> serde_json::Value {
    json!({
        "items": [
            { "id": "iron-ore", "isRaw": true },
            { "id": "iron-plate" },
            { "id": "iron-rod" }
        ],
        "recipes": [
            {
                "id": "tiny-plate",
                "durationSec": 60,
                "inputs": [{ "item": "iron-ore", "amount": 1 }],
                "outputs": [{ "item": "iron-plate", "amount": 1 }]
            },
            {
                "id": "tiny-rod",
                "durationSec": 30,
                "inputs": [{ "item": "iron-ore", "amount": 1 }],
                "outputs": [{ "item": "iron-rod", "amount": 1 }]
            }
        ],
        "scarceRawIds": ["iron-ore"],
        "rawAvailability": { "iron-ore": 2 },
        "targets": [
            { "item": "iron-plate", "minimum": 0, "weight": 1 },
            { "item": "iron-rod", "minimum": 0, "weight": 2 }
        ],
        "excess": [],
        "beltCapacity": 10
    })
}

fn problem_from_json(value: serde_json::Value) -> OptimizerProblem {
    let input: SolverInputJson = serde_json::from_value(value).unwrap();
    let graph = validate_recipe_graph(&input).unwrap();
    let belt_capacity = input.belt_capacity.to_rational("belt").unwrap();
    let raw_availability: BTreeMap<usize, BigRational> = input
        .raw_availability
        .iter()
        .map(|(id, value)| {
            (*graph.item_index_by_id.get(id).unwrap(), value.to_rational(id).unwrap())
        })
        .collect();
    let targets = input
        .targets
        .iter()
        .map(|target| NormalizedTarget {
            item: *graph.item_index_by_id.get(&target.item).unwrap(),
            minimum: target.minimum.to_rational("minimum").unwrap(),
            weight: target.weight.to_rational("weight").unwrap(),
        })
        .collect();
    let excess = input
        .excess
        .iter()
        .map(|entry| NormalizedExcess {
            item: *graph.item_index_by_id.get(&entry.item).unwrap(),
            floor: entry.floor.to_rational("floor").unwrap(),
        })
        .collect();
    OptimizerProblem {
        graph,
        raw_availability,
        targets,
        excess,
        belt_capacity,
        time_limit_ms: None,
    }
}

fn solve(problem: &OptimizerProblem) -> OptimizerResult {
    let mut progress = |_: usize, _: &str, _: &str, _: Option<f64>| {};
    solve_exact_production(problem, &mut progress).unwrap()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BruteObjective {
    raw: BigRational,
    weighted: BigRational,
    machines: BigInt,
    groups: BigInt,
    devices: BigInt,
}

/// Lexicographic comparison matching `compareObjectives` in optimizer.test.ts.
fn better(candidate: &BruteObjective, incumbent: &BruteObjective) -> bool {
    if candidate.raw != incumbent.raw {
        return candidate.raw > incumbent.raw;
    }
    if candidate.weighted != incumbent.weighted {
        return candidate.weighted > incumbent.weighted;
    }
    if candidate.machines != incumbent.machines {
        return candidate.machines < incumbent.machines;
    }
    if candidate.groups != incumbent.groups {
        return candidate.groups < incumbent.groups;
    }
    candidate.devices < incumbent.devices
}

fn brute_force_tiny(problem: &OptimizerProblem) -> BruteObjective {
    let bounds = compute_recipe_bounds(&problem.graph, &problem.raw_availability).unwrap();
    let weights: BTreeMap<usize, BigRational> = problem
        .targets
        .iter()
        .map(|target| (target.item, target.weight.clone()))
        .collect();

    struct BrutePattern {
        upper_bound: u64,
        machines: BigInt,
        input: BigRational,
        weighted_output: BigRational,
        per_bank_devices: BigInt,
    }
    let mut patterns: Vec<BrutePattern> = Vec::new();
    for &recipe_index in &problem.graph.topological_recipes {
        let bound = bounds.get(&recipe_index).unwrap();
        for pattern in generate_machine_bank_patterns(&problem.graph, bound, &problem.belt_capacity)
        {
            let upper = floor_bigint(
                &(bound.max_effective_machines.clone() / pattern.effective_machines.clone()),
            );
            if upper.is_zero() {
                continue;
            }
            let upper: u64 = upper.try_into().unwrap();
            let input = pattern
                .input_rates
                .first()
                .map(|(_, rate)| rate.clone())
                .unwrap_or_else(BigRational::zero);
            let (out_item, out_rate) = pattern.output_rates.first().unwrap();
            let weight = weights.get(out_item).cloned().unwrap_or_else(BigRational::zero);
            patterns.push(BrutePattern {
                upper_bound: upper,
                machines: pattern.machines.clone(),
                input,
                weighted_output: out_rate.clone() * weight,
                per_bank_devices: equal_lane_tree_devices(&pattern.machines) * BigInt::from(2),
            });
        }
    }

    let raw_limit = problem.raw_availability.values().next().unwrap().clone();
    let mut best: Option<BruteObjective> = None;

    fn visit(
        patterns: &[BrutePattern],
        raw_limit: &BigRational,
        index: usize,
        raw: BigRational,
        weighted: BigRational,
        machines: BigInt,
        groups: BigInt,
        devices: BigInt,
        best: &mut Option<BruteObjective>,
    ) {
        if raw > *raw_limit {
            return;
        }
        if index == patterns.len() {
            let candidate = BruteObjective { raw, weighted, machines, groups, devices };
            if best.as_ref().map(|incumbent| better(&candidate, incumbent)).unwrap_or(true) {
                *best = Some(candidate);
            }
            return;
        }
        let entry = &patterns[index];
        for count in 0..=entry.upper_bound {
            let multiplicity = BigInt::from(count);
            let factor = BigRational::from_integer(multiplicity.clone());
            visit(
                patterns,
                raw_limit,
                index + 1,
                raw.clone() + entry.input.clone() * factor.clone(),
                weighted.clone() + entry.weighted_output.clone() * factor,
                machines.clone() + &entry.machines * &multiplicity,
                groups.clone() + &multiplicity,
                devices.clone() + &entry.per_bank_devices * &multiplicity,
                best,
            );
        }
    }

    visit(
        &patterns,
        &raw_limit,
        0,
        BigRational::zero(),
        BigRational::zero(),
        BigInt::zero(),
        BigInt::zero(),
        BigInt::zero(),
        &mut best,
    );
    best.unwrap()
}

#[test]
fn matches_brute_force_across_the_complete_objective_hierarchy() {
    let problem = problem_from_json(tiny_input_json());
    let result = solve(&problem);
    let brute = brute_force_tiny(&problem);

    assert_eq!(result.proof_status, ProofStatus::Optimal);
    let objective = result.objective.as_ref().unwrap();
    assert_eq!(objective.scarce_raw_items_per_minute, brute.raw);
    assert_eq!(objective.weighted_target_output, brute.weighted);
    assert_eq!(objective.physical_machines, brute.machines);
    assert_eq!(objective.groups, brute.groups);
    assert_eq!(objective.total_splitter_merger_devices, brute.devices);
    assert!(validate_exact_solution(&problem, &result).is_empty());
}

#[test]
fn repeated_solves_return_the_same_exact_result() {
    let problem = problem_from_json(tiny_input_json());
    let first = solve(&problem);
    let second = solve(&problem);

    assert_eq!(first.proof_status, ProofStatus::Optimal);
    let left = first.objective.unwrap();
    let right = second.objective.unwrap();
    assert_eq!(left.scarce_raw_items_per_minute, right.scarce_raw_items_per_minute);
    assert_eq!(left.weighted_target_output, right.weighted_target_output);
    assert_eq!(left.physical_machines, right.physical_machines);
    assert_eq!(left.groups, right.groups);
    assert_eq!(left.total_splitter_merger_devices, right.total_splitter_merger_devices);
    assert_eq!(first.selected_banks.len(), second.selected_banks.len());
    for (a, b) in first.selected_banks.iter().zip(second.selected_banks.iter()) {
        assert_eq!(a.recipe, b.recipe);
        assert_eq!(a.machines, b.machines);
        assert_eq!(a.clock, b.clock);
        assert_eq!(a.multiplicity, b.multiplicity);
    }
}

#[test]
fn proves_an_impossible_target_minimum_infeasible() {
    let mut value = tiny_input_json();
    value["rawAvailability"] = json!({ "iron-ore": 0 });
    value["targets"] = json!([{ "item": "iron-plate", "minimum": 1, "weight": 1 }]);
    let problem = problem_from_json(value);

    let result = solve(&problem);
    assert_eq!(result.proof_status, ProofStatus::Infeasible);
    assert!(!result.feasible);
    assert!(result.selected_banks.is_empty());
    assert!(result.objective.is_none());
}

#[test]
fn maximizes_feasible_raw_use_when_full_availability_is_impossible() {
    let value = json!({
        "items": [
            { "id": "iron-ore", "isRaw": true },
            { "id": "iron-plate" }
        ],
        "recipes": [
            {
                "id": "three-ore-plate",
                "durationSec": 60,
                "inputs": [{ "item": "iron-ore", "amount": 3 }],
                "outputs": [{ "item": "iron-plate", "amount": 1 }]
            }
        ],
        "scarceRawIds": ["iron-ore"],
        "rawAvailability": { "iron-ore": "5/2" },
        "targets": [],
        "excess": [],
        "beltCapacity": 10
    });
    let problem = problem_from_json(value);

    let result = solve(&problem);
    assert_eq!(result.proof_status, ProofStatus::Optimal);
    let objective = result.objective.unwrap();
    assert_eq!(to_fraction_string(&objective.scarce_raw_items_per_minute), "2");
    let leftover = result.raws[0].leftover.as_ref().unwrap();
    assert_eq!(to_fraction_string(leftover), "1/2");
}

#[test]
fn breaks_equal_machine_and_group_ties_with_fewer_active_routing_branches() {
    let value = json!({
        "items": [
            { "id": "iron-ore", "isRaw": true },
            { "id": "iron-plate" },
            { "id": "iron-rod" },
            { "id": "wire" }
        ],
        "recipes": [
            {
                "id": "routing-source",
                "durationSec": 60,
                "inputs": [{ "item": "iron-ore", "amount": 2 }],
                "outputs": [{ "item": "iron-plate", "amount": 2 }]
            },
            {
                "id": "routing-consumer-a",
                "durationSec": 60,
                "inputs": [{ "item": "iron-plate", "amount": 1 }],
                "outputs": [{ "item": "iron-rod", "amount": 2 }]
            },
            {
                "id": "routing-consumer-b",
                "durationSec": 60,
                "inputs": [{ "item": "iron-plate", "amount": 1 }],
                "outputs": [{ "item": "wire", "amount": 2 }]
            }
        ],
        "scarceRawIds": ["iron-ore"],
        "rawAvailability": { "iron-ore": 2 },
        "targets": [
            { "item": "iron-rod", "minimum": 0, "weight": 1 },
            { "item": "wire", "minimum": 0, "weight": 1 }
        ],
        "excess": [],
        "beltCapacity": 2
    });
    let problem = problem_from_json(value);

    let result = solve(&problem);
    assert_eq!(result.proof_status, ProofStatus::Optimal);
    let objective = result.objective.as_ref().unwrap();
    assert_eq!(objective.physical_machines, BigInt::from(3));
    assert_eq!(objective.groups, BigInt::from(3));
    assert_eq!(objective.internal_splitter_merger_devices, BigInt::zero());
    assert_eq!(objective.routing_splitter_devices, BigInt::zero());
    assert_eq!(objective.total_splitter_merger_devices, BigInt::zero());

    let consumer_banks: Vec<_> = result
        .selected_banks
        .iter()
        .filter(|bank| problem.graph.recipes[bank.recipe].id.starts_with("routing-consumer"))
        .collect();
    assert_eq!(consumer_banks.len(), 1);
    assert_eq!(consumer_banks[0].multiplicity, BigInt::from(2));
    let positive_targets = result
        .targets
        .iter()
        .filter(|target| target.rate > BigRational::zero())
        .count();
    assert_eq!(positive_targets, 1);
    assert!(validate_exact_solution(&problem, &result).is_empty());
}

#[test]
fn counts_positive_consumer_target_and_excess_destinations_exactly() {
    let value = json!({
        "items": [
            { "id": "iron-ore", "isRaw": true },
            { "id": "iron-plate" },
            { "id": "iron-rod" }
        ],
        "recipes": [
            {
                "id": "activity-source",
                "durationSec": 60,
                "inputs": [{ "item": "iron-ore", "amount": 3 }],
                "outputs": [{ "item": "iron-plate", "amount": 3 }]
            },
            {
                "id": "activity-consumer",
                "durationSec": 60,
                "inputs": [{ "item": "iron-plate", "amount": 1 }],
                "outputs": [{ "item": "iron-rod", "amount": 1 }]
            }
        ],
        "scarceRawIds": ["iron-ore"],
        "rawAvailability": { "iron-ore": 3 },
        "targets": [
            { "item": "iron-plate", "minimum": 1, "weight": 0 },
            { "item": "iron-rod", "minimum": 1, "weight": 0 }
        ],
        "excess": [{ "item": "iron-plate", "floor": 1 }],
        "beltCapacity": 3
    });
    let problem = problem_from_json(value);

    let result = solve(&problem);
    assert_eq!(result.proof_status, ProofStatus::Optimal);
    let plate = *problem.graph.item_index_by_id.get("iron-plate").unwrap();
    let plate_target = result.targets.iter().find(|target| target.item == plate).unwrap();
    assert_eq!(to_fraction_string(&plate_target.rate), "1");
    let plate_excess = result.excess.iter().find(|entry| entry.item == plate).unwrap();
    assert_eq!(to_fraction_string(&plate_excess.rate), "1");
    let objective = result.objective.as_ref().unwrap();
    assert_eq!(objective.routing_splitter_devices, BigInt::one());
    assert_eq!(objective.total_splitter_merger_devices, BigInt::one());
    assert!(validate_exact_solution(&problem, &result).is_empty());
}

#[test]
fn parses_exact_fraction_availability() {
    assert_eq!(to_fraction_string(&parse_rational("5/2").unwrap()), "5/2");
}
