//! Oxidation state guessing and bond valence analysis.
//!
//! This module provides two approaches for assigning oxidation states:
//!
//! 1. **Composition-based guessing**: Enumerate charge-balanced oxidation state
//!    combinations ranked by ICSD probability. Fast, doesn't need structure coordinates.
//!
//! 2. **BVS-based guessing**: Calculate Bond Valence Sums from actual bond distances
//!    and use Bayesian inference with ICSD priors. More accurate but requires neighbor info.
//!
//! ## Data Sources
//!
//! - ICSD occurrence probabilities for oxidation state ranking
//! - BVS statistics (mean, std) from ICSD for Gaussian likelihood
//! - O'Keeffe & Brese bond valence parameters (JACS 1991)

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::OnceLock;

use crate::defects::DefectType;
use crate::element::Element;

// Bond valence "softness" parameter (Brown & Altermatt, Acta Cryst. B41, 244, 1985)
const BV_SOFTNESS: f64 = 0.31;

/// Maximum permutations for charge-balanced enumeration to prevent combinatorial explosion.
pub const MAX_PERMUTATIONS: usize = 100_000;

/// Tolerance for detecting non-integer oxidation states (mixed-valence).
/// Values like 2.33 or 2.67 (from Fe3O4) deviate by 0.33 from the nearest integer,
/// which exceeds this threshold. Values within 0.25 of an integer are considered
/// representable as a single oxidation state.
pub const OXI_INT_TOLERANCE: f64 = 0.25;

// =============================================================================
// Compressed Data Files (embedded at compile time)
// =============================================================================

// ICSD oxidation state occurrence counts
const ICSD_OXI_PROB_GZ: &[u8] = include_bytes!("data/icsd_oxi_prob.json.gz");

// BVS statistics (mean, std, n) per species
const ICSD_BV_STATS_GZ: &[u8] = include_bytes!("data/icsd_bv_stats.json.gz");

// O'Keeffe & Brese BV parameters (r, c per element)
const BV_PARAMS_GZ: &[u8] = include_bytes!("data/bv_params.json.gz");

// =============================================================================
// Data Structures
// =============================================================================

/// Bond valence parameters for an element (O'Keeffe & Brese 1991).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BvParams {
    /// Bond valence radius parameter
    pub r: f64,
    /// Electronegativity-related parameter
    pub c: f64,
}

/// BVS statistics from ICSD data.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BvStats {
    /// Mean BVS value
    pub mean: f64,
    /// Standard deviation
    pub std: f64,
    /// Number of data points
    pub n: u32,
}

/// Result of oxidation state guessing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OxiStateGuess {
    /// Oxidation states per element (average if multiple sites)
    pub oxidation_states: HashMap<String, f64>,
    /// Probability score (higher is more likely)
    pub probability: f64,
}

// =============================================================================
// Lazy Data Loading
// =============================================================================

// Type aliases for data maps
type OxiProbMap = HashMap<String, u32>;
type BvStatsMap = HashMap<String, BvStats>;
type BvParamsMap = HashMap<String, BvParams>;

static ICSD_OXI_PROB: OnceLock<OxiProbMap> = OnceLock::new();
static ICSD_BV_STATS: OnceLock<BvStatsMap> = OnceLock::new();
static BV_PARAMS: OnceLock<BvParamsMap> = OnceLock::new();

fn decompress_json<T: serde::de::DeserializeOwned>(gz_data: &[u8]) -> T {
    let mut decoder = GzDecoder::new(gz_data);
    let mut json = String::new();
    decoder
        .read_to_string(&mut json)
        .expect("Failed to decompress gzipped JSON");
    serde_json::from_str(&json).expect("Failed to parse JSON data")
}

/// Get ICSD oxidation state occurrence probabilities.
///
/// Keys are "Element:oxidation_state" (e.g., "Fe:3", "O:-2").
pub fn get_icsd_oxi_prob() -> &'static OxiProbMap {
    ICSD_OXI_PROB.get_or_init(|| decompress_json(ICSD_OXI_PROB_GZ))
}

/// Get ICSD BVS statistics (mean, std, n).
///
/// Keys are "Element:oxidation_state" (e.g., "Fe:3", "O:-2").
pub fn get_icsd_bv_stats() -> &'static BvStatsMap {
    ICSD_BV_STATS.get_or_init(|| decompress_json(ICSD_BV_STATS_GZ))
}

/// Get O'Keeffe & Brese bond valence parameters.
///
/// Keys are element symbols (e.g., "Fe", "O").
pub fn get_bv_params() -> &'static BvParamsMap {
    BV_PARAMS.get_or_init(|| decompress_json(BV_PARAMS_GZ))
}

// =============================================================================
// Utility Functions
// =============================================================================

/// Format species key for looking up in ICSD data maps.
///
/// Returns "Element:oxidation_state" (e.g., "Fe:3", "O:-2", "Fe:0").
pub fn species_key(element: Element, oxidation_state: i8) -> String {
    format!("{}:{}", element.symbol(), oxidation_state)
}

/// Get ICSD occurrence count for a species.
///
/// Returns None if species not in ICSD data.
pub fn get_oxi_probability(element: Element, oxidation_state: i8) -> Option<u32> {
    let key = species_key(element, oxidation_state);
    get_icsd_oxi_prob().get(&key).copied()
}

/// Get ICSD BVS statistics for a species.
///
/// Returns None if species not in ICSD data.
pub fn get_bv_stats_for_species(element: Element, oxidation_state: i8) -> Option<&'static BvStats> {
    let key = species_key(element, oxidation_state);
    get_icsd_bv_stats().get(&key)
}

/// Get BV parameters for an element.
///
/// Returns None if element not in BV parameters table.
pub fn get_bv_params_for_element(element: Element) -> Option<&'static BvParams> {
    get_bv_params().get(element.symbol())
}

/// List of electronegative elements from O'Keeffe & Brese.
/// BV sum only contributes when at least one atom is electronegative.
pub const ELECTRONEG_ELEMENTS: &[Element] = &[
    Element::H,
    Element::B,
    Element::C,
    Element::Si,
    Element::N,
    Element::P,
    Element::As,
    Element::Sb,
    Element::O,
    Element::S,
    Element::Se,
    Element::Te,
    Element::F,
    Element::Cl,
    Element::Br,
    Element::I,
];

/// Check if an element is electronegative (for BV calculation).
pub fn is_electronegative(element: Element) -> bool {
    ELECTRONEG_ELEMENTS.contains(&element)
}

// =============================================================================
// Bond Valence Sum Calculation
// =============================================================================

/// Calculate bond valence contribution from a single bond.
///
/// Uses O'Keeffe & Brese formula:
/// ```text
/// R = r1 + r2 - r1*r2*(sqrt(c1) - sqrt(c2))^2 / (c1*r1 + c2*r2)
/// vij = exp((R - distance) / BV_SOFTNESS)
/// ```
///
/// Returns `0.0` if neither element is electronegative, if both elements
/// are the same, or if either element is missing from the BV parameters table.
/// Returns the signed bond valence contribution otherwise.
pub fn calculate_bond_valence(
    element1: Element,
    element2: Element,
    distance: f64,
    scale_factor: f64,
) -> f64 {
    // BV only contributes if at least one element is electronegative
    if !is_electronegative(element1) && !is_electronegative(element2) {
        return 0.0;
    }

    // Same element doesn't contribute
    if element1 == element2 {
        return 0.0;
    }

    // Return 0.0 if BV params are missing for either element
    let params1 = match get_bv_params_for_element(element1) {
        Some(p) => p,
        None => return 0.0,
    };
    let params2 = match get_bv_params_for_element(element2) {
        Some(p) => p,
        None => return 0.0,
    };

    let r1 = params1.r;
    let r2 = params2.r;
    let c1 = params1.c;
    let c2 = params2.c;

    // O'Keeffe & Brese formula for ideal bond length
    let sqrt_c1 = c1.sqrt();
    let sqrt_c2 = c2.sqrt();
    let r_ideal = r1 + r2 - r1 * r2 * (sqrt_c1 - sqrt_c2).powi(2) / (c1 * r1 + c2 * r2);

    // Bond valence
    let vij = ((r_ideal - distance * scale_factor) / BV_SOFTNESS).exp();

    // Sign based on electronegativity (positive if element1 is more electropositive)
    let en1 = element1.electronegativity().unwrap_or(2.0);
    let en2 = element2.electronegativity().unwrap_or(2.0);
    let sign = if en1 < en2 {
        1.0
    } else if en1 > en2 {
        -1.0
    } else {
        // Equal electronegativity: no net contribution
        0.0
    };

    vij * sign
}

/// Neighbor information for BVS calculation.
#[derive(Debug, Clone)]
pub struct BvNeighbor {
    /// Element of the neighbor
    pub element: Element,
    /// Distance to the neighbor in Angstroms
    pub distance: f64,
    /// Occupancy (for disordered sites)
    pub occupancy: f64,
}

/// Calculate bond valence sum for a site given its neighbors.
///
/// # Arguments
///
/// * `site_element` - Element at the central site
/// * `neighbors` - List of neighbors with distances
/// * `scale_factor` - Distance scaling factor (default 1.015 for GGA, 1.0 for experimental)
///
/// # Returns
///
/// The bond valence sum. Missing BV parameters contribute 0.0 to the sum.
pub fn calculate_bv_sum(site_element: Element, neighbors: &[BvNeighbor], scale_factor: f64) -> f64 {
    neighbors
        .iter()
        .map(|neighbor| {
            let vij = calculate_bond_valence(
                site_element,
                neighbor.element,
                neighbor.distance,
                scale_factor,
            );
            vij * neighbor.occupancy
        })
        .sum()
}

// =============================================================================
// Oxidation State Probability Calculation
// =============================================================================

/// Calculate posterior probability for an oxidation state given a BV sum.
///
/// Uses Bayesian approach:
/// ```text
/// P(oxi | BV) ∝ P(BV | oxi) × P(oxi)
/// ```
///
/// where P(BV | oxi) is Gaussian from ICSD statistics and P(oxi) is ICSD occurrence.
pub fn calculate_oxi_probability(element: Element, oxidation_state: i8, bv_sum: f64) -> f64 {
    // Get ICSD prior probability
    let prior = get_oxi_probability(element, oxidation_state).unwrap_or(0) as f64;
    if prior == 0.0 {
        return 0.0;
    }

    // Get BVS statistics for Gaussian likelihood
    let stats = match get_bv_stats_for_species(element, oxidation_state) {
        Some(s) if s.std > 0.0 => s,
        _ => return 0.0,
    };

    // Skip oxidation state 0 (neutral)
    if oxidation_state == 0 {
        return 0.0;
    }

    // Gaussian likelihood: P(BV | oxi) = exp(-(BV - μ)² / (2σ²)) / σ
    let likelihood = (-(bv_sum - stats.mean).powi(2) / (2.0 * stats.std.powi(2))).exp() / stats.std;

    // Posterior (unnormalized)
    prior * likelihood
}

/// Get all possible oxidation states for an element with their probabilities given a BV sum.
///
/// Returns a vector of (oxidation_state, probability) sorted by decreasing probability.
pub fn get_oxi_state_probabilities(element: Element, bv_sum: f64) -> Vec<(i8, f64)> {
    let icsd_data = get_icsd_oxi_prob();
    let prefix = format!("{}:", element.symbol());

    let mut probs: Vec<(i8, f64)> = icsd_data
        .keys()
        .filter(|k| k.starts_with(&prefix))
        .filter_map(|k| {
            let oxi_str = k.strip_prefix(&prefix)?;
            let oxi: i8 = oxi_str.parse().ok()?;
            let prob = calculate_oxi_probability(element, oxi, bv_sum);
            if prob > 0.0 { Some((oxi, prob)) } else { None }
        })
        .collect();

    // Normalize probabilities
    let total: f64 = probs.iter().map(|(_, p)| p).sum();
    if total > 0.0 {
        for (_, p) in &mut probs {
            *p /= total;
        }
    }

    // Sort by decreasing probability
    probs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    probs
}

// =============================================================================
// Composition-based Oxidation State Guessing
// =============================================================================

/// Get oxidation states to consider for an element.
///
/// Priority: ICSD oxidation states > common oxidation states > all oxidation states
pub fn get_candidate_oxi_states(element: Element, use_all: bool) -> Vec<i8> {
    if use_all {
        element.oxidation_states().to_vec()
    } else {
        let icsd = element.icsd_oxidation_states();
        if !icsd.is_empty() {
            icsd.to_vec()
        } else {
            element.common_oxidation_states().to_vec()
        }
    }
}

/// Generate non-decreasing combinations with replacement (multiset combinations).
///
/// For k items choosing n, generates C(k+n-1, n) combinations where each
/// combination is a non-decreasing sequence. This avoids permutational
/// duplicates for indistinguishable atoms.
///
/// Returns empty vec if the number of combinations would exceed MAX_PERMUTATIONS.
fn combinations_with_replacement(items: &[i8], count: usize) -> Vec<Vec<i8>> {
    if count == 0 {
        return vec![vec![]];
    }
    if items.is_empty() {
        return vec![];
    }

    // Compute C(k+n-1, n) using the smaller of n and k-1 as the iteration count
    // to check against MAX_PERMUTATIONS before generating
    let k = items.len();
    let num_combinations = binomial(k + count - 1, count.min(k - 1));
    if num_combinations.is_none_or(|n| n > MAX_PERMUTATIONS) {
        return vec![];
    }

    let mut result = Vec::new();
    fn recurse(
        items: &[i8],
        count: usize,
        start: usize,
        current: &mut Vec<i8>,
        result: &mut Vec<Vec<i8>>,
    ) {
        if count == 0 {
            result.push(current.clone());
            return;
        }
        for idx in start..items.len() {
            current.push(items[idx]);
            recurse(items, count - 1, idx, current, result);
            current.pop();
        }
    }
    recurse(items, count, 0, &mut Vec::with_capacity(count), &mut result);
    result
}

/// Compute binomial coefficient C(n, k), returning None on overflow.
fn binomial(n: usize, k: usize) -> Option<usize> {
    if k > n {
        return Some(0);
    }
    let k = k.min(n - k); // Use symmetry: C(n,k) = C(n, n-k)
    let mut result: usize = 1;
    for i in 0..k {
        result = result.checked_mul(n - i)?.checked_div(i + 1)?;
    }
    Some(result)
}

/// Find charge-balanced oxidation state assignments for a composition.
///
/// # Arguments
///
/// * `elements` - Elements in the composition
/// * `amounts` - Amount of each element (must be integers for proper enumeration)
/// * `target_charge` - Desired total charge (default 0 for charge balance)
/// * `oxi_states_override` - Override oxidation states for specific elements
/// * `use_all_oxi_states` - If true, use all known oxidation states (not just common/ICSD)
/// * `max_sites` - Maximum number of sites to enumerate (None = no limit)
///
/// # Returns
///
/// Vector of possible assignments sorted by ICSD probability score.
pub fn oxi_state_guesses(
    elements: &[Element],
    amounts: &[f64],
    target_charge: i8,
    oxi_states_override: Option<&HashMap<Element, Vec<i8>>>,
    use_all_oxi_states: bool,
    max_sites: Option<usize>,
) -> Vec<OxiStateGuess> {
    // Single element: only return oxidation state 0 when target_charge == 0
    // For non-zero target_charge, let normal enumeration handle it (or return empty if impossible)
    let unique_elements: std::collections::HashSet<_> = elements.iter().collect();
    if unique_elements.len() == 1 && target_charge == 0 {
        return vec![OxiStateGuess {
            oxidation_states: HashMap::from([(elements[0].symbol().to_string(), 0.0)]),
            probability: 1.0,
        }];
    }

    // Convert to positive integers (required for enumeration)
    let int_amounts: Option<Vec<i32>> = amounts
        .iter()
        .map(|&a| {
            let rounded = a.round();
            // Must be finite, positive, integer, and within i32 range
            if rounded.is_finite()
                && rounded > 0.0
                && rounded <= i32::MAX as f64
                && (a - rounded).abs() < 1e-8
            {
                Some(rounded as i32)
            } else {
                None
            }
        })
        .collect();

    let int_amounts = match int_amounts {
        Some(v) => v,
        None => return vec![], // Invalid amounts
    };

    // Optionally reduce composition
    let (elements, int_amounts) = if let Some(max) = max_sites {
        let total: i32 = int_amounts.iter().sum();
        if total as usize > max {
            // Try to reduce by GCD
            let gcd = int_amounts
                .iter()
                .fold(0i32, |acc, &x| gcd_i32(acc, x.abs()));
            if gcd > 1 {
                let reduced: Vec<i32> = int_amounts.iter().map(|&x| x / gcd).collect();
                let reduced_total: i32 = reduced.iter().sum();
                if reduced_total as usize <= max {
                    (elements.to_vec(), reduced)
                } else {
                    return vec![]; // Can't reduce enough
                }
            } else {
                return vec![]; // No common factor
            }
        } else {
            (elements.to_vec(), int_amounts)
        }
    } else {
        (elements.to_vec(), int_amounts)
    };

    // Get oxidation states for each element
    let el_oxi_states: Vec<Vec<i8>> = elements
        .iter()
        .map(|el| {
            oxi_states_override
                .and_then(|m| m.get(el).cloned())
                .unwrap_or_else(|| get_candidate_oxi_states(*el, use_all_oxi_states))
        })
        .collect();

    // For each element, compute all possible sums and their best combinations
    let icsd_prob = get_icsd_oxi_prob();
    let mut el_sums: Vec<HashMap<i32, (f64, Vec<i8>)>> = Vec::new();

    for (idx, oxis) in el_oxi_states.iter().enumerate() {
        let count = int_amounts[idx] as usize;
        let el = elements[idx];

        let mut sum_map: HashMap<i32, (f64, Vec<i8>)> = HashMap::new();

        for combo in combinations_with_replacement(oxis, count) {
            // Try to get ALL priors for this combo; skip if any are missing
            let log_probs: Option<Vec<f64>> = combo
                .iter()
                .map(|&o| {
                    let key = species_key(el, o);
                    icsd_prob.get(&key).map(|&p| (p as f64).ln())
                })
                .collect();

            let Some(log_probs) = log_probs else {
                // Missing ICSD data for at least one oxidation state; skip this combo
                continue;
            };

            let sum: i32 = combo.iter().map(|&o| o as i32).sum();
            let score: f64 = log_probs.iter().sum();

            // Keep the best-scoring combination for each sum (higher log-prob = better)
            let entry = sum_map
                .entry(sum)
                .or_insert((f64::NEG_INFINITY, combo.clone()));
            if score > entry.0 {
                *entry = (score, combo);
            }
        }

        el_sums.push(sum_map);
    }

    // Find all combinations of element sums that achieve target charge
    let mut solutions: Vec<OxiStateGuess> = Vec::new();
    let mut permutation_count = 0;

    #[allow(clippy::too_many_arguments)]
    fn recurse(
        el_sums: &[HashMap<i32, (f64, Vec<i8>)>],
        elements: &[Element],
        int_amounts: &[i32],
        target_charge: i32,
        current_idx: usize,
        current_sum: i32,
        current_scores: &mut Vec<f64>,
        current_combos: &mut Vec<Vec<i8>>,
        solutions: &mut Vec<OxiStateGuess>,
        permutation_count: &mut usize,
    ) {
        if *permutation_count >= MAX_PERMUTATIONS {
            return;
        }

        if current_idx == el_sums.len() {
            if current_sum == target_charge {
                // Found a valid solution
                let mut oxi_states = HashMap::new();
                for (idx, combo) in current_combos.iter().enumerate() {
                    let el = elements[idx];
                    let avg: f64 =
                        combo.iter().map(|&o| o as f64).sum::<f64>() / int_amounts[idx] as f64;
                    oxi_states.insert(el.symbol().to_string(), avg);
                }
                // Sum log-probabilities (equivalent to multiplying probabilities)
                // Convert back to probability space for output (exp of log-prob)
                let log_prob: f64 = current_scores.iter().sum();
                solutions.push(OxiStateGuess {
                    oxidation_states: oxi_states,
                    probability: log_prob.exp(),
                });
            }
            *permutation_count += 1;
            return;
        }

        // Compute bounds for remaining elements
        let mut min_remaining = 0i32;
        let mut max_remaining = 0i32;
        for sums in el_sums.iter().skip(current_idx + 1) {
            if let Some(min_sum) = sums.keys().min() {
                min_remaining += min_sum;
            }
            if let Some(max_sum) = sums.keys().max() {
                max_remaining += max_sum;
            }
        }

        // Prune if target is unreachable
        for (&sum, (score, combo)) in &el_sums[current_idx] {
            let new_sum = current_sum + sum;
            let remaining_needed = target_charge - new_sum;

            if remaining_needed < min_remaining || remaining_needed > max_remaining {
                continue;
            }

            current_scores.push(*score);
            current_combos.push(combo.clone());

            recurse(
                el_sums,
                elements,
                int_amounts,
                target_charge,
                current_idx + 1,
                new_sum,
                current_scores,
                current_combos,
                solutions,
                permutation_count,
            );

            current_scores.pop();
            current_combos.pop();
        }
    }

    let mut current_scores = Vec::new();
    let mut current_combos = Vec::new();

    recurse(
        &el_sums,
        &elements,
        &int_amounts,
        target_charge as i32,
        0,
        0,
        &mut current_scores,
        &mut current_combos,
        &mut solutions,
        &mut permutation_count,
    );

    // Sort by decreasing probability
    solutions.sort_by(|a, b| {
        b.probability
            .partial_cmp(&a.probability)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    solutions
}

fn gcd_i32(mut a: i32, mut b: i32) -> i32 {
    a = a.abs();
    b = b.abs();
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

/// Find charge-balanced oxidation state assignment using recursive search with pruning.
/// Returns the highest log-probability assignment, or None if none found.
pub fn find_charge_balanced_assignment(
    site_probs: &[Vec<(i8, f64)>],
    multiplicities: &[usize],
) -> Option<Vec<i8>> {
    let mut best = (f64::NEG_INFINITY, None);
    let mut count = 0usize;

    #[allow(clippy::too_many_arguments)]
    fn recurse(
        site_probs: &[Vec<(i8, f64)>],
        mults: &[usize],
        idx: usize,
        charge: i32,
        assignment: &mut Vec<i8>,
        log_score: f64,
        best: &mut (f64, Option<Vec<i8>>),
        count: &mut usize,
    ) {
        if *count >= MAX_PERMUTATIONS {
            return;
        }
        if idx == site_probs.len() {
            *count += 1;
            if charge == 0 && log_score > best.0 {
                *best = (log_score, Some(assignment.clone()));
            }
            return;
        }
        // Compute reachable charge bounds for remaining sites
        let (min_rem, max_rem) = site_probs[idx + 1..]
            .iter()
            .zip(&mults[idx + 1..])
            .filter(|(probs, _)| !probs.is_empty())
            .map(|(probs, &mult)| {
                let (lo, hi) = probs.iter().fold((i8::MAX, i8::MIN), |(lo, hi), &(o, _)| {
                    (lo.min(o), hi.max(o))
                });
                (lo as i32 * mult as i32, hi as i32 * mult as i32)
            })
            .fold((0, 0), |(a, b), (c, d)| (a + c, b + d));

        for &(oxi, prob) in &site_probs[idx] {
            if prob <= 0.0 {
                continue;
            }
            let new_charge = charge + oxi as i32 * mults[idx] as i32;
            if new_charge + min_rem > 0 || new_charge + max_rem < 0 {
                continue;
            }
            assignment.push(oxi);
            recurse(
                site_probs,
                mults,
                idx + 1,
                new_charge,
                assignment,
                log_score + (mults[idx] as f64) * prob.ln(),
                best,
                count,
            );
            assignment.pop();
        }
    }

    recurse(
        site_probs,
        multiplicities,
        0,
        0,
        &mut vec![],
        0.0,
        &mut best,
        &mut count,
    );
    best.1
}

// =============================================================================
// Defect Charge State Guessing
// =============================================================================

/// Result of charge state guessing for a defect.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChargeStateGuess {
    /// The predicted charge state.
    pub charge: i32,
    /// Probability/confidence of this charge state (0-1).
    pub probability: f64,
    /// Human-readable reasoning for this charge state.
    pub reasoning: String,
}

/// Get normalized oxidation state probabilities for an element from ICSD data.
///
/// Returns a vector of (oxidation_state, probability) pairs sorted by decreasing probability.
fn get_element_oxi_probs(symbol: &str) -> Vec<(i8, f64)> {
    let icsd_data = get_icsd_oxi_prob();
    let prefix = format!("{symbol}:");

    let probs: Vec<(i8, u32)> = icsd_data
        .iter()
        .filter(|(key, _)| key.starts_with(&prefix))
        .filter_map(|(key, &count)| {
            let oxi_str = key.strip_prefix(&prefix)?;
            let oxi: i8 = oxi_str.parse().ok()?;
            Some((oxi, count))
        })
        .collect();

    // Normalize to probabilities
    let total: u32 = probs.iter().map(|(_, count)| count).sum();
    if total == 0 {
        return vec![];
    }

    let mut normalized: Vec<(i8, f64)> = probs
        .iter()
        .map(|&(oxi, count)| (oxi, count as f64 / total as f64))
        .collect();

    // Sort by decreasing probability
    normalized.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    normalized
}

/// Format an oxidation state with superscript notation.
fn format_oxi_state(oxi: i8) -> String {
    let abs_oxi = oxi.abs();
    let sign = if oxi > 0 {
        "+"
    } else if oxi < 0 {
        "-"
    } else {
        ""
    };
    if abs_oxi == 1 && oxi != 0 {
        format!("^{{{sign}}}")
    } else if oxi == 0 {
        String::new()
    } else {
        format!("^{{{abs_oxi}{sign}}}")
    }
}

/// Guess likely charge states for a point defect.
///
/// Uses ICSD oxidation state probabilities to predict which charge states
/// are most likely for a given defect based on the species involved.
///
/// # Arguments
///
/// * `defect_type` - Type of defect (Vacancy, Interstitial, Substitution, Antisite)
/// * `removed_species` - Element symbol removed (for Vacancy, Antisite)
/// * `added_species` - Element symbol added (for Interstitial, Substitution, Antisite)
/// * `original_species` - Original element (for Substitution)
/// * `max_charge` - Maximum absolute charge to consider (default: 4)
///
/// # Returns
///
/// Vector of `ChargeStateGuess` sorted by decreasing probability.
///
/// # Examples
///
/// ```rust,ignore
/// use ferrox::defects::DefectType;
/// use ferrox::oxidation::guess_defect_charge_states;
///
/// // Oxygen vacancy in oxide: O^{2-} removed => +2, +1, 0 likely
/// let charges = guess_defect_charge_states(
///     DefectType::Vacancy, Some("O"), None, None, 4
/// );
/// // Returns: [{charge: 2, prob: ~0.85}, {charge: 1, prob: ~0.10}, ...]
/// ```
pub fn guess_defect_charge_states(
    defect_type: DefectType,
    removed_species: Option<&str>,
    added_species: Option<&str>,
    original_species: Option<&str>,
    max_charge: i32,
) -> Vec<ChargeStateGuess> {
    let mut guesses: Vec<ChargeStateGuess> = Vec::new();

    match defect_type {
        DefectType::Vacancy => {
            // Vacancy: charge = -oxidation_state of removed species
            let Some(removed) = removed_species else {
                return vec![];
            };
            let oxi_probs = get_element_oxi_probs(removed);
            if oxi_probs.is_empty() {
                // No ICSD data; return neutral only
                return vec![ChargeStateGuess {
                    charge: 0,
                    probability: 1.0,
                    reasoning: format!("V_{{{removed}}}: no ICSD data, assuming neutral"),
                }];
            }

            for (oxi, prob) in oxi_probs {
                let charge = -(oxi as i32);
                if charge.abs() <= max_charge {
                    let oxi_fmt = format_oxi_state(oxi);
                    guesses.push(ChargeStateGuess {
                        charge,
                        probability: prob,
                        reasoning: format!("{removed}{oxi_fmt} vacancy => {charge:+}"),
                    });
                }
            }

            // Always include neutral with small probability if not already present
            if !guesses.iter().any(|guess| guess.charge == 0) {
                guesses.push(ChargeStateGuess {
                    charge: 0,
                    probability: 0.01,
                    reasoning: format!("V_{{{removed}}}^0: neutral defect"),
                });
            }
        }
        DefectType::Interstitial => {
            // Interstitial: charge = oxidation_state of added species
            let Some(added) = added_species else {
                return vec![];
            };
            let oxi_probs = get_element_oxi_probs(added);
            if oxi_probs.is_empty() {
                return vec![ChargeStateGuess {
                    charge: 0,
                    probability: 1.0,
                    reasoning: format!("{added}_i: no ICSD data, assuming neutral"),
                }];
            }

            for (oxi, prob) in oxi_probs {
                let charge = oxi as i32;
                if charge.abs() <= max_charge {
                    let oxi_fmt = format_oxi_state(oxi);
                    guesses.push(ChargeStateGuess {
                        charge,
                        probability: prob,
                        reasoning: format!("{added}{oxi_fmt} interstitial => {charge:+}"),
                    });
                }
            }

            // Always include neutral with small probability if not already present
            if !guesses.iter().any(|guess| guess.charge == 0) {
                guesses.push(ChargeStateGuess {
                    charge: 0,
                    probability: 0.01,
                    reasoning: format!("{added}_i^0: neutral defect"),
                });
            }
        }
        DefectType::Substitution => {
            // Substitution: charge = new_oxidation - original_oxidation
            let (Some(added), Some(original)) = (added_species, original_species) else {
                return vec![];
            };
            let added_oxi_probs = get_element_oxi_probs(added);
            let original_oxi_probs = get_element_oxi_probs(original);

            if added_oxi_probs.is_empty() || original_oxi_probs.is_empty() {
                return vec![ChargeStateGuess {
                    charge: 0,
                    probability: 1.0,
                    reasoning: format!("{added}_{{{original}}}: no ICSD data, assuming neutral"),
                }];
            }

            // Consider all combinations, weight by product of probabilities
            let mut charge_probs: HashMap<i32, (f64, String)> = HashMap::new();

            for &(added_oxi, added_prob) in &added_oxi_probs {
                for &(orig_oxi, orig_prob) in &original_oxi_probs {
                    let charge = (added_oxi as i32) - (orig_oxi as i32);
                    if charge.abs() <= max_charge {
                        let combined_prob = added_prob * orig_prob;
                        let added_fmt = format_oxi_state(added_oxi);
                        let orig_fmt = format_oxi_state(orig_oxi);
                        let reasoning = format!(
                            "{added}{added_fmt} on {original}{orig_fmt} site => {charge:+}"
                        );

                        charge_probs
                            .entry(charge)
                            .and_modify(|(prob, _)| *prob += combined_prob)
                            .or_insert((combined_prob, reasoning));
                    }
                }
            }

            guesses = charge_probs
                .into_iter()
                .map(|(charge, (prob, reasoning))| ChargeStateGuess {
                    charge,
                    probability: prob,
                    reasoning,
                })
                .collect();

            // Always include neutral with small probability if not already present
            if !guesses.iter().any(|guess| guess.charge == 0) {
                guesses.push(ChargeStateGuess {
                    charge: 0,
                    probability: 0.01,
                    reasoning: format!("{added}_{{{original}}}^0: neutral defect"),
                });
            }
        }
        DefectType::Antisite => {
            // Antisite: effectively two substitutions, charge = (A_oxi - B_oxi) + (B_oxi - A_oxi) = 0
            // But individual sites can have different oxidation states
            let (Some(added), Some(removed)) = (added_species, removed_species) else {
                return vec![];
            };
            let added_oxi_probs = get_element_oxi_probs(added);
            let removed_oxi_probs = get_element_oxi_probs(removed);

            if added_oxi_probs.is_empty() || removed_oxi_probs.is_empty() {
                return vec![ChargeStateGuess {
                    charge: 0,
                    probability: 1.0,
                    reasoning: format!("{added}_{{{removed}}}: no ICSD data, assuming neutral"),
                }];
            }

            // For antisite pairs, consider charge as difference in oxidation states
            // between the two swapped atoms at their new sites
            let mut charge_probs: HashMap<i32, (f64, String)> = HashMap::new();

            for &(added_oxi, added_prob) in &added_oxi_probs {
                for &(removed_oxi, removed_prob) in &removed_oxi_probs {
                    // Net charge = (new_at_site_A - expected_at_A) + (new_at_site_B - expected_at_B)
                    // = (removed_oxi - added_oxi) + (added_oxi - removed_oxi) = 0 if same oxidation state
                    // But if they have different oxidation states in their new environments...
                    let charge = (removed_oxi as i32) - (added_oxi as i32);
                    if charge.abs() <= max_charge {
                        let combined_prob = added_prob * removed_prob;
                        let added_fmt = format_oxi_state(added_oxi);
                        let removed_fmt = format_oxi_state(removed_oxi);
                        let reasoning = format!(
                            "{removed}{removed_fmt} <-> {added}{added_fmt} antisite => {charge:+}"
                        );

                        charge_probs
                            .entry(charge)
                            .and_modify(|(prob, _)| *prob += combined_prob)
                            .or_insert((combined_prob, reasoning));
                    }
                }
            }

            guesses = charge_probs
                .into_iter()
                .map(|(charge, (prob, reasoning))| ChargeStateGuess {
                    charge,
                    probability: prob,
                    reasoning,
                })
                .collect();

            // Always include neutral with small probability if not already present
            if !guesses.iter().any(|guess| guess.charge == 0) {
                guesses.push(ChargeStateGuess {
                    charge: 0,
                    probability: 0.01,
                    reasoning: format!("{added}_{{{removed}}} antisite: neutral defect"),
                });
            }
        }
    }

    // Normalize probabilities so they sum to 1
    let total_prob: f64 = guesses.iter().map(|guess| guess.probability).sum();
    if total_prob > 0.0 {
        for guess in &mut guesses {
            guess.probability /= total_prob;
        }
    }

    // Sort by probability descending
    guesses.sort_by(|a, b| {
        b.probability
            .partial_cmp(&a.probability)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    guesses
}

/// Guess charge states for multiple defects at once.
///
/// Convenience wrapper for batch processing of defects.
///
/// # Arguments
///
/// * `defects` - Slice of tuples: (defect_type, removed_species, added_species, original_species)
/// * `max_charge` - Maximum absolute charge to consider
///
/// # Returns
///
/// Vector of charge state guess vectors, one per defect.
#[allow(clippy::type_complexity)]
pub fn guess_defect_charge_states_batch(
    defects: &[(DefectType, Option<&str>, Option<&str>, Option<&str>)],
    max_charge: i32,
) -> Vec<Vec<ChargeStateGuess>> {
    defects
        .iter()
        .map(|(defect_type, removed, added, original)| {
            guess_defect_charge_states(*defect_type, *removed, *added, *original, max_charge)
        })
        .collect()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_data_loading() {
        let oxi_prob = get_icsd_oxi_prob();
        assert!(
            !oxi_prob.is_empty() && oxi_prob.contains_key("Fe:3") && oxi_prob.contains_key("O:-2")
        );
        let bv_stats = get_icsd_bv_stats();
        assert!(!bv_stats.is_empty() && bv_stats.contains_key("Fe:3"));
        let bv_params = get_bv_params();
        assert!(
            !bv_params.is_empty() && bv_params.contains_key("Fe") && bv_params.contains_key("O")
        );
    }

    #[test]
    fn test_species_key() {
        for (elem, oxi, expected) in [
            (Element::Fe, 3, "Fe:3"),
            (Element::O, -2, "O:-2"),
            (Element::Na, 1, "Na:1"),
        ] {
            assert_eq!(species_key(elem, oxi), expected);
        }
    }

    #[test]
    fn test_is_electronegative() {
        assert!(
            [Element::O, Element::F, Element::Cl]
                .iter()
                .all(|&e| is_electronegative(e))
        );
        assert!(
            [Element::Na, Element::Fe, Element::Ca]
                .iter()
                .all(|&e| !is_electronegative(e))
        );
    }

    #[test]
    fn test_calculate_bond_valence() {
        assert!(calculate_bond_valence(Element::Fe, Element::O, 2.0, 1.0) > 0.0); // Fe-O positive
        assert_eq!(
            calculate_bond_valence(Element::Fe, Element::Fe, 2.5, 1.0),
            0.0
        ); // same elem
        assert_eq!(
            calculate_bond_valence(Element::Na, Element::K, 3.0, 1.0),
            0.0
        ); // non-electroneg
    }

    #[test]
    fn test_calculate_bv_sum() {
        // Fe with 6 O neighbors at 2.0 Å (octahedral) should give BVS ~3
        let neighbors = vec![
            BvNeighbor {
                element: Element::O,
                distance: 2.0,
                occupancy: 1.0
            };
            6
        ];
        let bvs = calculate_bv_sum(Element::Fe, &neighbors, 1.0);
        assert!((2.0..4.0).contains(&bvs), "Fe BVS={bvs}");
    }

    #[test]
    fn test_get_oxi_probability() {
        assert!(get_oxi_probability(Element::Fe, 3).unwrap() > 0);
        assert!(get_oxi_probability(Element::O, -2).unwrap() > 10000);
        assert!(get_oxi_probability(Element::Fe, 10).is_none());
    }

    // Helper to verify oxidation state guesses
    fn check_oxi_guess(
        name: &str,
        elements: &[Element],
        amounts: &[f64],
        expected: &[(&str, f64)],
    ) {
        let guesses = oxi_state_guesses(elements, amounts, 0, None, false, None);
        assert!(!guesses.is_empty(), "{name}: should find solution");
        let best = &guesses[0];
        for (elem, oxi) in expected {
            let actual = *best.oxidation_states.get(*elem).unwrap();
            assert!(
                (actual - oxi).abs() < 0.01,
                "{name}: {elem} should be {oxi:+}, got {actual:+}"
            );
        }
    }

    #[test]
    fn test_oxi_state_guesses_common_compounds() {
        check_oxi_guess(
            "NaCl",
            &[Element::Na, Element::Cl],
            &[1.0, 1.0],
            &[("Na", 1.0), ("Cl", -1.0)],
        );
        check_oxi_guess(
            "Fe2O3",
            &[Element::Fe, Element::O],
            &[2.0, 3.0],
            &[("Fe", 3.0), ("O", -2.0)],
        );
        check_oxi_guess("Fe (single)", &[Element::Fe], &[2.0], &[("Fe", 0.0)]);
    }

    #[test]
    fn test_oxi_state_guesses_ternary() {
        // LiFePO4: Li+, Fe2+, P5+, O2-
        let guesses = oxi_state_guesses(
            &[Element::Li, Element::Fe, Element::P, Element::O],
            &[1.0, 1.0, 1.0, 4.0],
            0,
            None,
            false,
            None,
        );
        assert!(!guesses.is_empty());
        // Verify sorted by decreasing probability
        assert!(
            guesses
                .windows(2)
                .all(|w| w[0].probability >= w[1].probability)
        );
        check_oxi_guess(
            "LiFePO4",
            &[Element::Li, Element::Fe, Element::P, Element::O],
            &[1.0, 1.0, 1.0, 4.0],
            &[("Li", 1.0), ("P", 5.0), ("O", -2.0)],
        );
    }

    #[test]
    fn test_combinations_with_replacement() {
        // C(2+2-1, 2) = C(3,2) = 3 non-decreasing combinations: [1,1], [1,2], [2,2]
        let combos = combinations_with_replacement(&[1, 2], 2);
        assert_eq!(combos.len(), 3);
        assert!(combos.iter().all(|c| c.windows(2).all(|w| w[0] <= w[1]))); // non-decreasing
        assert!(combinations_with_replacement(&[], 3).is_empty());
        assert_eq!(
            combinations_with_replacement(&[1, 2, 3], 0),
            vec![Vec::<i8>::new()]
        );
        // C(3+3-1, 3) = C(5,3) = 10
        assert_eq!(combinations_with_replacement(&[1, 2, 3], 3).len(), 10);
        // Guard against blow-ups: C(10+10-1, 10) = C(19,10) = 92378, under limit
        assert!(!combinations_with_replacement(&(0..10).collect::<Vec<i8>>(), 10).is_empty());
        // But C(2+100-1, 100) = C(101,2) = 5050 is fine, check large count doesn't overflow
        assert_eq!(combinations_with_replacement(&[1, 2], 100).len(), 101); // C(101,1) = 101
    }

    #[test]
    fn test_get_candidate_oxi_states() {
        let fe = get_candidate_oxi_states(Element::Fe, false);
        assert!(fe.contains(&2) && fe.contains(&3));
        assert!(get_candidate_oxi_states(Element::O, false).contains(&-2));
    }

    // === Defect Charge State Guessing Tests ===

    #[test]
    fn test_format_oxi_state() {
        assert_eq!(format_oxi_state(2), "^{2+}");
        assert_eq!(format_oxi_state(-2), "^{2-}");
        assert_eq!(format_oxi_state(1), "^{+}");
        assert_eq!(format_oxi_state(-1), "^{-}");
        assert_eq!(format_oxi_state(0), "");
    }

    #[test]
    fn test_get_element_oxi_probs() {
        // Oxygen should have -2 as most common
        let o_probs = get_element_oxi_probs("O");
        assert!(!o_probs.is_empty());
        assert_eq!(o_probs[0].0, -2, "O should have -2 as most common");

        // Iron should have multiple oxidation states
        let fe_probs = get_element_oxi_probs("Fe");
        assert!(!fe_probs.is_empty());
        assert!(
            fe_probs.iter().any(|(oxi, _)| *oxi == 3),
            "Fe should have +3"
        );
        assert!(
            fe_probs.iter().any(|(oxi, _)| *oxi == 2),
            "Fe should have +2"
        );

        // Unknown element should return empty
        let unknown = get_element_oxi_probs("Xx");
        assert!(unknown.is_empty());
    }

    #[test]
    fn test_vacancy_charge_states() {
        // Oxygen vacancy: O^{2-} removed => charge = +2 most likely
        let charges = guess_defect_charge_states(DefectType::Vacancy, Some("O"), None, None, 4);
        assert!(!charges.is_empty());
        assert_eq!(charges[0].charge, 2, "O vacancy should be +2");
        assert!(
            charges[0].probability > 0.5,
            "O vacancy +2 should be dominant"
        );

        // Sodium vacancy: Na^{+} removed => charge = -1 most likely
        let na_charges = guess_defect_charge_states(DefectType::Vacancy, Some("Na"), None, None, 4);
        assert!(!na_charges.is_empty());
        assert_eq!(na_charges[0].charge, -1, "Na vacancy should be -1");
    }

    #[test]
    fn test_interstitial_charge_states() {
        // Lithium interstitial: Li^{+} added => charge = +1 most likely
        let charges =
            guess_defect_charge_states(DefectType::Interstitial, None, Some("Li"), None, 4);
        assert!(!charges.is_empty());
        assert_eq!(charges[0].charge, 1, "Li interstitial should be +1");

        // Oxygen interstitial: O^{2-} added => charge = -2 most likely
        let o_charges =
            guess_defect_charge_states(DefectType::Interstitial, None, Some("O"), None, 4);
        assert!(!o_charges.is_empty());
        assert_eq!(o_charges[0].charge, -2, "O interstitial should be -2");
    }

    #[test]
    fn test_substitution_charge_states() {
        // Al^{3+} on Si^{4+} site => charge = -1
        let charges =
            guess_defect_charge_states(DefectType::Substitution, None, Some("Al"), Some("Si"), 4);
        assert!(!charges.is_empty());
        // Al is typically 3+, Si is typically 4+, so charge should be -1
        assert!(
            charges.iter().any(|guess| guess.charge == -1),
            "Al on Si should have -1 as possibility"
        );

        // P^{5+} on Si^{4+} site => charge = +1
        let p_charges =
            guess_defect_charge_states(DefectType::Substitution, None, Some("P"), Some("Si"), 4);
        assert!(!p_charges.is_empty());
        assert!(
            p_charges.iter().any(|guess| guess.charge == 1),
            "P on Si should have +1 as possibility"
        );
    }

    #[test]
    fn test_antisite_charge_states() {
        // Na-Cl antisite: should have various charge states
        let charges =
            guess_defect_charge_states(DefectType::Antisite, Some("Na"), Some("Cl"), None, 4);
        assert!(!charges.is_empty());
        // Na is +1, Cl is -1, so antisite charge = (+1) - (-1) = +2 or vice versa
        assert!(
            charges.iter().any(|guess| guess.charge.abs() <= 2),
            "Na-Cl antisite should have reasonable charges"
        );
    }

    #[test]
    fn test_charge_state_probabilities_normalized() {
        let charges = guess_defect_charge_states(DefectType::Vacancy, Some("Fe"), None, None, 4);
        assert!(!charges.is_empty());
        let total: f64 = charges.iter().map(|guess| guess.probability).sum();
        assert!(
            (total - 1.0).abs() < 0.01,
            "Probabilities should sum to 1, got {total}"
        );
    }

    #[test]
    fn test_charge_state_sorted_by_probability() {
        let charges = guess_defect_charge_states(DefectType::Vacancy, Some("O"), None, None, 4);
        assert!(charges.len() >= 2);
        for window in charges.windows(2) {
            assert!(
                window[0].probability >= window[1].probability,
                "Charges should be sorted by decreasing probability"
            );
        }
    }

    #[test]
    fn test_max_charge_filtering() {
        // With max_charge = 1, should not see +2 charges for O vacancy
        let charges = guess_defect_charge_states(DefectType::Vacancy, Some("O"), None, None, 1);
        assert!(
            charges.iter().all(|guess| guess.charge.abs() <= 1),
            "All charges should be within max_charge"
        );
    }

    #[test]
    fn test_missing_species_returns_empty() {
        let charges = guess_defect_charge_states(DefectType::Vacancy, None, None, None, 4);
        assert!(charges.is_empty(), "Missing species should return empty");

        let int_charges = guess_defect_charge_states(DefectType::Interstitial, None, None, None, 4);
        assert!(
            int_charges.is_empty(),
            "Missing species should return empty"
        );
    }

    #[test]
    fn test_batch_charge_state_guessing() {
        let defects = vec![
            (DefectType::Vacancy, Some("O"), None, None),
            (DefectType::Interstitial, None, Some("Li"), None),
            (DefectType::Substitution, None, Some("Al"), Some("Si")),
        ];
        let results = guess_defect_charge_states_batch(&defects, 4);
        assert_eq!(results.len(), 3);
        assert!(!results[0].is_empty()); // O vacancy
        assert!(!results[1].is_empty()); // Li interstitial
        assert!(!results[2].is_empty()); // Al on Si
    }
}
