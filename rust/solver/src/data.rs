//! JSON-facing input/output types for the exact production optimizer.

use std::collections::BTreeMap;

use num_rational::BigRational;
use serde::{Deserialize, Serialize};

use crate::rational::parse_rational;

/// Accepts the same value forms as the TypeScript `RationalInput`:
/// decimal/exponent numbers, or `"a/b"` fraction strings.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum RationalJson {
    Number(serde_json::Number),
    Text(String),
}

impl RationalJson {
    pub fn to_rational(&self, label: &str) -> Result<BigRational, String> {
        let text = match self {
            RationalJson::Number(number) => number.to_string(),
            RationalJson::Text(text) => text.clone(),
        };
        parse_rational(&text).map_err(|error| format!("{label}: {error}"))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemJson {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub is_raw: bool,
    #[serde(default)]
    pub is_unlimited: bool,
    #[serde(default)]
    pub is_ingot: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemAmountJson {
    pub item: String,
    pub amount: RationalJson,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeJson {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub duration_sec: RationalJson,
    pub inputs: Vec<ItemAmountJson>,
    pub outputs: Vec<ItemAmountJson>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetJson {
    pub item: String,
    pub minimum: RationalJson,
    pub weight: RationalJson,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcessJson {
    pub item: String,
    pub floor: RationalJson,
}

/// The full optimizer problem, mirroring `ExactOptimizerInput` with the recipe
/// graph inlined so the Rust solver stays game-data agnostic.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverInputJson {
    pub items: Vec<ItemJson>,
    pub recipes: Vec<RecipeJson>,
    pub scarce_raw_ids: Vec<String>,
    #[serde(default)]
    pub raw_availability: BTreeMap<String, RationalJson>,
    #[serde(default)]
    pub targets: Vec<TargetJson>,
    #[serde(default)]
    pub excess: Vec<ExcessJson>,
    pub belt_capacity: RationalJson,
    /// Optional wall-clock budget; the solve reports CANCELLED when exceeded.
    #[serde(default)]
    pub time_limit_ms: Option<u64>,
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedBankJson {
    pub recipe_id: String,
    /// Physical machine count per bank (decimal string).
    pub machines: String,
    /// Clock as an exact fraction string.
    pub clock: String,
    pub multiplicity: String,
    pub effective_machines_per_bank: String,
    pub cycles_per_minute_per_bank: String,
    pub input_rates_per_bank: BTreeMap<String, String>,
    pub output_rates_per_bank: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetRateJson {
    pub item: String,
    pub minimum: String,
    pub weight: String,
    pub rate: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcessRateJson {
    pub item: String,
    pub floor: String,
    pub rate: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawRateJson {
    pub item: String,
    pub unlimited: bool,
    pub available: Option<String>,
    pub used: String,
    pub leftover: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRateJson {
    pub item: String,
    pub produced: String,
    pub consumed: String,
    pub target_withdrawal: String,
    pub excess_withdrawal: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveJson {
    pub scarce_raw_items_per_minute: String,
    pub weighted_target_output: String,
    pub physical_machines: String,
    pub groups: String,
    pub internal_splitter_merger_devices: String,
    pub routing_splitter_devices: String,
    pub total_splitter_merger_devices: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseTimingJson {
    pub phase: usize,
    pub label: String,
    pub phase_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverResultJson {
    pub feasible: bool,
    pub proof_status: String,
    pub selected_banks: Vec<SelectedBankJson>,
    pub targets: Vec<TargetRateJson>,
    pub excess: Vec<ExcessRateJson>,
    pub raws: Vec<RawRateJson>,
    pub items: Vec<ItemRateJson>,
    pub objective: Option<ObjectiveJson>,
    pub phase_timings: Vec<PhaseTimingJson>,
}

/// Progress payload emitted before and after every lexicographic phase.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressJson {
    pub phase: usize,
    pub phase_count: usize,
    pub label: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_ms: Option<f64>,
}
