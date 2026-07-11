//! Raw-derived per-recipe activity bounds, ported from
//! `src/lib/solver/exact/bounds.ts`.

use std::collections::BTreeMap;

use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::Zero;

use crate::graph::RecipeGraph;
use crate::rational::floor_bigint;
use crate::underclocks::{legal_underclocks, recipe_cycles_per_minute};

#[derive(Debug, Clone)]
pub struct RecipeBound {
    pub recipe: usize,
    /// Scarce raw items consumed by one cycle of this recipe and its dependencies.
    pub raw_per_cycle: BTreeMap<usize, BigRational>,
    pub max_cycles_per_minute: BigRational,
    pub max_effective_machines: BigRational,
    pub minimum_legal_clock: BigRational,
    pub max_machines: BigInt,
}

fn expand_item_to_scarce_raws(
    graph: &RecipeGraph,
    item: usize,
    amount: BigRational,
    target: &mut BTreeMap<usize, BigRational>,
) -> Result<(), String> {
    let item_data = &graph.items[item];
    if item_data.is_raw {
        if !item_data.is_unlimited {
            let entry = target.entry(item).or_insert_with(BigRational::zero);
            *entry += amount;
        }
        return Ok(());
    }

    let producer = graph
        .producer_by_item
        .get(&item)
        .ok_or_else(|| format!("No primary producer for {}", item_data.id))?;
    let producer_recipe = &graph.recipes[*producer];
    let output = producer_recipe
        .outputs
        .first()
        .ok_or_else(|| format!("Producer {} has no output", producer_recipe.id))?;

    let cycles = amount / output.amount.clone();
    for input in &producer_recipe.inputs {
        expand_item_to_scarce_raws(graph, input.item, input.amount.clone() * cycles.clone(), target)?;
    }
    Ok(())
}

pub fn raw_requirements_per_recipe_cycle(
    graph: &RecipeGraph,
    recipe: usize,
) -> Result<BTreeMap<usize, BigRational>, String> {
    let mut requirements = BTreeMap::new();
    for input in &graph.recipes[recipe].inputs {
        expand_item_to_scarce_raws(graph, input.item, input.amount.clone(), &mut requirements)?;
    }
    Ok(requirements)
}

/// Computes finite per-recipe activity and machine bounds from scarce raw
/// availability. Missing scarce resources have zero availability.
pub fn compute_recipe_bounds(
    graph: &RecipeGraph,
    raw_availability: &BTreeMap<usize, BigRational>,
) -> Result<BTreeMap<usize, RecipeBound>, String> {
    let mut bounds = BTreeMap::new();
    for &recipe_index in &graph.topological_recipes {
        let recipe = &graph.recipes[recipe_index];
        let raw_per_cycle = raw_requirements_per_recipe_cycle(graph, recipe_index)?;

        let mut max_cycles_per_minute: Option<BigRational> = None;
        for (item, requirement) in &raw_per_cycle {
            if *requirement <= BigRational::zero() {
                continue;
            }
            let available = raw_availability.get(item).cloned().unwrap_or_else(BigRational::zero);
            let candidate = available / requirement.clone();
            if max_cycles_per_minute
                .as_ref()
                .map(|current| candidate < *current)
                .unwrap_or(true)
            {
                max_cycles_per_minute = Some(candidate);
            }
        }
        let max_cycles_per_minute = max_cycles_per_minute
            .ok_or_else(|| format!("Recipe {} has no scarce raw requirement", recipe.id))?;

        let cycles_per_minute = recipe_cycles_per_minute(recipe);
        let max_effective_machines = max_cycles_per_minute.clone() / cycles_per_minute;

        let clocks = legal_underclocks(recipe);
        let minimum_legal_clock = clocks
            .first()
            .cloned()
            .ok_or_else(|| format!("Recipe {} has no legal underclock", recipe.id))?;

        let max_machines =
            floor_bigint(&(max_effective_machines.clone() / minimum_legal_clock.clone()));
        let _ = bounds.insert(
            recipe_index,
            RecipeBound {
                recipe: recipe_index,
                raw_per_cycle,
                max_cycles_per_minute,
                max_effective_machines,
                minimum_legal_clock,
                max_machines,
            },
        );
    }
    Ok(bounds)
}
