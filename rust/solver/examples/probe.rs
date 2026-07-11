//! Phase-timing probe. Usage:
//!   cargo run --release --example probe -- quickwire|benchmark [time_limit_ms]

use serde_json::{json, Value};

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let mode = std::env::args().nth(1).unwrap_or_else(|| "quickwire".to_string());
    let time_limit: Option<u64> = std::env::args().nth(2).and_then(|arg| arg.parse().ok());

    let mut input: Value = match mode.as_str() {
        "benchmark" => {
            serde_json::from_str(include_str!("../fixtures/browser-factory-benchmark.json"))
                .unwrap()
        }
        path if path.ends_with(".json") => {
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
        }
        _ => {
            let mut value: Value =
                serde_json::from_str(include_str!("../fixtures/game-data.json")).unwrap();
            value["rawAvailability"] = json!({ "caterium-ore": 120 });
            value["targets"] = json!([{ "item": "quickwire", "minimum": 200, "weight": 1 }]);
            value["excess"] = json!([]);
            value["beltCapacity"] = json!(270);
            value
        }
    };
    if let Some(ms) = time_limit {
        input["timeLimitMs"] = json!(ms);
    }

    if std::env::var("PROBE_SATISFY").is_ok() {
        let input_parsed: satisfactory_exact_solver::data::SolverInputJson =
            serde_json::from_str(&input.to_string()).unwrap();
        let problem = satisfactory_exact_solver::normalize_problem_public(&input_parsed).unwrap();
        let report =
            satisfactory_exact_solver::optimizer::probe_satisfy(&problem, time_limit.unwrap_or(60000))
                .unwrap();
        eprintln!("satisfy probe: {report}");
        return;
    }

    let started = std::time::Instant::now();
    let mut progress = |phase: usize, label: &str, status: &str, phase_ms: Option<f64>| {
        eprintln!(
            "[{:>8.1}ms] phase {phase} {label}: {status}{}",
            started.elapsed().as_secs_f64() * 1000.0,
            phase_ms.map(|ms| format!(" ({ms:.1}ms)")).unwrap_or_default()
        );
    };
    match satisfactory_exact_solver::solve_json_with_progress(&input.to_string(), &mut progress) {
        Ok(result) => {
            let value: Value = serde_json::from_str(&result).unwrap();
            eprintln!(
                "done in {:.1}ms: proofStatus={} objective={}",
                started.elapsed().as_secs_f64() * 1000.0,
                value["proofStatus"],
                value["objective"]
            );
        }
        Err(error) => eprintln!("error: {error}"),
    }
}
