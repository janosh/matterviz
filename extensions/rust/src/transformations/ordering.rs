//! Ordering transformations for disordered structures.
//!
//! Internal implementations used by `Structure` methods.
//! The public API is via `Structure::order_disordered()`, etc.

use crate::algorithms::Ewald;
use crate::error::{FerroxError, Result};
use crate::species::{SiteOccupancy, Species};
use crate::structure::Structure;
use crate::transformations::{Transform, TransformMany};
use itertools::Itertools;
use std::cmp::Ordering as CmpOrdering;
use std::collections::{BinaryHeap, HashSet};

/// Default initial capacity for ordering result vectors.
/// Balances memory allocation overhead vs. over-allocation for typical use cases.
const INITIAL_ORDERING_CAPACITY: usize = 1024;

/// Configuration for ordering disordered structures.
#[derive(Debug, Clone)]
pub struct OrderDisorderedConfig {
    /// Maximum number of structures to return (None = all)
    pub max_structures: Option<usize>,
    /// Accuracy for Ewald energy calculation
    pub ewald_accuracy: f64,
    /// Whether to return structures sorted by energy
    pub sort_by_energy: bool,
    /// Whether to compute Ewald energies at all
    pub compute_energy: bool,
}

impl Default for OrderDisorderedConfig {
    fn default() -> Self {
        Self {
            max_structures: None,
            ewald_accuracy: 1e-5,
            sort_by_energy: true,
            compute_energy: true,
        }
    }
}

/// Enumerate orderings of a disordered structure.
///
/// Takes a structure with disordered sites (multiple species per site) and
/// enumerates all possible ordered configurations. Structures are optionally
/// ranked by Ewald energy.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::{TransformMany, OrderDisorderedTransform};
///
/// let config = OrderDisorderedConfig {
///     max_structures: Some(100),
///     ..Default::default()
/// };
/// let transform = OrderDisorderedTransform::new(config);
///
/// for result in transform.iter_apply(&disordered) {
///     let ordered = result?;
///     println!("Energy: {:?}", ordered.properties.get("ewald_energy"));
/// }
/// ```
#[derive(Debug, Clone)]
pub struct OrderDisorderedTransform {
    /// Configuration options
    pub config: OrderDisorderedConfig,
}

impl OrderDisorderedTransform {
    /// Create a new ordering transform with the given configuration.
    pub fn new(config: OrderDisorderedConfig) -> Self {
        Self { config }
    }
}

impl Default for OrderDisorderedTransform {
    fn default() -> Self {
        Self::new(OrderDisorderedConfig::default())
    }
}

/// Iterator over ordered structures.
pub struct OrderingIterator {
    structures: std::vec::IntoIter<Result<Structure>>,
}

impl Iterator for OrderingIterator {
    type Item = Result<Structure>;

    fn next(&mut self) -> Option<Self::Item> {
        self.structures.next()
    }
}

impl TransformMany for OrderDisorderedTransform {
    type Iter = OrderingIterator;

    fn iter_apply(&self, structure: &Structure) -> Self::Iter {
        let results = self.enumerate_orderings(structure);
        OrderingIterator {
            structures: results.into_iter(),
        }
    }
}

/// Wrapper for heap-based top-k selection by energy.
/// Uses max-heap with inverted ordering to efficiently track k lowest energies.
struct EnergyStructure {
    energy: f64,
    structure: Structure,
}

impl PartialEq for EnergyStructure {
    fn eq(&self, other: &Self) -> bool {
        self.energy == other.energy
    }
}

impl Eq for EnergyStructure {}

impl PartialOrd for EnergyStructure {
    fn partial_cmp(&self, other: &Self) -> Option<CmpOrdering> {
        Some(self.cmp(other))
    }
}

impl Ord for EnergyStructure {
    fn cmp(&self, other: &Self) -> CmpOrdering {
        // Standard ordering: highest energy at top of heap
        // When heap exceeds capacity, pop() removes highest energy (worst)
        // This keeps the k lowest-energy (best) structures
        // NaN energies are treated as equal (both represent invalid/failed computations)
        self.energy
            .partial_cmp(&other.energy)
            .unwrap_or(CmpOrdering::Equal)
    }
}

impl OrderDisorderedTransform {
    /// Enumerate orderings of a disordered structure with lazy evaluation.
    ///
    /// When `sort_by_energy` is false, uses early termination after `max_structures`.
    /// When `sort_by_energy` is true, uses a bounded heap for top-k selection
    /// to avoid materializing all combinations.
    fn enumerate_orderings(&self, structure: &Structure) -> Vec<Result<Structure>> {
        // Check if structure is actually disordered
        if structure.is_ordered() {
            return vec![Ok(structure.clone())];
        }

        // Find disordered sites and their possible species
        let site_options: Vec<Vec<Species>> = structure
            .site_occupancies
            .iter()
            .map(|site_occ| site_occ.species.iter().map(|(sp, _)| *sp).collect())
            .collect();

        let ewald = Ewald::new().with_accuracy(self.config.ewald_accuracy);

        // Create lazy iterator over all orderings (no .collect()!)
        let orderings_iter = site_options.into_iter().multi_cartesian_product();

        if self.config.sort_by_energy && self.config.compute_energy {
            // Use heap-based top-k selection
            self.enumerate_with_heap(structure, orderings_iter, &ewald)
        } else {
            // Use early termination - stop after max_structures
            self.enumerate_with_early_termination(structure, orderings_iter, &ewald)
        }
    }

    /// Enumerate orderings with early termination (no sorting).
    fn enumerate_with_early_termination<I>(
        &self,
        structure: &Structure,
        orderings_iter: I,
        ewald: &Ewald,
    ) -> Vec<Result<Structure>>
    where
        I: Iterator<Item = Vec<Species>>,
    {
        let max = self.config.max_structures.unwrap_or(usize::MAX);
        let mut results = Vec::with_capacity(max.min(INITIAL_ORDERING_CAPACITY));

        for species_list in orderings_iter {
            if results.len() >= max {
                break; // Early termination
            }

            let mut ordered_struct = structure.clone();

            // Set species for each site
            for (idx, species) in species_list.iter().enumerate() {
                ordered_struct.site_occupancies[idx] = SiteOccupancy::ordered(*species);
            }

            // Compute energy if requested (skip silently if structure lacks oxidation states)
            if self.config.compute_energy
                && let Ok(energy) = ewald.energy(&ordered_struct)
            {
                ordered_struct
                    .properties
                    .insert("ewald_energy".to_string(), serde_json::json!(energy));
            }

            results.push(Ok(ordered_struct));
        }

        results
    }

    /// Enumerate orderings with heap-based top-k selection (sorted by energy).
    fn enumerate_with_heap<I>(
        &self,
        structure: &Structure,
        orderings_iter: I,
        ewald: &Ewald,
    ) -> Vec<Result<Structure>>
    where
        I: Iterator<Item = Vec<Species>>,
    {
        let max = self.config.max_structures.unwrap_or(usize::MAX);

        // Use a max-heap to keep k lowest energies
        // Highest energy is at top, so pop() removes the worst structure
        let mut heap: BinaryHeap<EnergyStructure> = BinaryHeap::new();

        for species_list in orderings_iter {
            let mut ordered_struct = structure.clone();

            // Set species for each site
            for (idx, species) in species_list.iter().enumerate() {
                ordered_struct.site_occupancies[idx] = SiteOccupancy::ordered(*species);
            }

            // Compute energy (mark failures so callers can distinguish from high energy)
            let energy = match ewald.energy(&ordered_struct) {
                Ok(energy) => {
                    ordered_struct
                        .properties
                        .insert("ewald_energy".to_string(), serde_json::json!(energy));
                    energy
                }
                Err(_) => {
                    ordered_struct
                        .properties
                        .insert("ewald_failed".to_string(), serde_json::json!(true));
                    f64::INFINITY
                }
            };

            // Add to heap
            heap.push(EnergyStructure {
                energy,
                structure: ordered_struct,
            });

            // If heap exceeds max, remove the highest energy (worst) structure
            if heap.len() > max {
                heap.pop();
            }
        }

        // Extract results sorted by energy (lowest first)
        // BinaryHeap::into_vec() returns elements in arbitrary order, so we must sort.
        // (into_sorted_vec is nightly-only as of Rust 1.75)
        let mut results: Vec<_> = heap.into_vec();
        results.sort_by(|a, b| {
            a.energy
                .partial_cmp(&b.energy)
                .unwrap_or(CmpOrdering::Equal)
        });

        results.into_iter().map(|es| Ok(es.structure)).collect()
    }
}

/// Algorithm for partial species removal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RemovalAlgo {
    /// Exhaustive enumeration: O(C(n,k)) complexity
    /// This is the reference implementation - correct but slow for large systems.
    #[default]
    Complete,
}

/// Configuration for partial species removal.
#[derive(Debug, Clone)]
pub struct PartialRemoveConfig {
    /// Species to partially remove
    pub species: Species,
    /// Fraction to remove (0.0-1.0)
    pub fraction: f64,
    /// Removal algorithm
    pub algo: RemovalAlgo,
    /// Maximum structures to return
    pub max_structures: Option<usize>,
    /// Ewald accuracy for energy ranking
    pub ewald_accuracy: f64,
}

impl PartialRemoveConfig {
    /// Create a new config for partial removal.
    ///
    /// # Arguments
    /// * `species` - The species to partially remove
    /// * `fraction` - Fraction to remove (0.0-1.0)
    pub fn new(species: Species, fraction: f64) -> Self {
        Self {
            species,
            fraction,
            algo: RemovalAlgo::Complete,
            max_structures: None,
            ewald_accuracy: 1e-5,
        }
    }
}

/// Partial removal of species, ranked by Ewald energy.
///
/// Removes a fraction of a specific species and enumerates all
/// possible removal patterns, ranked by Coulomb energy.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::{TransformMany, PartialRemoveTransform, PartialRemoveConfig};
/// use ferrox::species::Species;
/// use ferrox::element::Element;
///
/// let mut config = PartialRemoveConfig::new(Species::new(Element::Li, Some(1)), 0.5);
/// config.max_structures = Some(10);
/// let transform = PartialRemoveTransform::new(config);
///
/// for result in transform.iter_apply(&lio2) {
///     let removed = result?;
///     // Half the Li atoms have been removed
/// }
/// ```
#[derive(Debug, Clone)]
pub struct PartialRemoveTransform {
    /// Configuration
    pub config: PartialRemoveConfig,
}

impl PartialRemoveTransform {
    /// Create a new partial remove transform.
    pub fn new(config: PartialRemoveConfig) -> Self {
        Self { config }
    }
}

/// Iterator over structures with partial removal.
pub struct PartialRemoveIterator {
    structures: std::vec::IntoIter<Result<Structure>>,
}

impl Iterator for PartialRemoveIterator {
    type Item = Result<Structure>;

    fn next(&mut self) -> Option<Self::Item> {
        self.structures.next()
    }
}

impl TransformMany for PartialRemoveTransform {
    type Iter = PartialRemoveIterator;

    fn iter_apply(&self, structure: &Structure) -> Self::Iter {
        let results = self.enumerate_removals(structure);
        PartialRemoveIterator {
            structures: results.into_iter(),
        }
    }
}

impl PartialRemoveTransform {
    /// Enumerate all removal patterns.
    fn enumerate_removals(&self, structure: &Structure) -> Vec<Result<Structure>> {
        // Validate fraction is in [0.0, 1.0]
        if !(0.0..=1.0).contains(&self.config.fraction) {
            return vec![Err(FerroxError::TransformError {
                reason: format!(
                    "Fraction must be in [0.0, 1.0], got {}",
                    self.config.fraction
                ),
            })];
        }

        // Find sites with the target species
        let target_sites: Vec<usize> = structure
            .site_occupancies
            .iter()
            .enumerate()
            .filter(|(_, site_occ)| {
                site_occ
                    .species
                    .iter()
                    .any(|(sp, _)| *sp == self.config.species)
            })
            .map(|(idx, _)| idx)
            .collect();

        if target_sites.is_empty() {
            return vec![Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!("No sites with species {} found", self.config.species),
            })];
        }

        // Calculate number of sites to remove
        let n_remove = ((target_sites.len() as f64) * self.config.fraction).round() as usize;
        if n_remove == 0 {
            return vec![Ok(structure.clone())]; // Nothing to remove
        }

        // Generate all combinations of sites to remove
        let mut results: Vec<(f64, Structure)> = Vec::new();
        let ewald = Ewald::new().with_accuracy(self.config.ewald_accuracy);

        for removal_combo in target_sites.iter().copied().combinations(n_remove) {
            let removal_set: HashSet<usize> = removal_combo.into_iter().collect();

            // Create structure without removed sites
            let (new_occupancies, new_coords): (Vec<_>, Vec<_>) = structure
                .site_occupancies
                .iter()
                .zip(structure.frac_coords.iter())
                .enumerate()
                .filter(|(idx, _)| !removal_set.contains(idx))
                .map(|(_, (occ, coord))| (occ.clone(), *coord))
                .unzip();

            let mut removed_struct = Structure::new_from_occupancies(
                structure.lattice.clone(),
                new_occupancies,
                new_coords,
            );

            // Copy properties
            removed_struct.properties = structure.properties.clone();

            // Compute energy (mark failures so callers can distinguish from high energy)
            let energy = match ewald.energy(&removed_struct) {
                Ok(e) => {
                    removed_struct
                        .properties
                        .insert("ewald_energy".to_string(), serde_json::json!(e));
                    e
                }
                Err(_) => {
                    removed_struct
                        .properties
                        .insert("ewald_failed".to_string(), serde_json::json!(true));
                    f64::INFINITY
                }
            };

            results.push((energy, removed_struct));
        }

        // Sort by energy
        results.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

        // Apply limit
        let max = self.config.max_structures.unwrap_or(results.len());
        results.into_iter().take(max).map(|(_, s)| Ok(s)).collect()
    }
}

/// Scale structure so fractional occupancies become integral site counts.
///
/// Creates the smallest supercell where fractional occupancies can be represented
/// as whole numbers of sites. Fractional occupancies are preserved on each site,
/// representing the probability of each species being present. The actual 0/1
/// species assignment is performed by [`OrderDisorderedTransform`] during enumeration.
///
/// This transform prepares disordered structures for enumeration by ensuring the
/// supercell size matches the least common multiple of all occupancy denominators.
/// For example, a site with 0.25 Li and 0.75 Na requires a 4x supercell so that
/// across all possible orderings, statistically 1 site would have Li and 3 would
/// have Na.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::{Transform, TransformMany, DiscretizeOccupanciesTransform, OrderDisorderedTransform};
///
/// // Structure with 1 site at 0.75 Li, 0.25 vacancy
/// let discretize = DiscretizeOccupanciesTransform::new(10, 0.01);
/// let discretized = discretize.applied(&structure)?;
/// // Now has 4x supercell with 4 disordered sites (fractional occupancies preserved)
///
/// // Use OrderDisorderedTransform to enumerate actual species assignments
/// let order = OrderDisorderedTransform::default();
/// for result in order.iter_apply(&discretized) {
///     let ordered = result?;
///     // Each site now has exactly one species at 1.0 occupancy
/// }
/// ```
#[derive(Debug, Clone)]
pub struct DiscretizeOccupanciesTransform {
    /// Maximum denominator for rationalization
    pub max_denominator: u32,
    /// Tolerance for matching occupancies to fractions
    pub tolerance: f64,
}

impl DiscretizeOccupanciesTransform {
    /// Create a new discretize transform.
    pub fn new(max_denominator: u32, tolerance: f64) -> Self {
        Self {
            max_denominator,
            tolerance,
        }
    }
}

impl Default for DiscretizeOccupanciesTransform {
    fn default() -> Self {
        Self {
            max_denominator: 10,
            tolerance: 0.01,
        }
    }
}

impl Transform for DiscretizeOccupanciesTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        // Collect all unique occupancies
        let mut occupancies: Vec<f64> = Vec::new();
        for site_occ in &structure.site_occupancies {
            for (_, occ) in &site_occ.species {
                if (*occ - 1.0).abs() > self.tolerance && *occ > self.tolerance {
                    occupancies.push(*occ);
                }
            }
        }

        if occupancies.is_empty() {
            return Ok(()); // Already fully occupied
        }

        // Find LCM of all denominators
        let mut lcm = 1u32;
        for occ in &occupancies {
            let (_, denom) = rationalize(*occ, self.max_denominator, self.tolerance)?;
            lcm = num_lcm(lcm, denom);
        }

        if lcm > self.max_denominator {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "Cannot discretize: LCM {} exceeds max_denominator {}",
                    lcm, self.max_denominator
                ),
            });
        }

        // Create supercell - occupancies are preserved (still fractional),
        // representing the probability of each species on each replicated site.
        // OrderDisorderedTransform handles the actual species selection.
        let supercell_matrix = [[lcm as i32, 0, 0], [0, 1, 0], [0, 0, 1]];
        *structure = structure.make_supercell(supercell_matrix)?;
        Ok(())
    }
}

/// Rationalize a float to a fraction p/q with q <= max_denominator.
fn rationalize(val: f64, max_denominator: u32, tolerance: f64) -> Result<(u32, u32)> {
    for denominator in 1..=max_denominator {
        let numerator = (val * denominator as f64).round() as u32;
        let approx = numerator as f64 / denominator as f64;
        if (approx - val).abs() <= tolerance {
            return Ok((numerator, denominator));
        }
    }
    Err(FerroxError::InvalidStructure {
        index: 0,
        reason: format!(
            "Cannot rationalize {} with max_denominator {}",
            val, max_denominator
        ),
    })
}

/// Compute LCM of two numbers.
fn num_lcm(val_a: u32, val_b: u32) -> u32 {
    if val_a == 0 || val_b == 0 {
        return 0;
    }
    (val_a / num_gcd(val_a, val_b)) * val_b
}

/// Compute GCD using Euclidean algorithm.
fn num_gcd(mut val_a: u32, mut val_b: u32) -> u32 {
    while val_b != 0 {
        let temp = val_b;
        val_b = val_a % val_b;
        val_a = temp;
    }
    val_a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;
    use crate::lattice::Lattice;
    use nalgebra::{Matrix3, Vector3};

    /// Create a disordered structure (Fe0.5Co0.5 alloy).
    fn disordered_structure() -> Structure {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(3.0, 3.0, 3.0)));

        let fe = Species::new(Element::Fe, Some(2));
        let co = Species::new(Element::Co, Some(2));

        // Single site with 50% Fe, 50% Co
        let site = SiteOccupancy::new(vec![(fe, 0.5), (co, 0.5)]);

        Structure::new_from_occupancies(lattice, vec![site], vec![Vector3::new(0.0, 0.0, 0.0)])
    }

    /// Create a structure with partial Li occupancy.
    fn partial_li_structure() -> Structure {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(4.0, 4.0, 4.0)));

        let li = Species::new(Element::Li, Some(1));
        let o = Species::new(Element::O, Some(-2));

        Structure::new(
            lattice,
            vec![li, li, li, li, o, o],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.0, 0.0),
                Vector3::new(0.0, 0.5, 0.0),
                Vector3::new(0.0, 0.0, 0.5),
                Vector3::new(0.25, 0.25, 0.25),
                Vector3::new(0.75, 0.75, 0.75),
            ],
        )
    }

    // ========== order_disordered tests (via Structure methods) ==========

    #[test]
    fn test_order_disordered() {
        let structure = disordered_structure();
        let orderings = structure
            .order_disordered(OrderDisorderedConfig::default())
            .unwrap();

        // Single disordered site with 2 species = 2 orderings
        assert_eq!(orderings.len(), 2);
        for ordered in orderings {
            assert!(ordered.is_ordered());
        }
    }

    #[test]
    fn test_order_disordered_max_structures() {
        let structure = disordered_structure();
        let config = OrderDisorderedConfig {
            max_structures: Some(1),
            ..Default::default()
        };
        let orderings = structure.order_disordered(config).unwrap();
        assert_eq!(orderings.len(), 1);
    }

    #[test]
    fn test_order_disordered_already_ordered() {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(3.0, 3.0, 3.0)));
        let fe = Species::new(Element::Fe, Some(2));
        let structure = Structure::new(lattice, vec![fe], vec![Vector3::new(0.0, 0.0, 0.0)]);

        let orderings = structure
            .order_disordered(OrderDisorderedConfig::default())
            .unwrap();

        // Already ordered structure should return itself
        assert_eq!(orderings.len(), 1);
        assert!(orderings[0].is_ordered());
    }

    #[test]
    fn test_order_disordered_three_species() {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(3.0, 3.0, 3.0)));

        let fe = Species::new(Element::Fe, Some(2));
        let co = Species::new(Element::Co, Some(2));
        let ni = Species::new(Element::Ni, Some(2));

        // Single site with three species (1/3 each)
        let site = SiteOccupancy::new(vec![(fe, 1.0 / 3.0), (co, 1.0 / 3.0), (ni, 1.0 / 3.0)]);
        let structure =
            Structure::new_from_occupancies(lattice, vec![site], vec![Vector3::new(0.0, 0.0, 0.0)]);

        let orderings = structure
            .order_disordered(OrderDisorderedConfig::default())
            .unwrap();

        // 3 ways to order: Fe, Co, or Ni
        assert_eq!(orderings.len(), 3);
    }

    #[test]
    fn test_order_disordered_multiple_sites() {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(3.0, 3.0, 3.0)));

        let fe = Species::new(Element::Fe, Some(2));
        let co = Species::new(Element::Co, Some(2));

        // Two sites, each with 50% Fe/Co
        let site = SiteOccupancy::new(vec![(fe, 0.5), (co, 0.5)]);
        let structure = Structure::new_from_occupancies(
            lattice,
            vec![site.clone(), site],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let orderings = structure
            .order_disordered(OrderDisorderedConfig::default())
            .unwrap();

        // 2^2 = 4 ways to order two sites with 2 options each
        assert_eq!(orderings.len(), 4);
    }

    #[test]
    fn test_order_disordered_heap_keeps_lowest_energies() {
        // Verifies that when using sort_by_energy with max_structures,
        // the heap correctly keeps the LOWEST energy structures
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(5.64, 5.64, 5.64)));

        let na = Species::new(Element::Na, Some(1));
        let k = Species::new(Element::K, Some(1));
        let cl = Species::new(Element::Cl, Some(-1));

        // Two cation sites (disordered Na/K) + two Cl sites
        let cation_site = SiteOccupancy::new(vec![(na, 0.5), (k, 0.5)]);
        let cl_site = SiteOccupancy::ordered(cl);

        let structure = Structure::new_from_occupancies(
            lattice,
            vec![cation_site.clone(), cation_site, cl_site.clone(), cl_site],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.5, 0.0),
                Vector3::new(0.5, 0.0, 0.5),
                Vector3::new(0.0, 0.5, 0.5),
            ],
        );

        // Get all 4 orderings with energies
        let config_all = OrderDisorderedConfig {
            max_structures: None,
            sort_by_energy: true,
            compute_energy: true,
            ..Default::default()
        };
        let all_orderings = structure.order_disordered(config_all).unwrap();

        // Get just top 2 lowest energy
        let config_top2 = OrderDisorderedConfig {
            max_structures: Some(2),
            sort_by_energy: true,
            compute_energy: true,
            ..Default::default()
        };
        let top2_orderings = structure.order_disordered(config_top2).unwrap();

        assert_eq!(top2_orderings.len(), 2);

        // Extract energies
        let get_energy = |s: &Structure| -> f64 {
            s.properties
                .get("ewald_energy")
                .and_then(|v| v.as_f64())
                .unwrap_or(f64::INFINITY)
        };

        let mut all_energies: Vec<f64> = all_orderings.iter().map(get_energy).collect();
        all_energies.sort_by(|val_a, val_b| val_a.partial_cmp(val_b).unwrap());

        let top2_energies: Vec<f64> = top2_orderings.iter().map(get_energy).collect();

        // The top 2 should contain the 2 lowest energies from all orderings
        for energy in &top2_energies {
            assert!(
                all_energies[..2].iter().any(|e| (e - energy).abs() < 1e-6),
                "Top-2 energy {} should be among the 2 lowest energies {:?}",
                energy,
                &all_energies[..2]
            );
        }
    }

    // ========== partial_remove tests (via Structure methods) ==========

    #[test]
    fn test_partial_remove_various_fractions() {
        // (fraction, expected_results, expected_sites_remaining)
        let test_cases = [
            (0.25, 4, 5), // C(4,1)=4, remove 1 Li -> 3 Li + 2 O
            (0.5, 6, 4),  // C(4,2)=6, remove 2 Li -> 2 Li + 2 O
        ];
        for (fraction, expected_count, expected_sites) in test_cases {
            let structure = partial_li_structure();
            let config = PartialRemoveConfig::new(Species::new(Element::Li, Some(1)), fraction);
            let results = structure.partial_remove(config).unwrap();

            assert_eq!(results.len(), expected_count, "fraction={fraction}");
            for result in results {
                assert_eq!(result.num_sites(), expected_sites);
            }
        }
    }

    #[test]
    fn test_partial_remove_max_structures() {
        let structure = partial_li_structure();
        let mut config = PartialRemoveConfig::new(Species::new(Element::Li, Some(1)), 0.5);
        config.max_structures = Some(3);
        let results = structure.partial_remove(config).unwrap();
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_partial_remove_all() {
        let structure = partial_li_structure();
        let config = PartialRemoveConfig::new(Species::new(Element::Li, Some(1)), 1.0);
        let results = structure.partial_remove(config).unwrap();

        // Only 1 way to remove all
        assert_eq!(results.len(), 1);
        // Should only have O atoms left
        assert_eq!(results[0].num_sites(), 2);
        assert!(
            results[0]
                .site_occupancies
                .iter()
                .all(|s| s.dominant_species().element == Element::O)
        );
    }

    #[test]
    fn test_partial_remove_none() {
        let structure = partial_li_structure();
        let config = PartialRemoveConfig::new(Species::new(Element::Li, Some(1)), 0.0);
        let results = structure.partial_remove(config).unwrap();

        // Only 1 way: remove nothing
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].num_sites(), 6);
    }

    #[test]
    fn test_partial_remove_species_not_found() {
        let structure = partial_li_structure();
        let config = PartialRemoveConfig::new(Species::neutral(Element::Cu), 0.5);
        let result = structure.partial_remove(config);

        // Species not found is an error
        assert!(result.is_err());
    }

    // ========== discretize_occupancies tests (via Structure methods) ==========

    #[test]
    fn test_discretize_occupancies() {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(3.0, 3.0, 3.0)));

        let li = Species::new(Element::Li, Some(1));
        let fe = Species::new(Element::Fe, Some(2));

        // 0.5 Li, 0.5 Fe - should require 2x supercell
        let site = SiteOccupancy::new(vec![(li, 0.5), (fe, 0.5)]);
        let structure =
            Structure::new_from_occupancies(lattice, vec![site], vec![Vector3::new(0.0, 0.0, 0.0)]);

        let discretized = structure.discretize_occupancies(10, 0.01).unwrap();

        // Should have 2 sites (2x supercell along first axis)
        assert_eq!(discretized.num_sites(), 2);

        // Fractional occupancies are preserved (representing probability of each species).
        // OrderDisorderedTransform handles the actual species selection.
        for site_occ in &discretized.site_occupancies {
            assert_eq!(site_occ.species.len(), 2, "Should still have 2 species");
            let total_occ: f64 = site_occ.species.iter().map(|(_, occ)| occ).sum();
            assert!(
                (total_occ - 1.0).abs() < 1e-10,
                "Total occupancy should be 1.0, got {}",
                total_occ
            );
            for (_, occ) in &site_occ.species {
                assert!(
                    (*occ - 0.5).abs() < 1e-10,
                    "Each species should retain 0.5 occupancy, got {}",
                    occ
                );
            }
        }
    }

    #[test]
    fn test_discretize_occupancies_quarter() {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(3.0, 3.0, 3.0)));

        let li = Species::new(Element::Li, Some(1));
        let na = Species::new(Element::Na, Some(1));

        // 0.25 Li, 0.75 Na - should require 4x supercell
        let site = SiteOccupancy::new(vec![(li, 0.25), (na, 0.75)]);
        let structure =
            Structure::new_from_occupancies(lattice, vec![site], vec![Vector3::new(0.0, 0.0, 0.0)]);

        let discretized = structure.discretize_occupancies(10, 0.01).unwrap();

        // Should have 4 sites (4x supercell)
        assert_eq!(discretized.num_sites(), 4);

        // Fractional occupancies are preserved on each site
        for site_occ in &discretized.site_occupancies {
            let total_occ: f64 = site_occ.species.iter().map(|(_, occ)| occ).sum();
            assert!(
                (total_occ - 1.0).abs() < 1e-10,
                "Total occupancy should be 1.0"
            );
            // Check original occupancies are preserved
            for (species, occ) in &site_occ.species {
                let expected = if species.element == Element::Li {
                    0.25
                } else {
                    0.75
                };
                assert!(
                    (*occ - expected).abs() < 1e-10,
                    "Expected {} occupancy {}, got {}",
                    species,
                    expected,
                    occ
                );
            }
        }
    }

    #[test]
    fn test_discretize_already_integral() {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(3.0, 3.0, 3.0)));
        let li = Species::new(Element::Li, Some(1));

        // Already fully occupied - no change needed
        let site = SiteOccupancy::new(vec![(li, 1.0)]);
        let structure =
            Structure::new_from_occupancies(lattice, vec![site], vec![Vector3::new(0.0, 0.0, 0.0)]);

        let discretized = structure.discretize_occupancies(10, 0.01).unwrap();

        // Should still have 1 site (no supercell needed)
        assert_eq!(discretized.num_sites(), 1);
    }

    #[test]
    fn test_discretize_then_order_workflow() {
        // Test the full workflow: discretize -> order_disordered
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(3.0, 3.0, 3.0)));

        let li = Species::new(Element::Li, Some(1));
        let fe = Species::new(Element::Fe, Some(2));

        // 0.5 Li, 0.5 Fe on one site
        let site = SiteOccupancy::new(vec![(li, 0.5), (fe, 0.5)]);
        let structure =
            Structure::new_from_occupancies(lattice, vec![site], vec![Vector3::new(0.0, 0.0, 0.0)]);

        // Step 1: Discretize - creates 2x supercell with preserved fractional occupancies
        let discretized = structure.discretize_occupancies(10, 0.01).unwrap();
        assert_eq!(discretized.num_sites(), 2);
        assert!(!discretized.is_ordered(), "Should still be disordered");

        // Step 2: Order - enumerate all possible orderings
        let config = OrderDisorderedConfig {
            compute_energy: false, // Skip Ewald for this test
            ..Default::default()
        };
        let orderings = discretized.order_disordered(config).unwrap();

        // 2 sites x 2 species = 4 orderings (LiLi, LiFe, FeLi, FeFe)
        assert_eq!(orderings.len(), 4);

        // All orderings should be fully ordered with 1.0 occupancy per site
        for ordered in &orderings {
            assert!(
                ordered.is_ordered(),
                "Each ordering should be fully ordered"
            );
            for site_occ in &ordered.site_occupancies {
                assert_eq!(site_occ.species.len(), 1, "Should have exactly 1 species");
                let (_, occ) = site_occ.species[0];
                assert!(
                    (occ - 1.0).abs() < 1e-10,
                    "Ordered site should have 1.0 occupancy"
                );
            }
        }
    }

    // ========== Internal helper function tests ==========

    #[test]
    fn test_rationalize() {
        assert_eq!(rationalize(0.5, 10, 0.01).unwrap(), (1, 2));
        assert_eq!(rationalize(0.25, 10, 0.01).unwrap(), (1, 4));
        assert_eq!(rationalize(0.333, 10, 0.01).unwrap(), (1, 3));
        assert_eq!(rationalize(0.666, 10, 0.01).unwrap(), (2, 3));
        assert_eq!(rationalize(0.75, 10, 0.01).unwrap(), (3, 4));
    }

    #[test]
    fn test_rationalize_edge_cases() {
        assert_eq!(rationalize(1.0, 10, 0.01).unwrap(), (1, 1));
        assert_eq!(rationalize(0.1, 10, 0.01).unwrap(), (1, 10));
        assert_eq!(rationalize(0.2, 10, 0.01).unwrap(), (1, 5));
    }

    #[test]
    fn test_rationalize_tight_tolerance() {
        let result = rationalize(0.333, 10, 0.0001);
        if let Ok((numerator, denominator)) = result {
            assert!((numerator as f64 / denominator as f64 - 0.333).abs() < 0.0001);
        }
    }

    #[test]
    fn test_num_gcd_lcm() {
        assert_eq!(num_gcd(12, 8), 4);
        assert_eq!(num_gcd(15, 10), 5);
        assert_eq!(num_lcm(3, 4), 12);
        assert_eq!(num_lcm(6, 8), 24);
    }

    #[test]
    fn test_num_gcd_edge_cases() {
        assert_eq!(num_gcd(1, 1), 1);
        assert_eq!(num_gcd(7, 1), 1);
        assert_eq!(num_gcd(12, 12), 12);
        assert_eq!(num_gcd(100, 10), 10);
    }

    #[test]
    fn test_num_lcm_edge_cases() {
        assert_eq!(num_lcm(1, 1), 1);
        assert_eq!(num_lcm(7, 1), 7);
        assert_eq!(num_lcm(5, 5), 5);
    }
}
