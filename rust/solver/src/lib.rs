//! Rust/WASM port of the exact Satisfactory production optimizer.
//!
//! Native Rust re-implements the entire pipeline from
//! `src/lib/solver/exact/*.ts` (rationals, recipe graph, underclocks, bounds,
//! bank patterns, model construction, six-phase lexicographic solve, and
//! independent validation). The CP-SAT backend is Pumpkin, a pure-Rust lazy
//! clause generation constraint programming solver.

pub mod bounds;
pub mod data;
pub mod graph;
pub mod optimizer;
pub mod patterns;
pub mod rational;
pub mod underclocks;
pub mod validation;

use std::collections::{BTreeMap, HashSet};

use num_rational::BigRational;
use num_traits::Zero;

use data::{
    ItemRateJson, ObjectiveJson, PhaseTimingJson, RawRateJson, SelectedBankJson, SolverInputJson,
    SolverResultJson, TargetRateJson,
};
use graph::{validate_recipe_graph, RecipeGraph};
use optimizer::{
    solve_exact_production, NormalizedExcess, NormalizedTarget, OptimizerProblem, OptimizerResult,
    ProgressCallback,
};
use rational::to_fraction_string;

fn normalize_problem(input: &SolverInputJson) -> Result<OptimizerProblem, String> {
    let graph = validate_recipe_graph(input)?;
    let belt_capacity = input.belt_capacity.to_rational("belt capacity")?;
    if belt_capacity <= BigRational::zero() {
        return Err("Belt capacity must be positive".to_string());
    }

    let mut raw_availability: BTreeMap<usize, BigRational> = BTreeMap::new();
    for (item_id, value) in &input.raw_availability {
        let index = *graph
            .item_index_by_id
            .get(item_id)
            .ok_or_else(|| format!("Raw availability references a non-raw item: {item_id}"))?;
        if !graph.items[index].is_raw {
            return Err(format!("Raw availability references a non-raw item: {item_id}"));
        }
        let amount = value.to_rational(&format!("{item_id} availability"))?;
        if amount < BigRational::zero() {
            return Err(format!("Raw availability cannot be negative: {item_id}"));
        }
        let _ = raw_availability.insert(index, amount);
    }

    let mut seen_targets: HashSet<usize> = HashSet::new();
    let mut targets: Vec<NormalizedTarget> = Vec::new();
    for target in &input.targets {
        let index = *graph
            .item_index_by_id
            .get(&target.item)
            .ok_or_else(|| format!("Exact target must be a manufactured non-ingot: {}", target.item))?;
        if !seen_targets.insert(index) {
            return Err(format!("Duplicate exact target: {}", target.item));
        }
        let item = &graph.items[index];
        if item.is_raw || item.is_ingot {
            return Err(format!("Exact target must be a manufactured non-ingot: {}", target.item));
        }
        let minimum = target.minimum.to_rational(&format!("{} target minimum", target.item))?;
        let weight = target.weight.to_rational(&format!("{} target weight", target.item))?;
        if minimum < BigRational::zero() {
            return Err(format!("Target minimum cannot be negative: {}", target.item));
        }
        if weight < BigRational::zero() {
            return Err(format!("Target weight cannot be negative: {}", target.item));
        }
        targets.push(NormalizedTarget { item: index, minimum, weight });
    }

    let mut seen_excess: HashSet<usize> = HashSet::new();
    let mut excess: Vec<NormalizedExcess> = Vec::new();
    for entry in &input.excess {
        let index = *graph
            .item_index_by_id
            .get(&entry.item)
            .ok_or_else(|| format!("Exact excess must be a manufactured non-ingot: {}", entry.item))?;
        if !seen_excess.insert(index) {
            return Err(format!("Duplicate exact excess floor: {}", entry.item));
        }
        let item = &graph.items[index];
        if item.is_raw || item.is_ingot {
            return Err(format!("Exact excess must be a manufactured non-ingot: {}", entry.item));
        }
        let floor = entry.floor.to_rational(&format!("{} excess floor", entry.item))?;
        if floor < BigRational::zero() {
            return Err(format!("Excess floor cannot be negative: {}", entry.item));
        }
        excess.push(NormalizedExcess { item: index, floor });
    }

    Ok(OptimizerProblem {
        graph,
        raw_availability,
        targets,
        excess,
        belt_capacity,
        time_limit_ms: input.time_limit_ms,
    })
}

fn result_to_json(graph: &RecipeGraph, result: &OptimizerResult) -> SolverResultJson {
    let item_id = |index: usize| graph.items[index].id.clone();
    let rates_json = |rates: &BTreeMap<usize, BigRational>| {
        rates
            .iter()
            .map(|(item, rate)| (item_id(*item), to_fraction_string(rate)))
            .collect::<BTreeMap<String, String>>()
    };

    SolverResultJson {
        feasible: result.feasible,
        proof_status: result.proof_status.as_str().to_string(),
        selected_banks: result
            .selected_banks
            .iter()
            .map(|bank| SelectedBankJson {
                recipe_id: graph.recipes[bank.recipe].id.clone(),
                machines: bank.machines.to_string(),
                clock: to_fraction_string(&bank.clock),
                multiplicity: bank.multiplicity.to_string(),
                effective_machines_per_bank: to_fraction_string(&bank.effective_machines_per_bank),
                cycles_per_minute_per_bank: to_fraction_string(&bank.cycles_per_minute_per_bank),
                input_rates_per_bank: rates_json(&bank.input_rates_per_bank),
                output_rates_per_bank: rates_json(&bank.output_rates_per_bank),
            })
            .collect(),
        targets: result
            .targets
            .iter()
            .map(|target| TargetRateJson {
                item: item_id(target.item),
                minimum: to_fraction_string(&target.minimum),
                weight: to_fraction_string(&target.weight),
                rate: to_fraction_string(&target.rate),
            })
            .collect(),
        excess: result
            .excess
            .iter()
            .map(|entry| data::ExcessRateJson {
                item: item_id(entry.item),
                floor: to_fraction_string(&entry.floor),
                rate: to_fraction_string(&entry.rate),
            })
            .collect(),
        raws: result
            .raws
            .iter()
            .map(|raw| RawRateJson {
                item: item_id(raw.item),
                unlimited: raw.unlimited,
                available: raw.available.as_ref().map(to_fraction_string),
                used: to_fraction_string(&raw.used),
                leftover: raw.leftover.as_ref().map(to_fraction_string),
            })
            .collect(),
        items: result
            .items
            .iter()
            .map(|item| ItemRateJson {
                item: item_id(item.item),
                produced: to_fraction_string(&item.produced),
                consumed: to_fraction_string(&item.consumed),
                target_withdrawal: to_fraction_string(&item.target_withdrawal),
                excess_withdrawal: to_fraction_string(&item.excess_withdrawal),
            })
            .collect(),
        objective: result.objective.as_ref().map(|objective| ObjectiveJson {
            scarce_raw_items_per_minute: to_fraction_string(&objective.scarce_raw_items_per_minute),
            weighted_target_output: to_fraction_string(&objective.weighted_target_output),
            physical_machines: objective.physical_machines.to_string(),
            groups: objective.groups.to_string(),
            internal_splitter_merger_devices: objective
                .internal_splitter_merger_devices
                .to_string(),
            routing_splitter_devices: objective.routing_splitter_devices.to_string(),
            total_splitter_merger_devices: objective.total_splitter_merger_devices.to_string(),
        }),
        phase_timings: result
            .phase_timings
            .iter()
            .enumerate()
            .map(|(index, (label, phase_ms))| PhaseTimingJson {
                phase: index + 1,
                label: label.clone(),
                phase_ms: *phase_ms,
            })
            .collect(),
    }
}

/// Full JSON round-trip solve: parse the problem, prove the lexicographic
/// optimum, and serialize the exact result.
pub fn solve_json_with_progress(
    input_json: &str,
    progress: &mut ProgressCallback<'_>,
) -> Result<String, String> {
    let input: SolverInputJson =
        serde_json::from_str(input_json).map_err(|error| format!("Invalid solver input: {error}"))?;
    let problem = normalize_problem(&input)?;
    let result = solve_exact_production(&problem, progress)?;
    serde_json::to_string(&result_to_json(&problem.graph, &result))
        .map_err(|error| format!("Failed to serialize solver result: {error}"))
}

/// Exposed for diagnostics tooling (examples/probe.rs).
#[doc(hidden)]
pub fn normalize_problem_public(input: &SolverInputJson) -> Result<OptimizerProblem, String> {
    normalize_problem(input)
}

pub fn solve_json(input_json: &str) -> Result<String, String> {
    let mut progress: Box<ProgressCallback<'_>> = Box::new(|_, _, _, _| {});
    solve_json_with_progress(input_json, progress.as_mut())
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;

    /// Solves the exact production problem from a JSON payload.
    ///
    /// `on_progress` (optional) is called as
    /// `(phase: number, label: string, status: "solving" | "complete", phaseMs?: number)`.
    #[wasm_bindgen]
    pub fn solve_exact(
        input_json: &str,
        on_progress: Option<js_sys::Function>,
    ) -> Result<String, JsError> {
        console_error_panic_hook::set_once();
        let mut callback = |phase: usize, label: &str, status: &str, phase_ms: Option<f64>| {
            if let Some(function) = &on_progress {
                let args = js_sys::Array::of4(
                    &JsValue::from_f64(phase as f64),
                    &JsValue::from_str(label),
                    &JsValue::from_str(status),
                    &phase_ms.map(JsValue::from_f64).unwrap_or(JsValue::UNDEFINED),
                );
                let _ = function.apply(&JsValue::NULL, &args);
            }
        };
        crate::solve_json_with_progress(input_json, &mut callback)
            .map_err(|error| JsError::new(&error))
    }

    /// Reports the crate version for runtime diagnostics.
    #[wasm_bindgen]
    pub fn solver_version() -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}
