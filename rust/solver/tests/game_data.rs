//! Tests against the real game data fixture (exported from `src/data/*.ts`
//! via `scripts/export-solver-fixture.mjs`).

use serde_json::{json, Value};

fn game_data() -> Value {
    serde_json::from_str(include_str!("../fixtures/game-data.json")).unwrap()
}

fn solve(value: Value) -> Value {
    let result = satisfactory_exact_solver::solve_json(&value.to_string()).unwrap();
    serde_json::from_str(&result).unwrap()
}

#[test]
fn uses_one_four_machine_five_sixths_quickwire_bank_for_exactly_200_per_minute() {
    let mut input = game_data();
    input["rawAvailability"] = json!({ "caterium-ore": 120 });
    input["targets"] = json!([{ "item": "quickwire", "minimum": 200, "weight": 1 }]);
    input["excess"] = json!([]);
    input["beltCapacity"] = json!(270);

    let result = solve(input);

    assert_eq!(result["proofStatus"], "OPTIMAL");
    assert_eq!(result["targets"][0]["rate"], "200");
    let quickwire_banks: Vec<&Value> = result["selectedBanks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|bank| bank["recipeId"] == "quickwire")
        .collect();
    assert_eq!(quickwire_banks.len(), 1);
    assert_eq!(quickwire_banks[0]["machines"], "4");
    assert_eq!(quickwire_banks[0]["multiplicity"], "1");
    assert_eq!(quickwire_banks[0]["clock"], "5/6");
}

#[test]
fn routes_one_selected_bank_lane_to_exact_backpressured_destinations() {
    let mut input = game_data();
    input["rawAvailability"] = json!({ "iron-ore": 30 });
    input["targets"] = json!([
        { "item": "iron-plate", "minimum": 10, "weight": 0 },
        { "item": "iron-rod", "minimum": 10, "weight": 0 }
    ]);
    input["excess"] = json!([]);
    input["beltCapacity"] = json!(60);

    let result = solve(input);

    assert_eq!(result["proofStatus"], "OPTIMAL");
    assert_eq!(result["feasible"], true);
    // 30 iron ore fully smelted and split between plates and rods.
    let raws = result["raws"].as_array().unwrap();
    let iron = raws.iter().find(|raw| raw["item"] == "iron-ore").unwrap();
    assert_eq!(iron["used"], "30");
    assert_eq!(iron["leftover"], "0");
}
