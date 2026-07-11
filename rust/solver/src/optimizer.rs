//! Exact production optimizer, ported from `src/lib/solver/exact/optimizer.ts`.
//!
//! The CP-SAT backend (Google OR-Tools) is replaced by Pumpkin, a pure-Rust
//! lazy-clause-generation constraint programming solver. The model, the
//! six-phase lexicographic objective hierarchy, and the domain reductions are
//! kept structurally identical to the TypeScript implementation.

use std::collections::BTreeMap;
use std::ops::ControlFlow;

use num_bigint::BigInt;
use num_integer::Integer;
use num_rational::BigRational;
use num_traits::{One, Signed, ToPrimitive, Zero};

use pumpkin_conflict_resolvers::resolvers::ResolutionResolver;
use pumpkin_core::optimisation::linear_sat_unsat::LinearSatUnsat;
use pumpkin_core::optimisation::OptimisationDirection;
use pumpkin_core::predicate;
use pumpkin_core::proof::ConstraintTag;
use pumpkin_core::results::{OptimisationResult, ProblemSolution, Solution, SolutionReference};
use pumpkin_core::termination::{TerminationCondition, TimeBudget};
use pumpkin_core::branching::branchers::autonomous_search::AutonomousSearch;
use pumpkin_core::branching::branchers::dynamic_brancher::DynamicBrancher;
use pumpkin_core::branching::branchers::independent_variable_value_brancher::IndependentVariableValueBrancher;
use pumpkin_core::branching::branchers::warm_start::WarmStart;
use pumpkin_core::branching::value_selection::InDomainMin;
use pumpkin_core::branching::variable_selection::InputOrder;
use pumpkin_core::variables::{AffineView, DomainId, Literal, TransformableVariable};
use pumpkin_core::Solver;

use crate::bounds::{compute_recipe_bounds, RecipeBound};
use crate::graph::RecipeGraph;
use crate::patterns::{equal_lane_tree_devices, generate_machine_bank_patterns, BankPattern};
use crate::rational::{floor_bigint, to_fraction_string};

pub const PHASE_LABELS: [&str; 6] = [
    "scarce raw use",
    "weighted target output",
    "physical machines",
    "groups",
    "total splitter and merger devices",
    "stable bank order",
];

#[derive(Debug, Clone)]
pub struct NormalizedTarget {
    pub item: usize,
    pub minimum: BigRational,
    pub weight: BigRational,
}

#[derive(Debug, Clone)]
pub struct NormalizedExcess {
    pub item: usize,
    pub floor: BigRational,
}

#[derive(Debug, Clone)]
pub struct OptimizerProblem {
    pub graph: RecipeGraph,
    pub raw_availability: BTreeMap<usize, BigRational>,
    pub targets: Vec<NormalizedTarget>,
    pub excess: Vec<NormalizedExcess>,
    pub belt_capacity: BigRational,
    pub time_limit_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProofStatus {
    Optimal,
    Infeasible,
    Cancelled,
}

impl ProofStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProofStatus::Optimal => "OPTIMAL",
            ProofStatus::Infeasible => "INFEASIBLE",
            ProofStatus::Cancelled => "CANCELLED",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SelectedBank {
    pub recipe: usize,
    pub machines: BigInt,
    pub clock: BigRational,
    pub multiplicity: BigInt,
    pub effective_machines_per_bank: BigRational,
    pub cycles_per_minute_per_bank: BigRational,
    pub input_rates_per_bank: BTreeMap<usize, BigRational>,
    pub output_rates_per_bank: BTreeMap<usize, BigRational>,
}

#[derive(Debug, Clone)]
pub struct TargetRate {
    pub item: usize,
    pub minimum: BigRational,
    pub weight: BigRational,
    pub rate: BigRational,
}

#[derive(Debug, Clone)]
pub struct ExcessRate {
    pub item: usize,
    pub floor: BigRational,
    pub rate: BigRational,
}

#[derive(Debug, Clone)]
pub struct RawRate {
    pub item: usize,
    pub unlimited: bool,
    pub available: Option<BigRational>,
    pub used: BigRational,
    pub leftover: Option<BigRational>,
}

#[derive(Debug, Clone)]
pub struct ItemRate {
    pub item: usize,
    pub produced: BigRational,
    pub consumed: BigRational,
    pub target_withdrawal: BigRational,
    pub excess_withdrawal: BigRational,
}

#[derive(Debug, Clone)]
pub struct ObjectiveVector {
    pub scarce_raw_items_per_minute: BigRational,
    pub weighted_target_output: BigRational,
    pub physical_machines: BigInt,
    pub groups: BigInt,
    pub internal_splitter_merger_devices: BigInt,
    pub routing_splitter_devices: BigInt,
    pub total_splitter_merger_devices: BigInt,
}

#[derive(Debug, Clone)]
pub struct OptimizerResult {
    pub feasible: bool,
    pub proof_status: ProofStatus,
    pub selected_banks: Vec<SelectedBank>,
    pub targets: Vec<TargetRate>,
    pub excess: Vec<ExcessRate>,
    pub raws: Vec<RawRate>,
    pub items: Vec<ItemRate>,
    pub objective: Option<ObjectiveVector>,
    pub phase_timings: Vec<(String, f64)>,
}

pub type ProgressCallback<'a> = dyn FnMut(usize, &str, &str, Option<f64>) + 'a;

// ---------------------------------------------------------------------------
// Exact-integer scaling helpers (port of integer-linear.ts, targeting i32)
// ---------------------------------------------------------------------------

fn checked_i32(value: &BigInt, label: &str) -> Result<i32, String> {
    value
        .to_i32()
        .ok_or_else(|| format!("{label} exceeds the CP backend's 32-bit integer range: {value}"))
}

fn denominator_lcm<'a>(values: impl Iterator<Item = &'a BigRational>) -> BigInt {
    let mut result = BigInt::one();
    for value in values {
        result = result.lcm(value.denom());
    }
    result
}

fn exact_integer(value: &BigRational, scale: &BigInt, label: &str) -> Result<BigInt, String> {
    let scaled = value.numer() * scale;
    let (quotient, remainder) = scaled.div_rem(value.denom());
    if !remainder.is_zero() {
        return Err(format!("{label} is not integral at scale {scale}"));
    }
    Ok(quotient)
}

#[derive(Debug, Clone)]
struct RowTerm {
    var: DomainId,
    coefficient: BigRational,
    upper_bound: BigInt,
}

#[derive(Debug)]
struct ScaledRow {
    /// (variable, integer coefficient, variable upper bound).
    terms: Vec<(DomainId, BigInt, BigInt)>,
    /// Multiplier converting the rational row to integers (before reduction).
    scale: BigInt,
    /// Common factor divided out of every coefficient after scaling.
    reduction: BigInt,
    max_absolute_value: BigInt,
}

/// Scales a rational row to integers via the denominator LCM, then divides all
/// coefficients by their GCD (`reduce`) to keep magnitudes inside i32.
fn scale_row(terms: &[RowTerm], reduce: bool, label: &str) -> Result<ScaledRow, String> {
    let scale = denominator_lcm(terms.iter().map(|term| &term.coefficient));
    let mut integer_terms: Vec<(DomainId, BigInt, BigInt)> = Vec::with_capacity(terms.len());
    for term in terms {
        if term.upper_bound < BigInt::zero() {
            return Err(format!("{label} has a negative variable upper bound"));
        }
        let coefficient = exact_integer(&term.coefficient, &scale, label)?;
        integer_terms.push((term.var, coefficient, term.upper_bound.clone()));
    }

    let mut reduction = BigInt::zero();
    if reduce {
        for (_, coefficient, _) in &integer_terms {
            reduction = reduction.gcd(coefficient);
        }
    }
    if reduction.is_zero() || reduction.is_one() {
        reduction = BigInt::one();
    } else {
        for (_, coefficient, _) in &mut integer_terms {
            *coefficient /= &reduction;
        }
    }

    let mut max_absolute_value = BigInt::zero();
    for (_, coefficient, upper_bound) in &integer_terms {
        max_absolute_value += coefficient.abs() * upper_bound;
    }
    Ok(ScaledRow {
        terms: integer_terms,
        scale,
        reduction,
        max_absolute_value,
    })
}

/// Maximum terms per linear row. Longer rows are decomposed into balanced
/// partial-sum trees: lazy clause generation produces one literal per term in
/// a propagator's explanation, so wide rows learn near-useless nogoods
/// (observed average LBD > 150 on the undecomposed model).
const SUM_TREE_ARITY: usize = 4;

/// One term of a row being decomposed: `coefficient * var` where the variable
/// domain is `[lower, upper]`.
#[derive(Debug, Clone)]
struct SumTerm {
    var: DomainId,
    coefficient: BigInt,
    lower: BigInt,
    upper: BigInt,
}

impl SumTerm {
    fn from_scaled(term: &(DomainId, BigInt, BigInt)) -> SumTerm {
        SumTerm {
            var: term.0,
            coefficient: term.1.clone(),
            lower: BigInt::zero(),
            upper: term.2.clone(),
        }
    }

    /// The `[min, max]` range of `coefficient * var`.
    fn contribution(&self) -> (BigInt, BigInt) {
        let at_lower = &self.coefficient * &self.lower;
        let at_upper = &self.coefficient * &self.upper;
        if at_lower <= at_upper { (at_lower, at_upper) } else { (at_upper, at_lower) }
    }
}

fn sum_term_views(terms: &[SumTerm], label: &str) -> Result<Vec<AffineView<DomainId>>, String> {
    let mut views = Vec::with_capacity(terms.len());
    for term in terms {
        if term.coefficient.is_zero() {
            continue;
        }
        let scale = checked_i32(&term.coefficient, &format!("{label} coefficient"))?;
        let (low, high) = term.contribution();
        let _ = checked_i32(&low, &format!("{label} term magnitude"))?;
        let _ = checked_i32(&high, &format!("{label} term magnitude"))?;
        views.push(term.var.scaled(scale));
    }
    Ok(views)
}

/// Exact `[lower, upper]` bounds of `sum(terms)`.
fn sum_term_bounds(terms: &[SumTerm]) -> (BigInt, BigInt) {
    let mut lower = BigInt::zero();
    let mut upper = BigInt::zero();
    for term in terms {
        let (low, high) = term.contribution();
        lower += low;
        upper += high;
    }
    (lower, upper)
}

/// Recursively replaces a wide row by a balanced tree of partial-sum
/// variables, returning at most [`SUM_TREE_ARITY`] top-level terms whose sum
/// equals the sum of the input terms.
fn decompose_sum_terms(
    state: &mut ModelState,
    terms: Vec<SumTerm>,
    label: &str,
) -> Result<Vec<SumTerm>, String> {
    let terms: Vec<SumTerm> =
        terms.into_iter().filter(|term| !term.coefficient.is_zero()).collect();
    if terms.len() <= SUM_TREE_ARITY {
        return Ok(terms);
    }

    let mut parents: Vec<SumTerm> = Vec::new();
    for chunk in terms.chunks(SUM_TREE_ARITY) {
        if chunk.len() == 1 {
            parents.push(chunk[0].clone());
            continue;
        }
        let (lower, upper) = sum_term_bounds(chunk);
        let lower_i32 = checked_i32(&lower, &format!("{label} partial-sum lower bound"))?;
        let upper_i32 = checked_i32(&upper, &format!("{label} partial-sum upper bound"))?;
        if state.stopped() {
            state.build_infeasible = true;
            return Ok(vec![]);
        }
        let partial = state.new_int(lower_i32, upper_i32);
        let mut row = sum_term_views(chunk, label)?;
        row.push(partial.scaled(-1));
        let tag = state.tag;
        state.post(pumpkin_constraints::equals(row, 0, tag));
        parents.push(SumTerm { var: partial, coefficient: BigInt::one(), lower, upper });
    }
    decompose_sum_terms(state, parents, label)
}

fn decompose_terms(
    state: &mut ModelState,
    terms: Vec<(DomainId, BigInt, BigInt)>,
    label: &str,
) -> Result<Vec<SumTerm>, String> {
    let terms: Vec<SumTerm> = terms.iter().map(SumTerm::from_scaled).collect();
    decompose_sum_terms(state, terms, label)
}

/// Materializes a whole row as one integer variable equal to its sum.
/// Returns the variable and its exact bounds.
fn sum_variable(
    state: &mut ModelState,
    terms: Vec<(DomainId, BigInt, BigInt)>,
    label: &str,
) -> Result<SumTerm, String> {
    let top = decompose_terms(state, terms, label)?;
    if top.len() == 1 && top[0].coefficient.is_one() {
        return Ok(top[0].clone());
    }
    let (lower, upper) = sum_term_bounds(&top);
    let lower_i32 = checked_i32(&lower, &format!("{label} sum lower bound"))?;
    let upper_i32 = checked_i32(&upper, &format!("{label} sum upper bound"))?;
    if state.stopped() {
        state.build_infeasible = true;
        let placeholder = state.new_int(0, 0);
        return Ok(SumTerm {
            var: placeholder,
            coefficient: BigInt::one(),
            lower: BigInt::zero(),
            upper: BigInt::zero(),
        });
    }
    let total = state.new_int(lower_i32, upper_i32);
    let mut row = sum_term_views(&top, label)?;
    row.push(total.scaled(-1));
    let tag = state.tag;
    state.post(pumpkin_constraints::equals(row, 0, tag));
    Ok(SumTerm { var: total, coefficient: BigInt::one(), lower, upper })
}

/// Posts `sum(terms) = rhs`, decomposing wide rows first.
fn post_equals_decomposed(
    state: &mut ModelState,
    terms: Vec<(DomainId, BigInt, BigInt)>,
    rhs: i32,
    label: &str,
) -> Result<(), String> {
    let top = decompose_terms(state, terms, label)?;
    if state.stopped() {
        state.build_infeasible = true;
        return Ok(());
    }
    let views = sum_term_views(&top, label)?;
    if views.is_empty() {
        if rhs != 0 {
            state.build_infeasible = true;
        }
        return Ok(());
    }
    let tag = state.tag;
    state.post(pumpkin_constraints::equals(views, rhs, tag));
    Ok(())
}

// ---------------------------------------------------------------------------
// Model state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct PatternVariable {
    pattern: BankPattern,
    var: DomainId,
    upper_bound: BigInt,
    symmetry_upper_bound: BigInt,
    order: usize,
}

#[derive(Debug, Clone)]
struct ProductionVariable {
    pattern: BankPattern,
    var: DomainId,
    upper_bound: BigInt,
}

#[derive(Debug, Clone)]
struct WithdrawalVariable {
    var: DomainId,
    scale: BigInt,
    upper_bound: BigInt,
}

#[derive(Debug, Clone)]
struct RoutingVariable {
    var: DomainId,
    upper_bound: BigInt,
}

struct Objective {
    label: &'static str,
    maximize: bool,
    var: DomainId,
    /// True objective value = solver value * reduction / scale.
    scale: BigInt,
    reduction: BigInt,
}

struct ModelState {
    solver: Solver,
    tag: ConstraintTag,
    production: Vec<ProductionVariable>,
    patterns: Vec<PatternVariable>,
    target_variables: BTreeMap<usize, WithdrawalVariable>,
    excess_variables: BTreeMap<usize, WithdrawalVariable>,
    routing_variables: Vec<RoutingVariable>,
    objectives: Vec<Objective>,
    /// Every integer variable, in creation order (used by the backup brancher).
    int_vars: Vec<DomainId>,
    /// Per-recipe `production - banks` effective-machine totals, prepared at
    /// build time and pinned to zero after the weighted-target phase.
    /// Pumpkin cannot soundly create variables once search has started, so
    /// the sum trees must exist before the first solve.
    bank_link_totals: Vec<DomainId>,
    /// Set when the model is provably infeasible during construction.
    build_infeasible: bool,
}

impl ModelState {
    fn new_int(&mut self, lower_bound: i32, upper_bound: i32) -> DomainId {
        let var = self.solver.new_bounded_integer(lower_bound, upper_bound);
        self.int_vars.push(var);
        var
    }

    /// Whether construction should stop: further variable creation panics in
    /// Pumpkin once the solver is in a root-level conflict.
    fn stopped(&self) -> bool {
        self.build_infeasible || self.solver.is_inconsistent()
    }

    fn post(
        &mut self,
        constraint: impl pumpkin_core::constraints::NegatableConstraint,
    ) {
        if self.stopped() {
            self.build_infeasible = true;
            return;
        }
        if self.solver.add_constraint(constraint).post().is_err() {
            self.build_infeasible = true;
        }
    }

    fn post_implied(
        &mut self,
        constraint: impl pumpkin_core::constraints::NegatableConstraint,
        literal: Literal,
    ) {
        if self.stopped() {
            self.build_infeasible = true;
            return;
        }
        if self
            .solver
            .add_constraint(constraint)
            .implied_by(literal)
            .is_err()
        {
            self.build_infeasible = true;
        }
    }
}

fn pattern_rate(pattern: &BankPattern, item: usize, input: bool) -> BigRational {
    let rates = if input { &pattern.input_rates } else { &pattern.output_rates };
    rates
        .iter()
        .filter(|(rate_item, _)| *rate_item == item)
        .fold(BigRational::zero(), |total, (_, rate)| total + rate)
}

fn internal_devices(pattern: &BankPattern, input_count: usize) -> BigInt {
    equal_lane_tree_devices(&pattern.machines) * BigInt::from(input_count as u64 + 1)
}

/// Removes strict single-bank dominance: equal effective production with fewer
/// physical machines wins (see optimizer.ts `removeDominatedPatterns`).
fn remove_dominated_patterns(patterns: Vec<BankPattern>) -> Vec<BankPattern> {
    let mut best_by_rate: BTreeMap<String, usize> = BTreeMap::new();
    for (index, pattern) in patterns.iter().enumerate() {
        let key = to_fraction_string(&pattern.effective_machines);
        match best_by_rate.get(&key) {
            Some(&existing) if patterns[existing].machines <= pattern.machines => {}
            _ => {
                let _ = best_by_rate.insert(key, index);
            }
        }
    }
    patterns
        .into_iter()
        .enumerate()
        .filter(|(index, pattern)| {
            best_by_rate.get(&to_fraction_string(&pattern.effective_machines)) == Some(index)
        })
        .map(|(_, pattern)| pattern)
        .collect()
}

/// Bounds interchangeable copies of a smaller bank
/// (see optimizer.ts `tightenMultiplicityBound`).
fn tighten_multiplicity_bound(
    entry_index: usize,
    bounded: &[(BankPattern, BigInt)],
) -> BigInt {
    let (entry_pattern, entry_upper) = &bounded[entry_index];
    let mut upper_bound = entry_upper.clone();
    for (replacement_index, (replacement, _)) in bounded.iter().enumerate() {
        if replacement_index == entry_index {
            continue;
        }
        let ratio = replacement.effective_machines.clone() / entry_pattern.effective_machines.clone();
        if !ratio.denom().is_one() {
            continue;
        }
        let copies = ratio.to_integer();
        if copies <= BigInt::one() {
            continue;
        }
        if replacement.machines > entry_pattern.machines.clone() * &copies {
            continue;
        }
        let canonical_upper_bound = &copies - BigInt::one();
        if canonical_upper_bound < upper_bound {
            upper_bound = canonical_upper_bound;
        }
    }
    upper_bound
}

fn create_pattern_variables(
    problem: &OptimizerProblem,
    bounds: &BTreeMap<usize, RecipeBound>,
    state: &mut ModelState,
) -> Result<(), String> {
    let mut order = 0usize;
    for &recipe_index in &problem.graph.topological_recipes {
        let bound = bounds
            .get(&recipe_index)
            .ok_or_else(|| format!("Missing exact recipe bound: {recipe_index}"))?;
        let generated = generate_machine_bank_patterns(&problem.graph, bound, &problem.belt_capacity);
        let non_dominated = remove_dominated_patterns(generated);
        let bounded: Vec<(BankPattern, BigInt)> = non_dominated
            .into_iter()
            .filter_map(|pattern| {
                let upper_bound = floor_bigint(
                    &(bound.max_effective_machines.clone() / pattern.effective_machines.clone()),
                );
                (upper_bound > BigInt::zero()).then_some((pattern, upper_bound))
            })
            .collect();
        for entry_index in 0..bounded.len() {
            let symmetry_upper_bound = tighten_multiplicity_bound(entry_index, &bounded);
            let (pattern, upper_bound) = bounded[entry_index].clone();
            let recipe_id = &problem.graph.recipes[recipe_index].id;
            let safe_upper = checked_i32(
                &upper_bound,
                &format!(
                    "{recipe_id} {}@{} multiplicity bound",
                    pattern.machines,
                    to_fraction_string(&pattern.clock)
                ),
            )?;
            let var = state.new_int(0, safe_upper);
            state.patterns.push(PatternVariable {
                pattern,
                var,
                upper_bound,
                symmetry_upper_bound,
                order,
            });
            order += 1;
        }
    }
    Ok(())
}

fn create_production_variables(
    problem: &OptimizerProblem,
    bounds: &BTreeMap<usize, RecipeBound>,
    state: &mut ModelState,
) -> Result<(), String> {
    for &recipe_index in &problem.graph.topological_recipes {
        let bound = bounds
            .get(&recipe_index)
            .ok_or_else(|| format!("Missing exact recipe bound: {recipe_index}"))?;
        let mut one_machine: Vec<BankPattern> =
            generate_machine_bank_patterns(&problem.graph, bound, &problem.belt_capacity)
                .into_iter()
                .filter(|pattern| pattern.machines.is_one())
                .collect();
        one_machine.sort_by(|left, right| left.effective_machines.cmp(&right.effective_machines));

        let mut generators: Vec<BankPattern> = Vec::new();
        for pattern in one_machine {
            let redundant = generators.iter().any(|generator| {
                (pattern.effective_machines.clone() / generator.effective_machines.clone())
                    .denom()
                    .is_one()
            });
            if !redundant {
                generators.push(pattern);
            }
        }

        for pattern in generators {
            let upper_bound = floor_bigint(
                &(bound.max_effective_machines.clone() / pattern.effective_machines.clone()),
            );
            if upper_bound <= BigInt::zero() {
                continue;
            }
            let recipe_id = &problem.graph.recipes[recipe_index].id;
            let safe_upper = checked_i32(
                &upper_bound,
                &format!("{recipe_id} production-rate multiplicity bound"),
            )?;
            let var = state.new_int(0, safe_upper);
            state.production.push(ProductionVariable { pattern, var, upper_bound });
        }
    }
    Ok(())
}

fn add_raw_constraints(problem: &OptimizerProblem, state: &mut ModelState) -> Result<(), String> {
    for &item in &problem.graph.scarce_raw_ids {
        let available = problem
            .raw_availability
            .get(&item)
            .cloned()
            .unwrap_or_else(BigRational::zero);
        let item_id = &problem.graph.items[item].id;
        let consuming: Vec<RowTerm> = state
            .production
            .iter()
            .filter_map(|entry| {
                let rate = pattern_rate(&entry.pattern, item, true);
                (!rate.is_zero()).then_some(RowTerm {
                    var: entry.var,
                    coefficient: rate,
                    upper_bound: entry.upper_bound.clone(),
                })
            })
            .collect();

        let scale = {
            let mut lcm = denominator_lcm(consuming.iter().map(|term| &term.coefficient));
            lcm = lcm.lcm(available.denom());
            lcm
        };
        let mut integer_terms: Vec<(DomainId, BigInt, BigInt)> = Vec::new();
        for term in &consuming {
            let coefficient =
                exact_integer(&term.coefficient, &scale, &format!("{item_id} raw coefficient"))?;
            integer_terms.push((term.var, coefficient, term.upper_bound.clone()));
        }
        let mut upper_bound = exact_integer(&available, &scale, &format!("{item_id} raw availability"))?;

        // GCD reduction keeps coefficient magnitudes inside i32; flooring the
        // right-hand side is exact for a <= row over integer variables.
        let mut reduction = BigInt::zero();
        for (_, coefficient, _) in &integer_terms {
            reduction = reduction.gcd(coefficient);
        }
        if reduction > BigInt::one() {
            for (_, coefficient, _) in &mut integer_terms {
                *coefficient /= &reduction;
            }
            upper_bound = upper_bound.div_floor(&reduction);
        }

        let top = decompose_terms(state, integer_terms, &format!("{item_id} raw row"))?;
        let views = sum_term_views(&top, &format!("{item_id} raw row"))?;
        if views.is_empty() {
            if upper_bound < BigInt::zero() {
                state.build_infeasible = true;
            }
            continue;
        }
        let rhs = checked_i32(&upper_bound, &format!("{item_id} scaled raw availability"))?;
        let tag = state.tag;
        state.post(pumpkin_constraints::less_than_or_equals(views, rhs, tag));
    }
    Ok(())
}

fn add_conservation_rows(problem: &OptimizerProblem, state: &mut ModelState) -> Result<(), String> {
    let target_by_item: BTreeMap<usize, &NormalizedTarget> =
        problem.targets.iter().map(|target| (target.item, target)).collect();
    let floor_by_item: BTreeMap<usize, &BigRational> =
        problem.excess.iter().map(|entry| (entry.item, &entry.floor)).collect();

    for (item_index, item) in problem.graph.items.iter().enumerate() {
        if item.is_raw {
            continue;
        }
        if state.stopped() {
            state.build_infeasible = true;
            return Ok(());
        }
        let item_id = &item.id;
        let pattern_terms: Vec<RowTerm> = state
            .production
            .iter()
            .filter_map(|entry| {
                let rate = pattern_rate(&entry.pattern, item_index, false)
                    - pattern_rate(&entry.pattern, item_index, true);
                (!rate.is_zero()).then_some(RowTerm {
                    var: entry.var,
                    coefficient: rate,
                    upper_bound: entry.upper_bound.clone(),
                })
            })
            .collect();
        let target = target_by_item.get(&item_index);
        let floor = floor_by_item
            .get(&item_index)
            .map(|floor| (*floor).clone())
            .unwrap_or_else(BigRational::zero);

        let mut scale = denominator_lcm(pattern_terms.iter().map(|term| &term.coefficient));
        if let Some(target) = target {
            scale = scale.lcm(target.minimum.denom());
        }
        scale = scale.lcm(floor.denom());

        let mut integer_terms: Vec<(DomainId, BigInt, BigInt)> = Vec::new();
        let mut maximum_produced = BigInt::zero();
        for term in &pattern_terms {
            let coefficient = exact_integer(
                &term.coefficient,
                &scale,
                &format!("{item_id} conservation coefficient"),
            )?;
            if coefficient > BigInt::zero() {
                maximum_produced += &coefficient * &term.upper_bound;
            }
            integer_terms.push((term.var, coefficient, term.upper_bound.clone()));
        }

        if let Some(target) = target {
            let lower_bound =
                exact_integer(&target.minimum, &scale, &format!("{item_id} target minimum"))?;
            let upper_bound = if lower_bound > maximum_produced {
                state.build_infeasible = true;
                lower_bound.clone()
            } else {
                maximum_produced.clone()
            };
            let var = state.new_int(
                checked_i32(&lower_bound, &format!("{item_id} target minimum"))?,
                checked_i32(&upper_bound, &format!("{item_id} target upper bound"))?,
            );
            let _ = state.target_variables.insert(
                item_index,
                WithdrawalVariable { var, scale: scale.clone(), upper_bound: upper_bound.clone() },
            );
            integer_terms.push((var, -BigInt::one(), upper_bound));
        }
        if !item.is_ingot {
            let lower_bound = exact_integer(&floor, &scale, &format!("{item_id} excess floor"))?;
            let upper_bound = if lower_bound > maximum_produced {
                state.build_infeasible = true;
                lower_bound.clone()
            } else {
                maximum_produced.clone()
            };
            let var = state.new_int(
                checked_i32(&lower_bound, &format!("{item_id} excess floor"))?,
                checked_i32(&upper_bound, &format!("{item_id} excess upper bound"))?,
            );
            let _ = state.excess_variables.insert(
                item_index,
                WithdrawalVariable { var, scale: scale.clone(), upper_bound: upper_bound.clone() },
            );
            integer_terms.push((var, -BigInt::one(), upper_bound));
        }

        post_equals_decomposed(state, integer_terms, 0, &format!("{item_id} conservation row"))?;
    }
    Ok(())
}

/// Creates a 0/1 integer variable together with a literal that is true exactly
/// when the variable is 1 (activity indicator usable in arithmetic rows).
fn new_activity(state: &mut ModelState) -> (DomainId, Literal) {
    let var = state.new_int(0, 1);
    let tag = state.tag;
    let literal = state.solver.new_literal_for_predicate(predicate![var >= 1], tag);
    (var, literal)
}

/// Constrains `var >= 1` when the activity is true and `var = 0` otherwise.
fn add_positive_activity(
    state: &mut ModelState,
    var: DomainId,
    upper_bound: &BigInt,
    label: &str,
) -> Result<(DomainId, Literal), String> {
    let (activity_var, activity_literal) = new_activity(state);
    let tag = state.tag;
    if upper_bound.is_zero() {
        state.post(pumpkin_constraints::equals(vec![activity_var.scaled(1)], 0, tag));
        return Ok((activity_var, activity_literal));
    }
    let _ = checked_i32(upper_bound, &format!("{label} activity upper bound"))?;
    state.post_implied(
        pumpkin_constraints::greater_than_or_equals(vec![var.scaled(1)], 1, tag),
        activity_literal,
    );
    state.post_implied(pumpkin_constraints::equals(vec![var.scaled(1)], 0, tag), !activity_literal);
    Ok((activity_var, activity_literal))
}

fn add_routing_variables(problem: &OptimizerProblem, state: &mut ModelState) -> Result<(), String> {
    let tag = state.tag;

    // Recipe activity: at least one selected bank of the recipe. The selected
    // bank count is materialized once per recipe and reused for routing.
    let mut recipe_activities: BTreeMap<usize, DomainId> = BTreeMap::new();
    let mut recipe_lane_sums: BTreeMap<usize, (DomainId, BigInt)> = BTreeMap::new();
    for (recipe_index, recipe) in problem.graph.recipes.iter().enumerate() {
        if state.stopped() {
            state.build_infeasible = true;
            return Ok(());
        }
        let recipe_patterns: Vec<(DomainId, BigInt, BigInt)> = state
            .patterns
            .iter()
            .filter(|entry| entry.pattern.recipe == recipe_index)
            .map(|entry| (entry.var, BigInt::one(), entry.upper_bound.clone()))
            .collect();
        let (activity_var, activity_literal) = new_activity(state);
        let lane_upper: BigInt = recipe_patterns.iter().map(|(_, _, ub)| ub.clone()).sum();
        if lane_upper.is_zero() {
            state.post(pumpkin_constraints::equals(vec![activity_var.scaled(1)], 0, tag));
        } else {
            let _ = checked_i32(&lane_upper, &format!("{} selected-bank upper bound", recipe.id))?;
            let label = format!("{} selected-bank sum", recipe.id);
            let lane_total = sum_variable(state, recipe_patterns, &label)?.var;
            state.post_implied(
                pumpkin_constraints::greater_than_or_equals(vec![lane_total.scaled(1)], 1, tag),
                activity_literal,
            );
            state.post_implied(
                pumpkin_constraints::equals(vec![lane_total.scaled(1)], 0, tag),
                !activity_literal,
            );
            let _ = recipe_lane_sums.insert(recipe_index, (lane_total, lane_upper));
        }
        let _ = recipe_activities.insert(recipe_index, activity_var);
    }

    // Positive target / excess withdrawal activities.
    let mut target_activities: BTreeMap<usize, DomainId> = BTreeMap::new();
    let target_entries: Vec<(usize, DomainId, BigInt)> = state
        .target_variables
        .iter()
        .map(|(item, withdrawal)| (*item, withdrawal.var, withdrawal.upper_bound.clone()))
        .collect();
    for (item, var, upper_bound) in target_entries {
        if state.stopped() {
            state.build_infeasible = true;
            return Ok(());
        }
        let label = format!("target_active_{}", problem.graph.items[item].id);
        let (activity_var, _) = add_positive_activity(state, var, &upper_bound, &label)?;
        let _ = target_activities.insert(item, activity_var);
    }
    let mut excess_activities: BTreeMap<usize, DomainId> = BTreeMap::new();
    let excess_entries: Vec<(usize, DomainId, BigInt)> = state
        .excess_variables
        .iter()
        .map(|(item, withdrawal)| (*item, withdrawal.var, withdrawal.upper_bound.clone()))
        .collect();
    for (item, var, upper_bound) in excess_entries {
        if state.stopped() {
            state.build_infeasible = true;
            return Ok(());
        }
        let label = format!("excess_active_{}", problem.graph.items[item].id);
        let (activity_var, _) = add_positive_activity(state, var, &upper_bound, &label)?;
        let _ = excess_activities.insert(item, activity_var);
    }

    // Routing devices per manufactured item:
    // max(0, ceil((active destinations - output lanes) / 2)).
    for (item_index, item) in problem.graph.items.iter().enumerate() {
        if item.is_raw {
            continue;
        }
        if state.stopped() {
            state.build_infeasible = true;
            return Ok(());
        }
        let item_id = &item.id;
        let producer = *problem
            .producer(item_index)
            .ok_or_else(|| format!("Missing producer for routed item: {item_id}"))?;
        let producer_lanes = recipe_lane_sums.get(&producer).cloned();

        let mut destinations: Vec<DomainId> = Vec::new();
        for (recipe_index, recipe) in problem.graph.recipes.iter().enumerate() {
            if recipe.inputs.iter().any(|input| input.item == item_index) {
                destinations.push(
                    *recipe_activities
                        .get(&recipe_index)
                        .ok_or_else(|| format!("Missing activity variable for recipe: {}", recipe.id))?,
                );
            }
        }
        if let Some(activity) = target_activities.get(&item_index) {
            destinations.push(*activity);
        }
        if let Some(activity) = excess_activities.get(&item_index) {
            destinations.push(*activity);
        }

        let destination_upper = BigInt::from(destinations.len() as u64);
        let routing_upper = (&destination_upper + BigInt::one()) / BigInt::from(2);
        let routing_var = state.new_int(
            0,
            checked_i32(&routing_upper, &format!("{item_id} routing-device upper bound"))?,
        );
        let routing_needed = state.solver.new_literal();
        if destination_upper.is_zero() {
            state.post(pumpkin_constraints::equals(vec![routing_var.scaled(1)], 0, tag));
            let false_clause =
                state.solver.add_clause([(!routing_needed).get_true_predicate()], tag);
            if false_clause.is_err() {
                state.build_infeasible = true;
            }
        } else {
            // Long reified rows with mixed-sign coefficients learn near-useless
            // nogoods under lazy clause generation, so the destination and lane
            // sums are materialized as auxiliary variables and every reified
            // row stays at <= 3 terms.
            let destination_rhs =
                checked_i32(&destination_upper, &format!("{item_id} destination upper bound"))?;
            let destination_terms: Vec<(DomainId, BigInt, BigInt)> = destinations
                .iter()
                .map(|var| (*var, BigInt::one(), BigInt::one()))
                .collect();
            let destination_sum =
                sum_variable(state, destination_terms, &format!("{item_id} destination sum"))?.var;

            let difference: Vec<AffineView<DomainId>> = match &producer_lanes {
                Some((lane_total, _)) => {
                    vec![destination_sum.scaled(1), lane_total.scaled(-1)]
                }
                None => vec![destination_sum.scaled(1)],
            };

            // routing_needed -> 1 <= difference <= destinations
            state.post_implied(
                pumpkin_constraints::greater_than_or_equals(difference.clone(), 1, tag),
                routing_needed,
            );
            state.post_implied(
                pumpkin_constraints::less_than_or_equals(difference.clone(), destination_rhs, tag),
                routing_needed,
            );
            // !routing_needed -> difference <= 0
            state.post_implied(
                pumpkin_constraints::less_than_or_equals(difference.clone(), 0, tag),
                !routing_needed,
            );
            // !routing_needed -> routing = 0
            state.post_implied(
                pumpkin_constraints::equals(vec![routing_var.scaled(1)], 0, tag),
                !routing_needed,
            );
            // routing_needed -> 0 <= 2 * routing - difference <= 1
            let mut ceiling: Vec<AffineView<DomainId>> =
                vec![routing_var.scaled(2), destination_sum.scaled(-1)];
            if let Some((lane_total, _)) = &producer_lanes {
                ceiling.push(lane_total.scaled(1));
            }
            state.post_implied(
                pumpkin_constraints::greater_than_or_equals(ceiling.clone(), 0, tag),
                routing_needed,
            );
            state.post_implied(pumpkin_constraints::less_than_or_equals(ceiling, 1, tag), routing_needed);
        }
        state
            .routing_variables
            .push(RoutingVariable { var: routing_var, upper_bound: routing_upper });
    }
    Ok(())
}

impl OptimizerProblem {
    fn producer(&self, item: usize) -> Option<&usize> {
        self.graph.producer_by_item.get(&item)
    }
}

fn build_objectives(problem: &OptimizerProblem, state: &mut ModelState) -> Result<(), String> {
    let scarce_set: std::collections::HashSet<usize> =
        problem.graph.scarce_raw_ids.iter().copied().collect();

    let scarce_raw_terms: Vec<RowTerm> = state
        .production
        .iter()
        .map(|entry| {
            let rate = entry
                .pattern
                .input_rates
                .iter()
                .filter(|(item, _)| scarce_set.contains(item))
                .fold(BigRational::zero(), |total, (_, rate)| total + rate);
            RowTerm { var: entry.var, coefficient: rate, upper_bound: entry.upper_bound.clone() }
        })
        .collect();

    let mut weighted_target_terms: Vec<RowTerm> = Vec::new();
    for target in &problem.targets {
        let withdrawal = state
            .target_variables
            .get(&target.item)
            .ok_or_else(|| format!("Missing target variable: {}", problem.graph.items[target.item].id))?;
        weighted_target_terms.push(RowTerm {
            var: withdrawal.var,
            coefficient: target.weight.clone()
                / BigRational::from_integer(withdrawal.scale.clone()),
            upper_bound: withdrawal.upper_bound.clone(),
        });
    }

    let machine_terms: Vec<RowTerm> = state
        .patterns
        .iter()
        .map(|entry| RowTerm {
            var: entry.var,
            coefficient: BigRational::from_integer(entry.pattern.machines.clone()),
            upper_bound: entry.upper_bound.clone(),
        })
        .collect();
    let group_terms: Vec<RowTerm> = state
        .patterns
        .iter()
        .map(|entry| RowTerm {
            var: entry.var,
            coefficient: BigRational::one(),
            upper_bound: entry.upper_bound.clone(),
        })
        .collect();
    let mut device_terms: Vec<RowTerm> = state
        .patterns
        .iter()
        .map(|entry| {
            let input_count = problem.graph.recipes[entry.pattern.recipe].inputs.len();
            RowTerm {
                var: entry.var,
                coefficient: BigRational::from_integer(internal_devices(&entry.pattern, input_count)),
                upper_bound: entry.upper_bound.clone(),
            }
        })
        .collect();
    device_terms.extend(state.routing_variables.iter().map(|entry| RowTerm {
        var: entry.var,
        coefficient: BigRational::one(),
        upper_bound: entry.upper_bound.clone(),
    }));
    let stable_terms: Vec<RowTerm> = state
        .patterns
        .iter()
        .map(|entry| RowTerm {
            var: entry.var,
            coefficient: BigRational::from_integer(BigInt::from(entry.order as u64 + 1)),
            upper_bound: entry.upper_bound.clone(),
        })
        .collect();

    let phases: [(&'static str, bool, Vec<RowTerm>); 6] = [
        (PHASE_LABELS[0], true, scarce_raw_terms),
        (PHASE_LABELS[1], true, weighted_target_terms),
        (PHASE_LABELS[2], false, machine_terms),
        (PHASE_LABELS[3], false, group_terms),
        (PHASE_LABELS[4], false, device_terms),
        (PHASE_LABELS[5], false, stable_terms),
    ];

    for (label, maximize, terms) in phases {
        let row = scale_row(&terms, true, label)?;
        let upper = checked_i32(&row.max_absolute_value, &format!("{label} maximum absolute value"))?;
        let objective_var = state.new_int(0, upper);
        let mut top = decompose_terms(state, row.terms, label)?;
        top.push(SumTerm {
            var: objective_var,
            coefficient: -BigInt::one(),
            lower: BigInt::zero(),
            upper: row.max_absolute_value.clone(),
        });
        let views = sum_term_views(&top, label)?;
        let tag = state.tag;
        state.post(pumpkin_constraints::equals(views, 0, tag));
        state.objectives.push(Objective {
            label,
            maximize,
            var: objective_var,
            scale: row.scale,
            reduction: row.reduction,
        });
    }
    Ok(())
}

/// Builds one `production - banks` effective-machine total per recipe as a
/// sum tree at model-construction time. The totals stay unconstrained until
/// [`add_bank_representation_links`] pins them to zero after phase 2.
fn prepare_bank_link_totals(problem: &OptimizerProblem, state: &mut ModelState) -> Result<(), String> {
    let recipe_indices: std::collections::BTreeSet<usize> =
        state.production.iter().map(|entry| entry.pattern.recipe).collect();
    for recipe_index in recipe_indices {
        if state.stopped() {
            state.build_infeasible = true;
            return Ok(());
        }
        let recipe_id = &problem.graph.recipes[recipe_index].id;
        let mut terms: Vec<RowTerm> = Vec::new();
        for entry in state.production.iter().filter(|entry| entry.pattern.recipe == recipe_index) {
            terms.push(RowTerm {
                var: entry.var,
                coefficient: entry.pattern.effective_machines.clone(),
                upper_bound: entry.upper_bound.clone(),
            });
        }
        for entry in state.patterns.iter().filter(|entry| entry.pattern.recipe == recipe_index) {
            terms.push(RowTerm {
                var: entry.var,
                coefficient: -entry.pattern.effective_machines.clone(),
                upper_bound: entry.upper_bound.clone(),
            });
        }
        let label = format!("{recipe_id} bank link");
        let row = scale_row(&terms, true, &label)?;
        if row.terms.is_empty() {
            continue;
        }
        let total = sum_variable(state, row.terms, &label)?;
        state.bank_link_totals.push(total.var);
    }
    Ok(())
}

/// After the weighted-target phase, requires every recipe's selected banks to
/// represent exactly the compact production rates (optimizer.ts
/// `addBankRepresentationLinks`).
fn add_bank_representation_links(state: &mut ModelState) {
    let tag = state.tag;
    let totals = state.bank_link_totals.clone();
    for total in totals {
        state.post(pumpkin_constraints::equals(vec![total.scaled(1)], 0, tag));
    }
}

fn tighten_pattern_domains(state: &mut ModelState, physical_machine_optimum: &BigInt) -> Result<(), String> {
    let tag = state.tag;
    let updates: Vec<(DomainId, BigInt)> = state
        .patterns
        .iter()
        .map(|pattern| {
            let physical_upper = physical_machine_optimum / &pattern.pattern.machines;
            let upper = if pattern.symmetry_upper_bound < physical_upper {
                pattern.symmetry_upper_bound.clone()
            } else {
                physical_upper
            };
            (pattern.var, upper)
        })
        .collect();
    for (var, upper) in updates {
        let rhs = checked_i32(&upper, "post-machine multiplicity upper bound")?;
        state.post(pumpkin_constraints::less_than_or_equals(vec![var.scaled(1)], rhs, tag));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Lexicographic solve
// ---------------------------------------------------------------------------

/// Deterministic search strategy: VSIDS-style autonomous search with an
/// input-order / smallest-value backup brancher. The default backup (random
/// selector + random splitter) explores huge bank-multiplicity domains
/// aimlessly on this model; assigning lower bounds first reaches feasible
/// solutions immediately.
type SearchBrancher =
    AutonomousSearch<IndependentVariableValueBrancher<DomainId, InputOrder<DomainId>, InDomainMin>>;

fn search_brancher(state: &ModelState) -> SearchBrancher {
    AutonomousSearch::new(IndependentVariableValueBrancher::new(
        InputOrder::new(&state.int_vars),
        InDomainMin,
    ))
}

/// Combines an optional warm-start hint (the analog of CP-SAT solution hints
/// used by optimizer.ts between phases) with the standard search strategy.
fn phase_brancher(state: &ModelState, hint: &[(DomainId, i32)]) -> DynamicBrancher {
    let variables: Vec<DomainId> = hint.iter().map(|(var, _)| *var).collect();
    let values: Vec<i32> = hint.iter().map(|(_, value)| *value).collect();
    DynamicBrancher::new(vec![
        Box::new(WarmStart::new(&variables, &values)),
        Box::new(search_brancher(state)),
    ])
}

/// Full previous-solution hint (optimizer.ts `installCompleteSolutionHint`).
fn complete_solution_hint(state: &ModelState, solution: &Solution) -> Vec<(DomainId, i32)> {
    state
        .int_vars
        .iter()
        .map(|&var| (var, solution.get_integer_value(var)))
        .collect()
}

/// Maps the compact production solution onto one-machine banks
/// (optimizer.ts `installInitialBankHint`), used for the physical-machine
/// phase right after the bank representation links are added.
fn initial_bank_hint(state: &ModelState, solution: &Solution) -> Result<Vec<(DomainId, i32)>, String> {
    let mut bank_values: BTreeMap<usize, i32> = BTreeMap::new();
    for (pattern_index, entry) in state.patterns.iter().enumerate() {
        if entry.pattern.machines.is_one() {
            let _ = bank_values.insert(pattern_index, 0);
        }
    }
    for entry in &state.production {
        let value = solution.get_integer_value(entry.var);
        let bank_index = state
            .patterns
            .iter()
            .position(|candidate| {
                candidate.pattern.recipe == entry.pattern.recipe
                    && candidate.pattern.machines.is_one()
                    && candidate.pattern.effective_machines == entry.pattern.effective_machines
            })
            .ok_or("Missing one-machine bank representation for production hint")?;
        let slot = bank_values.entry(bank_index).or_insert(0);
        *slot += value;
    }

    let mut hint: Vec<(DomainId, i32)> = Vec::new();
    for entry in &state.production {
        hint.push((entry.var, solution.get_integer_value(entry.var)));
    }
    for (pattern_index, entry) in state.patterns.iter().enumerate() {
        hint.push((entry.var, bank_values.get(&pattern_index).copied().unwrap_or(0)));
    }
    for withdrawal in state.target_variables.values().chain(state.excess_variables.values()) {
        hint.push((withdrawal.var, solution.get_integer_value(withdrawal.var)));
    }
    Ok(hint)
}

/// Rewrites the bank solution into its canonical symmetry representative
/// (optimizer.ts `installCanonicalBankHint`), used for the group phase right
/// after the post-machine domain reductions.
fn canonical_bank_hint(state: &ModelState, solution: &Solution) -> Result<Vec<(DomainId, i32)>, String> {
    let mut bank_values: BTreeMap<usize, i64> = BTreeMap::new();
    for (pattern_index, entry) in state.patterns.iter().enumerate() {
        let _ = bank_values.insert(pattern_index, i64::from(solution.get_integer_value(entry.var)));
    }
    let mut ascending: Vec<usize> = (0..state.patterns.len()).collect();
    ascending.sort_by(|&left, &right| {
        state.patterns[left]
            .pattern
            .effective_machines
            .cmp(&state.patterns[right].pattern.effective_machines)
    });
    for pattern_index in ascending {
        let entry = &state.patterns[pattern_index];
        if entry.symmetry_upper_bound >= entry.upper_bound {
            continue;
        }
        let copies = &entry.symmetry_upper_bound + BigInt::one();
        let replacement_effective = entry.pattern.effective_machines.clone()
            * BigRational::from_integer(copies.clone());
        let replacement = state
            .patterns
            .iter()
            .position(|candidate| {
                candidate.pattern.recipe == entry.pattern.recipe
                    && candidate.pattern.effective_machines == replacement_effective
                    && candidate.pattern.machines <= entry.pattern.machines.clone() * &copies
            })
            .ok_or("Missing canonical replacement bank for hint")?;
        let copies: i64 = copies
            .to_i64()
            .ok_or("Symmetry radix exceeds the supported integer range")?;
        let value = bank_values.get(&pattern_index).copied().unwrap_or(0);
        let transfers = value / copies;
        let _ = bank_values.insert(pattern_index, value % copies);
        let slot = bank_values.entry(replacement).or_insert(0);
        *slot += transfers;
    }

    let mut hint: Vec<(DomainId, i32)> = Vec::new();
    for entry in &state.production {
        hint.push((entry.var, solution.get_integer_value(entry.var)));
    }
    for (pattern_index, entry) in state.patterns.iter().enumerate() {
        let value = bank_values.get(&pattern_index).copied().unwrap_or(0);
        let value =
            i32::try_from(value).map_err(|_| "Bank hint exceeds the 32-bit range".to_string())?;
        hint.push((entry.var, value));
    }
    for withdrawal in state.target_variables.values().chain(state.excess_variables.values()) {
        hint.push((withdrawal.var, solution.get_integer_value(withdrawal.var)));
    }
    Ok(hint)
}

struct MaybeTimeBudget(Option<TimeBudget>);

impl TerminationCondition for MaybeTimeBudget {
    fn should_stop(&mut self) -> bool {
        match &mut self.0 {
            Some(budget) => budget.should_stop(),
            None => false,
        }
    }
}

fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }
}

fn build_model(problem: &OptimizerProblem) -> Result<ModelState, String> {
    let mut solver = Solver::default();
    let tag = solver.new_constraint_tag();
    let mut state = ModelState {
        solver,
        tag,
        production: Vec::new(),
        patterns: Vec::new(),
        target_variables: BTreeMap::new(),
        excess_variables: BTreeMap::new(),
        routing_variables: Vec::new(),
        objectives: Vec::new(),
        int_vars: Vec::new(),
        bank_link_totals: Vec::new(),
        build_infeasible: false,
    };
    let bounds = compute_recipe_bounds(&problem.graph, &problem.raw_availability)?;
    // Each step is skipped once the model is provably infeasible: Pumpkin
    // panics on variable creation after a root-level conflict, and the result
    // is INFEASIBLE regardless.
    let steps: [&dyn Fn(&OptimizerProblem, &mut ModelState) -> Result<(), String>; 6] = [
        &|problem, state| create_production_variables(problem, &bounds, state),
        &|problem, state| create_pattern_variables(problem, &bounds, state),
        &add_raw_constraints,
        &add_conservation_rows,
        &add_routing_variables,
        &prepare_bank_link_totals,
    ];
    for step in steps {
        if state.stopped() {
            state.build_infeasible = true;
            return Ok(state);
        }
        step(problem, &mut state)?;
    }
    if state.stopped() {
        state.build_infeasible = true;
        return Ok(state);
    }
    build_objectives(problem, &mut state)?;
    if state.stopped() {
        state.build_infeasible = true;
    }
    Ok(state)
}

fn empty_result(status: ProofStatus, phase_timings: Vec<(String, f64)>) -> OptimizerResult {
    OptimizerResult {
        feasible: false,
        proof_status: status,
        selected_banks: Vec::new(),
        targets: Vec::new(),
        excess: Vec::new(),
        raws: Vec::new(),
        items: Vec::new(),
        objective: None,
        phase_timings,
    }
}

fn extract_result(
    problem: &OptimizerProblem,
    state: &ModelState,
    solution: &Solution,
    phase_timings: Vec<(String, f64)>,
) -> Result<OptimizerResult, String> {
    let mut selected_banks: Vec<SelectedBank> = Vec::new();
    for entry in &state.patterns {
        let value = solution.get_integer_value(entry.var);
        if value < 0 {
            return Err(format!("Negative bank multiplicity returned: {value}"));
        }
        if value == 0 {
            continue;
        }
        let multiplicity = BigInt::from(value);
        let mut input_rates = BTreeMap::new();
        for (item, rate) in &entry.pattern.input_rates {
            let slot = input_rates.entry(*item).or_insert_with(BigRational::zero);
            *slot += rate;
        }
        let mut output_rates = BTreeMap::new();
        for (item, rate) in &entry.pattern.output_rates {
            let slot = output_rates.entry(*item).or_insert_with(BigRational::zero);
            *slot += rate;
        }
        selected_banks.push(SelectedBank {
            recipe: entry.pattern.recipe,
            machines: entry.pattern.machines.clone(),
            clock: entry.pattern.clock.clone(),
            multiplicity,
            effective_machines_per_bank: entry.pattern.effective_machines.clone(),
            cycles_per_minute_per_bank: entry.pattern.cycles_per_minute.clone(),
            input_rates_per_bank: input_rates,
            output_rates_per_bank: output_rates,
        });
    }

    let mut produced: BTreeMap<usize, BigRational> = BTreeMap::new();
    let mut consumed: BTreeMap<usize, BigRational> = BTreeMap::new();
    for bank in &selected_banks {
        let factor = BigRational::from_integer(bank.multiplicity.clone());
        for (item, rate) in &bank.input_rates_per_bank {
            let slot = consumed.entry(*item).or_insert_with(BigRational::zero);
            *slot += rate.clone() * factor.clone();
        }
        for (item, rate) in &bank.output_rates_per_bank {
            let slot = produced.entry(*item).or_insert_with(BigRational::zero);
            *slot += rate.clone() * factor.clone();
        }
    }

    let extract_withdrawal = |variables: &BTreeMap<usize, WithdrawalVariable>, item: usize| {
        variables
            .get(&item)
            .map(|withdrawal| {
                let value = solution.get_integer_value(withdrawal.var);
                BigRational::new(BigInt::from(value), withdrawal.scale.clone())
            })
            .unwrap_or_else(BigRational::zero)
    };

    let targets: Vec<TargetRate> = problem
        .targets
        .iter()
        .map(|target| TargetRate {
            item: target.item,
            minimum: target.minimum.clone(),
            weight: target.weight.clone(),
            rate: extract_withdrawal(&state.target_variables, target.item),
        })
        .collect();

    let floor_by_item: BTreeMap<usize, BigRational> = problem
        .excess
        .iter()
        .map(|entry| (entry.item, entry.floor.clone()))
        .collect();
    let excess: Vec<ExcessRate> = problem
        .graph
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| !item.is_raw && !item.is_ingot)
        .map(|(index, _)| ExcessRate {
            item: index,
            floor: floor_by_item.get(&index).cloned().unwrap_or_else(BigRational::zero),
            rate: extract_withdrawal(&state.excess_variables, index),
        })
        .collect();

    let target_rate_by_item: BTreeMap<usize, BigRational> =
        targets.iter().map(|target| (target.item, target.rate.clone())).collect();
    let excess_rate_by_item: BTreeMap<usize, BigRational> =
        excess.iter().map(|entry| (entry.item, entry.rate.clone())).collect();

    let items: Vec<ItemRate> = problem
        .graph
        .items
        .iter()
        .enumerate()
        .map(|(index, _)| ItemRate {
            item: index,
            produced: produced.get(&index).cloned().unwrap_or_else(BigRational::zero),
            consumed: consumed.get(&index).cloned().unwrap_or_else(BigRational::zero),
            target_withdrawal: target_rate_by_item
                .get(&index)
                .cloned()
                .unwrap_or_else(BigRational::zero),
            excess_withdrawal: excess_rate_by_item
                .get(&index)
                .cloned()
                .unwrap_or_else(BigRational::zero),
        })
        .collect();

    let raws: Vec<RawRate> = problem
        .graph
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| item.is_raw)
        .map(|(index, item)| {
            let used = consumed.get(&index).cloned().unwrap_or_else(BigRational::zero);
            if item.is_unlimited {
                RawRate { item: index, unlimited: true, available: None, used, leftover: None }
            } else {
                let available = problem
                    .raw_availability
                    .get(&index)
                    .cloned()
                    .unwrap_or_else(BigRational::zero);
                let leftover = available.clone() - used.clone();
                RawRate {
                    item: index,
                    unlimited: false,
                    available: Some(available),
                    used,
                    leftover: Some(leftover),
                }
            }
        })
        .collect();

    let scarce_raw_items_per_minute = problem
        .graph
        .scarce_raw_ids
        .iter()
        .fold(BigRational::zero(), |total, item| {
            total + consumed.get(item).cloned().unwrap_or_else(BigRational::zero)
        });
    let weighted_target_output = targets.iter().fold(BigRational::zero(), |total, target| {
        total + target.rate.clone() * target.weight.clone()
    });
    let physical_machines = selected_banks
        .iter()
        .fold(BigInt::zero(), |total, bank| total + &bank.machines * &bank.multiplicity);
    let groups = selected_banks
        .iter()
        .fold(BigInt::zero(), |total, bank| total + &bank.multiplicity);
    let internal_splitter_merger_devices =
        selected_banks.iter().fold(BigInt::zero(), |total, bank| {
            let input_count = problem.graph.recipes[bank.recipe].inputs.len();
            let per_bank =
                equal_lane_tree_devices(&bank.machines) * BigInt::from(input_count as u64 + 1);
            total + per_bank * &bank.multiplicity
        });
    let routing_splitter_devices = state
        .routing_variables
        .iter()
        .fold(BigInt::zero(), |total, entry| {
            total + BigInt::from(solution.get_integer_value(entry.var))
        });

    let objective = ObjectiveVector {
        scarce_raw_items_per_minute,
        weighted_target_output,
        physical_machines,
        groups,
        internal_splitter_merger_devices: internal_splitter_merger_devices.clone(),
        routing_splitter_devices: routing_splitter_devices.clone(),
        total_splitter_merger_devices: internal_splitter_merger_devices + routing_splitter_devices,
    };

    Ok(OptimizerResult {
        feasible: true,
        proof_status: ProofStatus::Optimal,
        selected_banks,
        targets,
        excess,
        raws,
        items,
        objective: Some(objective),
        phase_timings,
    })
}

/// Experiment hook: reports how long a plain satisfiability check takes on
/// the full model (no objective), for performance diagnosis.
#[doc(hidden)]
pub fn probe_satisfy(problem: &OptimizerProblem, time_limit_ms: u64) -> Result<String, String> {
    use pumpkin_core::results::SatisfactionResult;

    pumpkin_core::statistics::configure_statistic_logging("stat:", None, None, None);
    let mut state = build_model(problem)?;
    eprintln!(
        "model: {} production vars, {} pattern vars, {} targets, {} excess, {} routing",
        state.production.len(),
        state.patterns.len(),
        state.target_variables.len(),
        state.excess_variables.len(),
        state.routing_variables.len(),
    );
    if state.build_infeasible || state.solver.is_inconsistent() {
        return Ok("build infeasible".to_string());
    }
    let mut termination =
        MaybeTimeBudget(Some(TimeBudget::starting_now(std::time::Duration::from_millis(
            time_limit_ms,
        ))));
    let started = now_ms();
    let mut brancher = search_brancher(&state);
    let mut resolver = ResolutionResolver::default();
    let result = state.solver.satisfy(&mut brancher, &mut termination, &mut resolver);
    let elapsed = now_ms() - started;
    let report = match &result {
        SatisfactionResult::Satisfiable(_) => format!("satisfiable in {elapsed:.1}ms"),
        SatisfactionResult::Unsatisfiable(_, _, _) => format!("unsatisfiable in {elapsed:.1}ms"),
        SatisfactionResult::Unknown(_, _, _) => format!("unknown after {elapsed:.1}ms"),
    };
    drop(result);
    state.solver.log_statistics(&brancher, &resolver, true);
    Ok(report)
}

/// Finds and proves the complete lexicographic optimum, mirroring the
/// TypeScript `solveExactProduction`. Returns INFEASIBLE only when phase 1 is
/// unsatisfiable, and CANCELLED only when the optional time budget runs out.
pub fn solve_exact_production(
    problem: &OptimizerProblem,
    progress: &mut ProgressCallback<'_>,
) -> Result<OptimizerResult, String> {
    if problem.belt_capacity <= BigRational::zero() {
        return Err("Belt capacity must be positive".to_string());
    }

    let mut state = build_model(problem)?;
    let mut termination = MaybeTimeBudget(
        problem
            .time_limit_ms
            .map(|ms| TimeBudget::starting_now(std::time::Duration::from_millis(ms))),
    );

    if state.build_infeasible || state.solver.is_inconsistent() {
        return Ok(empty_result(ProofStatus::Infeasible, Vec::new()));
    }

    let mut phase_timings: Vec<(String, f64)> = Vec::new();
    let mut last_solution: Option<Solution> = None;
    let mut next_phase_hint: Vec<(DomainId, i32)> = Vec::new();
    let phase_count = state.objectives.len();

    for index in 0..phase_count {
        let objective_label = state.objectives[index].label;
        let objective_var = state.objectives[index].var;
        let maximize = state.objectives[index].maximize;
        progress(index + 1, objective_label, "solving", None);
        let started = now_ms();

        let direction = if maximize {
            OptimisationDirection::Maximise
        } else {
            OptimisationDirection::Minimise
        };
        let callback = |_: &Solver,
                        _: SolutionReference,
                        _: &DynamicBrancher,
                        _: &ResolutionResolver|
         -> ControlFlow<()> { ControlFlow::Continue(()) };

        let mut brancher = phase_brancher(&state, &next_phase_hint);
        let mut resolver = ResolutionResolver::default();
        let result = state.solver.optimise(
            &mut brancher,
            &mut termination,
            &mut resolver,
            LinearSatUnsat::new(direction, objective_var, callback),
        );

        let phase_ms = now_ms() - started;
        match result {
            OptimisationResult::Optimal(solution) => {
                let optimum = solution.get_integer_value(objective_var);
                let tag = state.tag;
                state.post(pumpkin_constraints::equals(vec![objective_var.scaled(1)], optimum, tag));
                if state.build_infeasible {
                    return Err(format!(
                        "Fixing the {objective_label} optimum made the model infeasible"
                    ));
                }
                if index == 1 {
                    add_bank_representation_links(&mut state);
                    next_phase_hint = initial_bank_hint(&state, &solution)?;
                } else if index == 2 {
                    // Recover the true machine count from the scaled optimum.
                    let objective = &state.objectives[index];
                    let true_value = BigRational::new(
                        BigInt::from(optimum) * &objective.reduction,
                        objective.scale.clone(),
                    );
                    if !true_value.denom().is_one() {
                        return Err("Physical-machine optimum is not integral".to_string());
                    }
                    let machines_optimum = true_value.to_integer();
                    if machines_optimum < BigInt::zero() {
                        return Err("Physical-machine optimum is negative".to_string());
                    }
                    tighten_pattern_domains(&mut state, &machines_optimum)?;
                    next_phase_hint = canonical_bank_hint(&state, &solution)?;
                } else {
                    next_phase_hint = complete_solution_hint(&state, &solution);
                }
                if state.build_infeasible {
                    return Err(format!(
                        "Post-phase reductions after {objective_label} made the model infeasible"
                    ));
                }
                phase_timings.push((objective_label.to_string(), phase_ms));
                progress(index + 1, objective_label, "complete", Some(phase_ms));
                last_solution = Some(solution);
            }
            OptimisationResult::Unsatisfiable => {
                if index != 0 {
                    return Err(format!(
                        "Lexicographic phase became infeasible: {objective_label}"
                    ));
                }
                return Ok(empty_result(ProofStatus::Infeasible, phase_timings));
            }
            OptimisationResult::Satisfiable(_)
            | OptimisationResult::Unknown
            | OptimisationResult::Stopped(_, _) => {
                return Ok(empty_result(ProofStatus::Cancelled, phase_timings));
            }
        }
    }

    let solution = last_solution.ok_or("Optimal solve did not return a solution")?;
    let result = extract_result(problem, &state, &solution, phase_timings)?;
    let validation = crate::validation::validate_exact_solution(problem, &result);
    if !validation.is_empty() {
        return Err(format!(
            "Exact solution failed independent validation:\n{}",
            validation.join("\n")
        ));
    }
    Ok(result)
}
