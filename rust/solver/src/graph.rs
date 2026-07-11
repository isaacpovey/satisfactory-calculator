//! Recipe-graph validation and indexing, ported from
//! `src/lib/solver/exact/recipe-graph.ts`.

use std::collections::{HashMap, HashSet};

use num_rational::BigRational;
use num_traits::Zero;

use crate::data::{ItemJson, SolverInputJson};

#[derive(Debug, Clone)]
pub struct Item {
    pub id: String,
    pub is_raw: bool,
    pub is_unlimited: bool,
    pub is_ingot: bool,
}

#[derive(Debug, Clone)]
pub struct ItemAmount {
    pub item: usize,
    pub amount: BigRational,
}

#[derive(Debug, Clone)]
pub struct Recipe {
    pub id: String,
    pub duration_sec: BigRational,
    pub inputs: Vec<ItemAmount>,
    pub outputs: Vec<ItemAmount>,
}

/// Validated, indexed recipe graph. Items and recipes are referenced by dense
/// indices everywhere past this boundary.
#[derive(Debug, Clone)]
pub struct RecipeGraph {
    pub items: Vec<Item>,
    pub recipes: Vec<Recipe>,
    /// Item indices of limited raw resources, in input order (deduplicated).
    pub scarce_raw_ids: Vec<usize>,
    pub item_index_by_id: HashMap<String, usize>,
    /// Primary producer recipe index per manufactured item index.
    pub producer_by_item: HashMap<usize, usize>,
    /// Recipe indices ordered from raw-adjacent producers to downstream consumers.
    pub topological_recipes: Vec<usize>,
}

fn convert_item(item: &ItemJson) -> Item {
    Item {
        id: item.id.clone(),
        is_raw: item.is_raw,
        is_unlimited: item.is_unlimited,
        is_ingot: item.is_ingot,
    }
}

pub fn validate_recipe_graph(input: &SolverInputJson) -> Result<RecipeGraph, String> {
    let mut issues: Vec<String> = Vec::new();
    let mut item_index_by_id: HashMap<String, usize> = HashMap::new();
    let mut items: Vec<Item> = Vec::new();

    for item in &input.items {
        if item_index_by_id.contains_key(&item.id) {
            issues.push(format!("Duplicate item id: {}", item.id));
        } else {
            let _ = item_index_by_id.insert(item.id.clone(), items.len());
            items.push(convert_item(item));
        }
    }

    let mut scarce_raw_ids: Vec<usize> = Vec::new();
    let mut scarce_set: HashSet<usize> = HashSet::new();
    for item_id in &input.scarce_raw_ids {
        match item_index_by_id.get(item_id) {
            None => issues.push(format!("Scarce resource references unknown item: {item_id}")),
            Some(&index) => {
                let item = &items[index];
                if !item.is_raw || item.is_unlimited {
                    issues.push(format!("Scarce resource must be a limited raw item: {item_id}"));
                } else if scarce_set.insert(index) {
                    scarce_raw_ids.push(index);
                }
            }
        }
    }

    let mut recipe_index_by_id: HashMap<String, usize> = HashMap::new();
    let mut recipes: Vec<Recipe> = Vec::new();
    let mut producer_by_item: HashMap<usize, usize> = HashMap::new();

    let convert_amounts = |amounts: &[crate::data::ItemAmountJson],
                           recipe_id: &str,
                           issues: &mut Vec<String>,
                           item_index_by_id: &HashMap<String, usize>|
     -> Vec<ItemAmount> {
        let mut converted = Vec::with_capacity(amounts.len());
        for amount in amounts {
            let Some(&item) = item_index_by_id.get(&amount.item) else {
                issues.push(format!(
                    "Recipe {recipe_id} references unknown item: {}",
                    amount.item
                ));
                continue;
            };
            match amount.amount.to_rational(&format!("{recipe_id} {}", amount.item)) {
                Ok(value) => {
                    if value <= BigRational::zero() {
                        issues.push(format!(
                            "Recipe {recipe_id} has a non-positive or non-finite amount for {}",
                            amount.item
                        ));
                    } else {
                        converted.push(ItemAmount { item, amount: value });
                    }
                }
                Err(error) => issues.push(error),
            }
        }
        converted
    };

    for recipe in &input.recipes {
        if recipe_index_by_id.contains_key(&recipe.id) {
            issues.push(format!("Duplicate recipe id: {}", recipe.id));
            continue;
        }

        let duration = match recipe.duration_sec.to_rational(&format!("{} duration", recipe.id)) {
            Ok(value) => value,
            Err(error) => {
                issues.push(error);
                continue;
            }
        };
        if duration <= BigRational::zero() {
            issues.push(format!("Recipe {} must have a positive finite duration", recipe.id));
        }
        if recipe.inputs.is_empty() {
            issues.push(format!("Recipe {} must have at least one input", recipe.id));
        }
        if recipe.outputs.len() != 1 {
            issues.push(format!("Recipe {} must have exactly one output", recipe.id));
        }

        let inputs = convert_amounts(&recipe.inputs, &recipe.id, &mut issues, &item_index_by_id);
        let outputs = convert_amounts(&recipe.outputs, &recipe.id, &mut issues, &item_index_by_id);

        let recipe_index = recipes.len();
        let _ = recipe_index_by_id.insert(recipe.id.clone(), recipe_index);
        if let Some(primary) = outputs.first() {
            if let Some(existing) = producer_by_item.get(&primary.item) {
                issues.push(format!(
                    "Item {} has multiple primary producers: {}, {}",
                    items[primary.item].id, recipes[*existing].id, recipe.id
                ));
            } else {
                let _ = producer_by_item.insert(primary.item, recipe_index);
            }
        }
        recipes.push(Recipe {
            id: recipe.id.clone(),
            duration_sec: duration,
            inputs,
            outputs,
        });
    }

    for (index, item) in items.iter().enumerate() {
        if !item.is_raw && !producer_by_item.contains_key(&index) {
            issues.push(format!("Manufactured item has no primary producer: {}", item.id));
        }
    }

    // Kahn topological order over recipe dependencies (producer before consumer).
    let mut indegree: Vec<usize> = vec![0; recipes.len()];
    let mut consumers: Vec<Vec<usize>> = vec![Vec::new(); recipes.len()];
    for (recipe_index, recipe) in recipes.iter().enumerate() {
        let mut dependencies: HashSet<usize> = HashSet::new();
        for input in &recipe.inputs {
            if let Some(&producer) = producer_by_item.get(&input.item) {
                let _ = dependencies.insert(producer);
            }
        }
        indegree[recipe_index] = dependencies.len();
        for dependency in dependencies {
            consumers[dependency].push(recipe_index);
        }
    }
    for consumer_list in &mut consumers {
        consumer_list.sort_unstable();
    }

    let mut ready: Vec<usize> = (0..recipes.len()).filter(|&index| indegree[index] == 0).collect();
    let mut topological_recipes: Vec<usize> = Vec::with_capacity(recipes.len());
    let mut cursor = 0;
    while cursor < ready.len() {
        let recipe_index = ready[cursor];
        cursor += 1;
        topological_recipes.push(recipe_index);
        for &consumer in &consumers[recipe_index] {
            indegree[consumer] -= 1;
            if indegree[consumer] == 0 {
                ready.push(consumer);
            }
        }
    }
    if topological_recipes.len() != recipes.len() {
        let cyclic: Vec<&str> = recipes
            .iter()
            .enumerate()
            .filter(|(index, _)| indegree[*index] > 0)
            .map(|(_, recipe)| recipe.id.as_str())
            .collect();
        issues.push(format!("Recipe graph contains a cycle: {}", cyclic.join(", ")));
    } else {
        let mut scarce_reachable: HashSet<usize> = scarce_set.clone();
        for &recipe_index in &topological_recipes {
            let recipe = &recipes[recipe_index];
            let Some(primary) = recipe.outputs.first() else { continue };
            if recipe.inputs.iter().any(|input| scarce_reachable.contains(&input.item)) {
                let _ = scarce_reachable.insert(primary.item);
            } else {
                issues.push(format!(
                    "Recipe {} has no dependency path to a scarce raw resource",
                    recipe.id
                ));
            }
        }
    }

    if !issues.is_empty() {
        return Err(issues.join("\n"));
    }

    Ok(RecipeGraph {
        items,
        recipes,
        scarce_raw_ids,
        item_index_by_id,
        producer_by_item,
        topological_recipes,
    })
}
