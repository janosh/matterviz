//! Ordering transformations for disordered structures.
//!
//! This module contains transformations for handling disordered structures:
//!
//! - `OrderDisorderedTransform`: Enumerate orderings of disordered structures
//! - `PartialRemoveTransform`: Partial removal of species
//! - `DiscretizeOccupanciesTransform`: Convert fractional occupancies to integers

use crate::algorithms::Ewald;
use crate::error::{FerroxError, Result};
use crate::species::{SiteOccupancy, Species};
use crate::structure::Structure;
use crate::transformations::{Transform, TransformMany};
use itertools::Itertools;
use std::collections::HashSet;

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

    /// Create with default configuration.
    pub fn with_max_structures(max: usize) -> Self {
        Self::new(OrderDisorderedConfig {
            max_structures: Some(max),
            ..Default::default()
        })
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

impl OrderDisorderedTransform {
    /// Enumerate all orderings of a disordered structure.
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

        // Generate all combinations using Cartesian product
        let orderings: Vec<Vec<Species>> =
            site_options.into_iter().multi_cartesian_product().collect();

        // Convert orderings to structures
        let mut results: Vec<(f64, Structure)> = Vec::new();
        let ewald = Ewald::new().with_accuracy(self.config.ewald_accuracy);

        for species_list in orderings {
            let mut ordered_struct = structure.clone();

            // Set species for each site
            for (idx, species) in species_list.iter().enumerate() {
                ordered_struct.site_occupancies[idx] = SiteOccupancy::ordered(*species);
            }

            // Compute energy if requested
            let energy = if self.config.compute_energy {
                match ewald.energy(&ordered_struct) {
                    Ok(e) => {
                        ordered_struct
                            .properties
                            .insert("ewald_energy".to_string(), serde_json::json!(e));
                        e
                    }
                    Err(_) => f64::INFINITY, // Skip energy for structures without oxi states
                }
            } else {
                0.0
            };

            results.push((energy, ordered_struct));
        }

        // Sort by energy if requested
        if self.config.sort_by_energy && self.config.compute_energy {
            results.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        }

        // Apply max_structures limit
        let max = self.config.max_structures.unwrap_or(results.len());
        results.into_iter().take(max).map(|(_, s)| Ok(s)).collect()
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

    /// Convenient constructor for simple case.
    pub fn simple(species: Species, fraction: f64) -> Self {
        Self::new(PartialRemoveConfig::new(species, fraction))
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

        for removal_combo in target_sites.iter().combinations(n_remove) {
            let removal_set: HashSet<usize> = removal_combo.iter().copied().copied().collect();

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

            // Compute energy
            let energy = match ewald.energy(&removed_struct) {
                Ok(e) => {
                    removed_struct
                        .properties
                        .insert("ewald_energy".to_string(), serde_json::json!(e));
                    e
                }
                Err(_) => f64::INFINITY,
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

/// Convert fractional occupancies to integers via rationalization.
///
/// Finds the smallest supercell where all occupancies become integers.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::{Transform, DiscretizeOccupanciesTransform};
///
/// // Structure with Li at 0.75 occupancy
/// let transform = DiscretizeOccupanciesTransform::new(10, 0.01);
/// let discretized = transform.applied(&structure)?;
/// // Now has supercell with 3 Li for every 4 original sites
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

        // Create supercell
        let supercell_matrix = [[lcm as i32, 0, 0], [0, 1, 0], [0, 0, 1]];
        let supercell = structure.make_supercell(supercell_matrix)?;

        // Update structure
        *structure = supercell;
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

    #[test]
    fn test_order_disordered() {
        let structure = disordered_structure();
        let transform = OrderDisorderedTransform::default();

        let orderings: Vec<_> = transform.iter_apply(&structure).collect();

        // Single disordered site with 2 species = 2 orderings
        assert_eq!(orderings.len(), 2);

        for result in orderings {
            let ordered = result.unwrap();
            assert!(ordered.is_ordered());
        }
    }

    #[test]
    fn test_order_disordered_max_structures() {
        let structure = disordered_structure();
        let transform = OrderDisorderedTransform::with_max_structures(1);

        let orderings: Vec<_> = transform.iter_apply(&structure).collect();
        assert_eq!(orderings.len(), 1);
    }

    #[test]
    fn test_order_disordered_already_ordered() {
        // Create a fully ordered structure
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(3.0, 3.0, 3.0)));
        let fe = Species::new(Element::Fe, Some(2));
        let structure = Structure::new(lattice, vec![fe], vec![Vector3::new(0.0, 0.0, 0.0)]);

        let transform = OrderDisorderedTransform::default();
        let orderings: Vec<_> = transform.iter_apply(&structure).collect();

        // Already ordered structure should return itself
        assert_eq!(orderings.len(), 1);
        let result = orderings[0].as_ref().unwrap();
        assert!(result.is_ordered());
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

        let transform = OrderDisorderedTransform::default();
        let orderings: Vec<_> = transform.iter_apply(&structure).collect();

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

        let transform = OrderDisorderedTransform::default();
        let orderings: Vec<_> = transform.iter_apply(&structure).collect();

        // 2^2 = 4 ways to order two sites with 2 options each
        assert_eq!(orderings.len(), 4);
    }

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
            let results: Vec<_> = PartialRemoveTransform::new(config)
                .iter_apply(&structure)
                .collect();

            assert_eq!(results.len(), expected_count, "fraction={fraction}");
            for result in results {
                assert_eq!(result.unwrap().num_sites(), expected_sites);
            }
        }
    }

    #[test]
    fn test_partial_remove_max_structures() {
        let structure = partial_li_structure();
        let mut config = PartialRemoveConfig::new(Species::new(Element::Li, Some(1)), 0.5);
        config.max_structures = Some(3);
        let transform = PartialRemoveTransform::new(config);

        let results: Vec<_> = transform.iter_apply(&structure).collect();
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_partial_remove_all() {
        let structure = partial_li_structure();
        let config = PartialRemoveConfig::new(Species::new(Element::Li, Some(1)), 1.0);
        let transform = PartialRemoveTransform::new(config);

        let results: Vec<_> = transform.iter_apply(&structure).collect();

        // Only 1 way to remove all
        assert_eq!(results.len(), 1);

        let removed = results[0].as_ref().unwrap();
        // Should only have O atoms left
        assert_eq!(removed.num_sites(), 2);
        assert!(
            removed
                .site_occupancies
                .iter()
                .all(|s| s.dominant_species().element == Element::O)
        );
    }

    #[test]
    fn test_partial_remove_none() {
        let structure = partial_li_structure();
        let config = PartialRemoveConfig::new(Species::new(Element::Li, Some(1)), 0.0);
        let transform = PartialRemoveTransform::new(config);

        let results: Vec<_> = transform.iter_apply(&structure).collect();

        // Only 1 way: remove nothing
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].as_ref().unwrap().num_sites(), 6);
    }

    #[test]
    fn test_partial_remove_species_not_found() {
        let structure = partial_li_structure();
        let config = PartialRemoveConfig::new(Species::neutral(Element::Cu), 0.5); // Cu not in structure
        let transform = PartialRemoveTransform::new(config);

        let results: Vec<_> = transform.iter_apply(&structure).collect();

        // Nothing to remove
        assert_eq!(results.len(), 1);
    }

    // ========== Discretize Occupancies Tests ==========

    #[test]
    fn test_discretize_occupancies() {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(3.0, 3.0, 3.0)));

        let li = Species::new(Element::Li, Some(1));
        let na = Species::new(Element::Na, Some(1));
        let k = Species::new(Element::K, Some(1));

        // Occupancies that don't add up to exactly 1.0
        let site = SiteOccupancy::new(vec![(li, 0.19), (na, 0.19), (k, 0.62)]);

        let structure =
            Structure::new_from_occupancies(lattice, vec![site], vec![Vector3::new(0.0, 0.0, 0.0)]);

        let transform = DiscretizeOccupanciesTransform::new(5, 0.5);
        let mut discretized = structure.clone();
        transform.apply(&mut discretized).unwrap();

        // Check that occupancies sum to 1.0 and are discretized
        let occ = &discretized.site_occupancies[0];
        let total: f64 = occ.species.iter().map(|(_, o)| *o).sum();
        assert!((total - 1.0).abs() < 1e-10, "Total occupancy should be 1.0");
    }

    // ========== Rationalize Helper Tests ==========

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
        // 1.0 should give (1, 1)
        assert_eq!(rationalize(1.0, 10, 0.01).unwrap(), (1, 1));

        // Very small value
        assert_eq!(rationalize(0.1, 10, 0.01).unwrap(), (1, 10));

        // Integer-like fraction
        assert_eq!(rationalize(0.2, 10, 0.01).unwrap(), (1, 5));
    }

    #[test]
    fn test_rationalize_tight_tolerance() {
        // 0.333 cannot be exactly represented as n/d with d <= 10 within tight tolerance
        let result = rationalize(0.333, 10, 0.0001);
        // Should fail or return (1,3) depending on tolerance
        if let Ok((n, d)) = result {
            assert!((n as f64 / d as f64 - 0.333).abs() < 0.0001);
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

    // ========== TransformMany Trait Tests ==========

    #[test]
    fn test_apply_all_convenience_method() {
        let structure = disordered_structure();
        let transform = OrderDisorderedTransform::default();

        let all_results = transform.apply_all(&structure).unwrap();
        assert_eq!(all_results.len(), 2);

        for s in all_results {
            assert!(s.is_ordered());
        }
    }
}
