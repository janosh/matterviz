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

use crate::element::Element;

// Bond valence "softness" parameter (Brown & Altermatt, Acta Cryst. B41, 244, 1985)
const BV_SOFTNESS: f64 = 0.31;

/// Maximum permutations for charge-balanced enumeration to prevent combinatorial explosion.
pub const MAX_PERMUTATIONS: usize = 100_000;

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
/// Returns 0 if either element is not in the BV parameters table,
/// or if neither element is electronegative.
pub fn calculate_bond_valence(
    element1: Element,
    element2: Element,
    distance: f64,
    scale_factor: f64,
) -> Option<f64> {
    // BV only contributes if at least one element is electronegative
    if !is_electronegative(element1) && !is_electronegative(element2) {
        return Some(0.0);
    }

    // Same element doesn't contribute
    if element1 == element2 {
        return Some(0.0);
    }

    let params1 = get_bv_params_for_element(element1)?;
    let params2 = get_bv_params_for_element(element2)?;

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

    Some(vij * sign)
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
/// The bond valence sum, or None if BV parameters are missing.
pub fn calculate_bv_sum(
    site_element: Element,
    neighbors: &[BvNeighbor],
    scale_factor: f64,
) -> Option<f64> {
    let mut bv_sum = 0.0;

    for neighbor in neighbors {
        if let Some(vij) = calculate_bond_valence(
            site_element,
            neighbor.element,
            neighbor.distance,
            scale_factor,
        ) {
            bv_sum += vij * neighbor.occupancy;
        } else {
            // Missing BV params - return None
            return None;
        }
    }

    Some(bv_sum)
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

/// Generate all combinations of oxidation states with replacement.
///
/// For n sites with k possible oxidation states, generates all k^n combinations.
fn combinations_with_replacement(items: &[i8], count: usize) -> Vec<Vec<i8>> {
    if count == 0 {
        return vec![vec![]];
    }
    if items.is_empty() {
        return vec![];
    }

    let mut result = Vec::new();
    let sub_combinations = combinations_with_replacement(items, count - 1);

    for item in items {
        for combo in &sub_combinations {
            let mut new_combo = vec![*item];
            new_combo.extend(combo);
            result.push(new_combo);
        }
    }

    result
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
    // Single element always has oxidation state 0
    let unique_elements: std::collections::HashSet<_> = elements.iter().collect();
    if unique_elements.len() == 1 {
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
            let sum: i32 = combo.iter().map(|&o| o as i32).sum();

            // Calculate score based on ICSD probability
            let score: f64 = combo
                .iter()
                .filter_map(|&o| {
                    let key = species_key(el, o);
                    icsd_prob.get(&key).map(|&p| p as f64)
                })
                .sum();

            // Keep the best-scoring combination for each sum
            let entry = sum_map.entry(sum).or_insert((0.0, combo.clone()));
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
                let total_score: f64 = current_scores.iter().sum();
                solutions.push(OxiStateGuess {
                    oxidation_states: oxi_states,
                    probability: total_score,
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

/// Helper: compute GCD of two integers.
fn gcd_i32(mut a: i32, mut b: i32) -> i32 {
    a = a.abs();
    b = b.abs();
    while b != 0 {
        let temp = b;
        b = a % b;
        a = temp;
    }
    a
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_data_loading() {
        // Test that all data files load successfully
        let oxi_prob = get_icsd_oxi_prob();
        assert!(!oxi_prob.is_empty(), "ICSD oxi prob should not be empty");
        assert!(oxi_prob.contains_key("Fe:3"), "Should have Fe3+");
        assert!(oxi_prob.contains_key("O:-2"), "Should have O2-");

        let bv_stats = get_icsd_bv_stats();
        assert!(!bv_stats.is_empty(), "BV stats should not be empty");
        assert!(bv_stats.contains_key("Fe:3"), "Should have Fe3+ stats");

        let bv_params = get_bv_params();
        assert!(!bv_params.is_empty(), "BV params should not be empty");
        assert!(bv_params.contains_key("Fe"), "Should have Fe params");
        assert!(bv_params.contains_key("O"), "Should have O params");
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
        for elem in [Element::O, Element::F, Element::Cl] {
            assert!(
                is_electronegative(elem),
                "{elem:?} should be electronegative"
            );
        }
        for elem in [Element::Na, Element::Fe, Element::Ca] {
            assert!(
                !is_electronegative(elem),
                "{elem:?} should NOT be electronegative"
            );
        }
    }

    #[test]
    fn test_calculate_bond_valence() {
        // Fe-O bond at ~2.0 Å should give positive BV (Fe is more electropositive)
        let bv = calculate_bond_valence(Element::Fe, Element::O, 2.0, 1.0);
        assert!(bv.is_some());
        assert!(bv.unwrap() > 0.0, "Fe-O should have positive BV");

        // Same element should give 0
        let bv_same = calculate_bond_valence(Element::Fe, Element::Fe, 2.5, 1.0);
        assert_eq!(bv_same, Some(0.0));

        // Non-electronegative pair should give 0
        let bv_non = calculate_bond_valence(Element::Na, Element::K, 3.0, 1.0);
        assert_eq!(bv_non, Some(0.0));
    }

    #[test]
    fn test_calculate_bv_sum() {
        // Fe with 6 O neighbors at ~2.0 Å (octahedral coordination)
        let neighbors = vec![
            BvNeighbor {
                element: Element::O,
                distance: 2.0,
                occupancy: 1.0,
            };
            6
        ];

        let bv_sum = calculate_bv_sum(Element::Fe, &neighbors, 1.0);
        assert!(bv_sum.is_some());
        // Fe3+ typically has BVS around 3.0
        let sum = bv_sum.unwrap();
        assert!(
            sum > 2.0 && sum < 4.0,
            "Fe BVS should be reasonable: {}",
            sum
        );
    }

    #[test]
    fn test_get_oxi_probability() {
        // Common oxidation states should have high probability
        assert!(
            get_oxi_probability(Element::Fe, 3).unwrap() > 0,
            "Fe3+ common"
        );
        assert!(
            get_oxi_probability(Element::O, -2).unwrap() > 10000,
            "O2- very common"
        );
        // Unlikely oxidation state should be missing
        assert!(
            get_oxi_probability(Element::Fe, 10).is_none(),
            "Fe10+ doesn't exist"
        );
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
        // LiFePO4
        let elements = vec![Element::Li, Element::Fe, Element::P, Element::O];
        let amounts = vec![1.0, 1.0, 1.0, 4.0];

        let guesses = oxi_state_guesses(&elements, &amounts, 0, None, false, None);

        assert!(!guesses.is_empty(), "Should find solutions for LiFePO4");

        // Verify results are sorted by decreasing probability
        for window in guesses.windows(2) {
            assert!(
                window[0].probability >= window[1].probability,
                "Results should be sorted by decreasing probability: {} < {}",
                window[0].probability,
                window[1].probability
            );
        }

        // Best solution should have Li+, Fe2+, P5+, O2-
        let best = &guesses[0];
        assert!(
            (best.oxidation_states.get("Li").unwrap() - 1.0).abs() < 0.01,
            "Li should be +1"
        );
        assert!(
            (best.oxidation_states.get("P").unwrap() - 5.0).abs() < 0.01,
            "P should be +5"
        );
        assert!(
            (best.oxidation_states.get("O").unwrap() - (-2.0)).abs() < 0.01,
            "O should be -2"
        );
        // Fe could be +2 or +3 depending on scoring
    }

    #[test]
    fn test_combinations_with_replacement() {
        // [1,2] choose 2 with replacement: [1,1], [1,2], [2,1], [2,2]
        assert_eq!(combinations_with_replacement(&[1, 2], 2).len(), 4);
    }

    #[test]
    fn test_get_candidate_oxi_states() {
        let fe_states = get_candidate_oxi_states(Element::Fe, false);
        assert!(
            fe_states.contains(&3) && fe_states.contains(&2),
            "Fe should have +2/+3"
        );

        let o_states = get_candidate_oxi_states(Element::O, false);
        assert!(o_states.contains(&-2), "O should have -2");
    }
}
