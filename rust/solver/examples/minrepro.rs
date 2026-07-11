//! Minimal reproduction probing Pumpkin behavior on reified mixed-sign
//! linear rows (the routing-device encoding shape).
//! Usage: cargo run --release --example minrepro -- <variant> [groups] [lane_ub]

use std::ops::ControlFlow;

use pumpkin_conflict_resolvers::resolvers::ResolutionResolver;
use pumpkin_core::predicate;
use pumpkin_core::results::SatisfactionResult;
use pumpkin_core::termination::TimeBudget;
use pumpkin_core::variables::TransformableVariable;
use pumpkin_core::Solver;

fn main() {
    let variant = std::env::args().nth(1).unwrap_or_else(|| "full".to_string());
    let groups: usize = std::env::args().nth(2).and_then(|arg| arg.parse().ok()).unwrap_or(30);
    let lane_ub: i32 = std::env::args().nth(3).and_then(|arg| arg.parse().ok()).unwrap_or(200);

    let mut solver = Solver::default();
    let tag = solver.new_constraint_tag();

    for _ in 0..groups {
        let lanes: Vec<_> = (0..5).map(|_| solver.new_bounded_integer(0, lane_ub)).collect();
        let acts: Vec<_> = (0..3)
            .map(|_| {
                let var = solver.new_bounded_integer(0, 1);
                let lit = solver.new_literal_for_predicate(predicate![var >= 1], tag);
                (var, lit)
            })
            .collect();
        let n = solver.new_literal();
        let r = solver.new_bounded_integer(0, 2);

        let mut diff: Vec<_> = acts.iter().map(|(var, _)| var.scaled(1)).collect();
        if variant != "no-lanes" {
            diff.extend(lanes.iter().map(|var| var.scaled(-1)));
        }

        solver
            .add_constraint(pumpkin_constraints::greater_than_or_equals(diff.clone(), 1, tag))
            .implied_by(n)
            .unwrap();
        solver
            .add_constraint(pumpkin_constraints::less_than_or_equals(diff.clone(), 0, tag))
            .implied_by(!n)
            .unwrap();
        solver
            .add_constraint(pumpkin_constraints::equals(vec![r.scaled(1)], 0, tag))
            .implied_by(!n)
            .unwrap();
        if variant == "full" || variant == "no-lanes" {
            let mut ceiling = vec![r.scaled(2)];
            ceiling.extend(diff.iter().map(|view| view.scaled(-1)));
            solver
                .add_constraint(pumpkin_constraints::greater_than_or_equals(ceiling.clone(), 0, tag))
                .implied_by(n)
                .unwrap();
            solver
                .add_constraint(pumpkin_constraints::less_than_or_equals(ceiling, 1, tag))
                .implied_by(n)
                .unwrap();
        }
    }

    let mut termination = TimeBudget::starting_now(std::time::Duration::from_millis(15000));
    let mut brancher = solver.default_brancher();
    let mut resolver = ResolutionResolver::default();
    let started = std::time::Instant::now();
    let result = solver.satisfy(&mut brancher, &mut termination, &mut resolver);
    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
    let _ = ControlFlow::<()>::Continue(());
    match result {
        SatisfactionResult::Satisfiable(_) => println!("{variant}: satisfiable in {elapsed:.1}ms"),
        SatisfactionResult::Unsatisfiable(_, _, _) => {
            println!("{variant}: unsatisfiable in {elapsed:.1}ms")
        }
        SatisfactionResult::Unknown(_, _, _) => println!("{variant}: unknown after {elapsed:.1}ms"),
    }
}
