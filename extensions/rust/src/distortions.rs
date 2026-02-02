//! Structure distortions for defect calculations (ShakeNBreak-style).
//!
//! This module provides functions to systematically distort crystal structures
//! around defect sites, useful for finding ground-state defect geometries.
//!
//! # Examples
//!
//! ```rust,ignore
//! use ferrox::distortions::{distort_bonds, rattle_structure, DistortionResult};
//! use ferrox::Structure;
//!
//! // Distort bonds around a defect site
//! let results = distort_bonds(&structure, 0, &[-0.4, -0.2, 0.2, 0.4], None, 5.0)?;
//!
//! // Apply random rattling to all atoms
//! let rattled = rattle_structure(&structure, 0.1, 42, 0.5, 100)?;
//! ```

use crate::error::{
    FerroxError, Result, check_non_negative, check_positive, check_site_bounds,
    check_sites_different,
};
use crate::neighbors::{NeighborListConfig, build_neighbor_list};
use crate::pbc::wrap_frac_coords;
use crate::structure::Structure;
use nalgebra::Vector3;
use rand::SeedableRng;
use rand::prelude::*;
use rand::rngs::StdRng;
use serde::{Deserialize, Serialize};

// === Types ===

/// Result of a structure distortion operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistortionResult {
    /// The distorted structure.
    pub structure: Structure,
    /// Type of distortion applied (e.g., "bond_distortion", "dimer", "rattle").
    pub distortion_type: String,
    /// Distortion factor used (if applicable).
    pub distortion_factor: Option<f64>,
    /// Index of the center site (if applicable).
    pub center_site_idx: Option<usize>,
}

// === Public Functions ===

/// Distort bonds around a defect site by specified factors.
///
/// For each distortion factor, creates a new structure where neighbor atoms are
/// moved along their bond direction by `factor * original_distance`. Positive
/// factors move neighbors away from the center, negative factors move them closer.
///
/// # Arguments
///
/// * `structure` - The input crystal structure
/// * `center_site_idx` - Index of the defect/center site
/// * `distortion_factors` - Array of factors to apply (e.g., `[-0.6, -0.4, -0.2, 0.2, 0.4, 0.6]`)
/// * `num_neighbors` - Maximum number of neighbors to distort (`None` = all within cutoff)
/// * `cutoff` - Neighbor cutoff distance in Angstrom
///
/// # Returns
///
/// A vector of `DistortionResult`, one for each distortion factor.
///
/// # Errors
///
/// Returns `FerroxError::InvalidStructure` if `center_site_idx` is out of bounds.
pub fn distort_bonds(
    structure: &Structure,
    center_site_idx: usize,
    distortion_factors: &[f64],
    num_neighbors: Option<usize>,
    cutoff: f64,
) -> Result<Vec<DistortionResult>> {
    check_site_bounds(center_site_idx, structure.num_sites(), "center_site_idx")?;

    // Build neighbor list
    let config = NeighborListConfig {
        cutoff,
        self_interaction: false,
        ..Default::default()
    };
    let nl = build_neighbor_list(structure, &config);

    // Collect neighbors of center site, sorted by distance
    let mut neighbors: Vec<(usize, f64, [i32; 3])> = nl
        .center_indices
        .iter()
        .enumerate()
        .filter(|&(_, &center)| center == center_site_idx)
        .map(|(idx, _)| (nl.neighbor_indices[idx], nl.distances[idx], nl.images[idx]))
        .collect();

    // Sort by distance
    neighbors.sort_by(|lhs, rhs| {
        lhs.1
            .partial_cmp(&rhs.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Limit to num_neighbors if specified
    let neighbors = match num_neighbors {
        Some(max_n) => &neighbors[..max_n.min(neighbors.len())],
        None => &neighbors[..],
    };

    // Get lattice matrix for image calculations
    let matrix = structure.lattice.matrix();
    let lattice_vecs = [
        matrix.row(0).transpose(),
        matrix.row(1).transpose(),
        matrix.row(2).transpose(),
    ];

    // Get center position in Cartesian coordinates
    let cart_coords = structure.cart_coords();
    let center_cart = cart_coords[center_site_idx];

    // Create distorted structures
    let mut results = Vec::with_capacity(distortion_factors.len());

    for &factor in distortion_factors {
        // Clone fractional coordinates
        let mut new_frac_coords = structure.frac_coords.clone();

        for &(neighbor_idx, distance, image) in neighbors {
            // Calculate neighbor position with periodic image
            let image_offset = (image[0] as f64) * lattice_vecs[0]
                + (image[1] as f64) * lattice_vecs[1]
                + (image[2] as f64) * lattice_vecs[2];

            let neighbor_cart = cart_coords[neighbor_idx] + image_offset;

            // Bond direction vector (from center to neighbor)
            let bond_vec = neighbor_cart - center_cart;

            // Skip neighbors at same position (would cause NaN from normalize)
            let bond_len = bond_vec.norm();
            if bond_len < 1e-10 {
                continue;
            }

            // Displacement: move along bond direction by factor * distance
            let displacement = (bond_vec / bond_len) * (factor * distance);

            // Apply displacement in Cartesian space, then convert back to fractional
            let new_neighbor_cart = cart_coords[neighbor_idx] + displacement;
            let new_frac = structure.lattice.get_fractional_coord(&new_neighbor_cart);

            // Wrap to [0, 1)
            new_frac_coords[neighbor_idx] = wrap_frac_coords(&new_frac);
        }

        // Create new structure with distorted coordinates
        let new_structure = Structure::new_from_occupancies(
            structure.lattice.clone(),
            structure.site_occupancies.clone(),
            new_frac_coords,
        );

        results.push(DistortionResult {
            structure: new_structure,
            distortion_type: "bond_distortion".to_string(),
            distortion_factor: Some(factor),
            center_site_idx: Some(center_site_idx),
        });
    }

    Ok(results)
}

/// Create a dimer by moving two atoms closer together.
///
/// Both atoms are moved equally toward their midpoint until the target distance
/// is reached. Handles periodic boundary conditions correctly.
///
/// # Arguments
///
/// * `structure` - The input crystal structure
/// * `site_a_idx` - Index of the first atom
/// * `site_b_idx` - Index of the second atom
/// * `target_distance` - Desired distance between atoms in Angstrom
///
/// # Returns
///
/// A `DistortionResult` containing the structure with the dimer.
///
/// # Errors
///
/// Returns `FerroxError::InvalidStructure` if:
/// - Site indices are out of bounds
/// - Site indices are the same
/// - Target distance is zero or negative
pub fn create_dimer(
    structure: &Structure,
    site_a_idx: usize,
    site_b_idx: usize,
    target_distance: f64,
) -> Result<DistortionResult> {
    let n_sites = structure.num_sites();
    check_site_bounds(site_a_idx, n_sites, "site_a_idx")?;
    check_site_bounds(site_b_idx, n_sites, "site_b_idx")?;
    check_sites_different(site_a_idx, site_b_idx)?;
    check_positive(target_distance, "target_distance")?;

    // Get positions
    let cart_coords = structure.cart_coords();
    let pos_a = cart_coords[site_a_idx];
    let pos_b = cart_coords[site_b_idx];

    // Find minimum image distance and vector
    let (min_dist, min_image_vec) = minimum_image_distance(
        &pos_a,
        &pos_b,
        structure.lattice.matrix(),
        structure.lattice.pbc,
    );

    // Guard against atoms at same position (would cause NaN from normalize)
    if min_dist < 1e-10 {
        return Err(FerroxError::InvalidStructure {
            index: site_a_idx,
            reason: "atoms are at the same position, cannot create dimer".to_string(),
        });
    }

    // Calculate midpoint (in Cartesian space, accounting for PBC)
    let midpoint = pos_a + min_image_vec * 0.5;

    // Direction from a to b (normalized)
    let direction = min_image_vec.normalize();

    // Move both atoms to achieve target distance
    // a moves half the remaining distance toward midpoint
    // b moves half the remaining distance toward midpoint
    let half_target = target_distance / 2.0;
    let new_pos_a = midpoint - direction * half_target;
    let new_pos_b = midpoint + direction * half_target;

    // Convert back to fractional coordinates
    let mut new_frac_coords = structure.frac_coords.clone();
    new_frac_coords[site_a_idx] =
        wrap_frac_coords(&structure.lattice.get_fractional_coord(&new_pos_a));
    new_frac_coords[site_b_idx] =
        wrap_frac_coords(&structure.lattice.get_fractional_coord(&new_pos_b));

    let new_structure = Structure::new_from_occupancies(
        structure.lattice.clone(),
        structure.site_occupancies.clone(),
        new_frac_coords,
    );

    Ok(DistortionResult {
        structure: new_structure,
        distortion_type: "dimer".to_string(),
        distortion_factor: Some(target_distance / min_dist),
        center_site_idx: None,
    })
}

/// Apply Monte Carlo rattling - random displacements to all atoms.
///
/// Each atom receives a random displacement drawn from a Gaussian distribution.
/// The direction is uniformly random on the unit sphere.
///
/// # Arguments
///
/// * `structure` - The input crystal structure
/// * `stdev` - Standard deviation of Gaussian displacement (Angstrom)
/// * `seed` - Random seed for reproducibility
/// * `min_distance` - Minimum allowed distance between any two atoms (collision avoidance)
/// * `max_attempts` - Maximum attempts per atom to avoid collisions
///
/// # Returns
///
/// A `DistortionResult` containing the rattled structure.
///
/// # Errors
///
/// Returns `FerroxError::InvalidStructure` if:
/// - `stdev` is negative
/// - Cannot find collision-free positions after max_attempts
pub fn rattle_structure(
    structure: &Structure,
    stdev: f64,
    seed: u64,
    min_distance: f64,
    max_attempts: usize,
) -> Result<DistortionResult> {
    check_non_negative(stdev, "stdev")?;

    let n_sites = structure.num_sites();
    if n_sites == 0 || stdev == 0.0 {
        return Ok(DistortionResult {
            structure: structure.clone(),
            distortion_type: "rattle".to_string(),
            distortion_factor: Some(stdev),
            center_site_idx: None,
        });
    }

    let mut rng = StdRng::seed_from_u64(seed);
    let mut new_frac_coords = structure.frac_coords.clone();
    let lattice_matrix = structure.lattice.matrix();
    let pbc = structure.lattice.pbc;
    let min_dist_sq = min_distance * min_distance;

    // Rattle each atom
    for site_idx in 0..n_sites {
        let original_cart = structure
            .lattice
            .get_cartesian_coord(&structure.frac_coords[site_idx]);
        let mut attempts = 0;
        let mut found_valid = false;

        while attempts < max_attempts {
            // Generate random displacement
            let displacement = random_gaussian_vector(&mut rng, stdev);
            let new_cart = original_cart + displacement;
            let new_frac = wrap_frac_coords(&structure.lattice.get_fractional_coord(&new_cart));

            // Check for collisions with already-placed atoms
            let mut collision = false;
            for other_frac in new_frac_coords.iter().take(site_idx) {
                let other_cart = structure.lattice.get_cartesian_coord(other_frac);
                let (dist_sq, _) =
                    minimum_image_distance_squared(&new_cart, &other_cart, lattice_matrix, pbc);
                if dist_sq < min_dist_sq {
                    collision = true;
                    break;
                }
            }

            if !collision {
                new_frac_coords[site_idx] = new_frac;
                found_valid = true;
                break;
            }

            attempts += 1;
        }

        if !found_valid {
            return Err(FerroxError::InvalidStructure {
                index: site_idx,
                reason: format!(
                    "Could not find collision-free position for site {} after {} attempts",
                    site_idx, max_attempts
                ),
            });
        }
    }

    let new_structure = Structure::new_from_occupancies(
        structure.lattice.clone(),
        structure.site_occupancies.clone(),
        new_frac_coords,
    );

    Ok(DistortionResult {
        structure: new_structure,
        distortion_type: "rattle".to_string(),
        distortion_factor: Some(stdev),
        center_site_idx: None,
    })
}

/// Apply local rattling with distance-dependent amplitude decay.
///
/// Displacement amplitude decays exponentially with distance from the center site:
/// `amplitude = max_amplitude * exp(-distance / decay_radius)`
///
/// # Arguments
///
/// * `structure` - The input crystal structure
/// * `center_site_idx` - Index of the center site (e.g., defect site)
/// * `max_amplitude` - Maximum displacement amplitude at center (Angstrom)
/// * `decay_radius` - Decay length scale (Angstrom)
/// * `seed` - Random seed for reproducibility
///
/// # Returns
///
/// A `DistortionResult` containing the locally rattled structure.
///
/// # Errors
///
/// Returns `FerroxError::InvalidStructure` if:
/// - `center_site_idx` is out of bounds
/// - `max_amplitude` is negative
/// - `decay_radius` is zero or negative
pub fn local_rattle(
    structure: &Structure,
    center_site_idx: usize,
    max_amplitude: f64,
    decay_radius: f64,
    seed: u64,
) -> Result<DistortionResult> {
    let n_sites = structure.num_sites();
    check_site_bounds(center_site_idx, n_sites, "center_site_idx")?;
    check_non_negative(max_amplitude, "max_amplitude")?;
    check_positive(decay_radius, "decay_radius")?;

    if n_sites == 0 || max_amplitude == 0.0 {
        return Ok(DistortionResult {
            structure: structure.clone(),
            distortion_type: "local_rattle".to_string(),
            distortion_factor: Some(max_amplitude),
            center_site_idx: Some(center_site_idx),
        });
    }

    let mut rng = StdRng::seed_from_u64(seed);
    let mut new_frac_coords = structure.frac_coords.clone();
    let cart_coords = structure.cart_coords();
    let center_cart = cart_coords[center_site_idx];
    let lattice_matrix = structure.lattice.matrix();
    let pbc = structure.lattice.pbc;

    // Apply distance-dependent rattling to each atom
    for site_idx in 0..n_sites {
        // Calculate distance from center
        let (dist, _) =
            minimum_image_distance(&center_cart, &cart_coords[site_idx], lattice_matrix, pbc);

        // Calculate amplitude with exponential decay
        let amplitude = max_amplitude * (-dist / decay_radius).exp();

        if amplitude > 1e-10 {
            // Generate uniform random direction on unit sphere
            let direction = random_unit_vector(&mut rng);

            // Apply displacement
            let displacement = direction * amplitude;
            let new_cart = cart_coords[site_idx] + displacement;
            new_frac_coords[site_idx] =
                wrap_frac_coords(&structure.lattice.get_fractional_coord(&new_cart));
        }
    }

    let new_structure = Structure::new_from_occupancies(
        structure.lattice.clone(),
        structure.site_occupancies.clone(),
        new_frac_coords,
    );

    Ok(DistortionResult {
        structure: new_structure,
        distortion_type: "local_rattle".to_string(),
        distortion_factor: Some(max_amplitude),
        center_site_idx: Some(center_site_idx),
    })
}

// === Helper Functions ===

/// Generate a standard normal random number using Box-Muller transform.
#[inline]
fn box_muller_normal<R: Rng>(rng: &mut R) -> f64 {
    let u1: f64 = rng.gen_range(0.0001..1.0);
    let u2: f64 = rng.gen_range(0.0..std::f64::consts::TAU);
    (-2.0 * u1.ln()).sqrt() * u2.cos()
}

/// Generate a random vector with Gaussian-distributed magnitude.
fn random_gaussian_vector<R: Rng>(rng: &mut R, stdev: f64) -> Vector3<f64> {
    // Generate 3 independent Gaussian samples for x, y, z
    Vector3::new(
        box_muller_normal(rng) * stdev,
        box_muller_normal(rng) * stdev,
        box_muller_normal(rng) * stdev,
    )
}

/// Generate a uniformly distributed random unit vector on the sphere.
fn random_unit_vector<R: Rng>(rng: &mut R) -> Vector3<f64> {
    // Use rejection sampling for uniform distribution on sphere
    loop {
        let vec = Vector3::new(
            rng.gen_range(-1.0..1.0),
            rng.gen_range(-1.0..1.0),
            rng.gen_range(-1.0..1.0),
        );
        let norm_sq: f64 = vec.norm_squared();
        if norm_sq > 1e-10 && norm_sq <= 1.0 {
            return vec / norm_sq.sqrt();
        }
    }
}

/// Calculate minimum image distance and displacement vector between two points.
///
/// Returns (distance, displacement_vector) where displacement_vector points from a to b.
fn minimum_image_distance(
    pos_a: &Vector3<f64>,
    pos_b: &Vector3<f64>,
    lattice_matrix: &nalgebra::Matrix3<f64>,
    pbc: [bool; 3],
) -> (f64, Vector3<f64>) {
    let (dist_sq, vec) = minimum_image_distance_squared(pos_a, pos_b, lattice_matrix, pbc);
    (dist_sq.sqrt(), vec)
}

/// Calculate minimum image distance squared and displacement vector.
fn minimum_image_distance_squared(
    pos_a: &Vector3<f64>,
    pos_b: &Vector3<f64>,
    lattice_matrix: &nalgebra::Matrix3<f64>,
    pbc: [bool; 3],
) -> (f64, Vector3<f64>) {
    let lattice_vecs = [
        lattice_matrix.row(0).transpose(),
        lattice_matrix.row(1).transpose(),
        lattice_matrix.row(2).transpose(),
    ];

    let direct_vec = pos_b - pos_a;
    let mut min_dist_sq = direct_vec.norm_squared();
    let mut min_vec = direct_vec;

    // Check periodic images
    let ranges: [Vec<i32>; 3] =
        std::array::from_fn(|idx| if pbc[idx] { vec![-1, 0, 1] } else { vec![0] });

    for &dx in &ranges[0] {
        for &dy in &ranges[1] {
            for &dz in &ranges[2] {
                if dx == 0 && dy == 0 && dz == 0 {
                    continue; // Already checked direct distance
                }

                let image_offset = (dx as f64) * lattice_vecs[0]
                    + (dy as f64) * lattice_vecs[1]
                    + (dz as f64) * lattice_vecs[2];

                let vec = direct_vec + image_offset;
                let dist_sq = vec.norm_squared();

                if dist_sq < min_dist_sq {
                    min_dist_sq = dist_sq;
                    min_vec = vec;
                }
            }
        }
    }

    (min_dist_sq, min_vec)
}

// === Tests ===

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;
    use crate::lattice::Lattice;
    use crate::species::Species;

    fn make_fcc(element: Element, lattice_const: f64) -> Structure {
        let lattice = Lattice::cubic(lattice_const);
        let species = vec![Species::neutral(element); 4];
        let frac_coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.0),
            Vector3::new(0.5, 0.0, 0.5),
            Vector3::new(0.0, 0.5, 0.5),
        ];
        Structure::new(lattice, species, frac_coords)
    }

    #[test]
    fn test_distort_bonds_basic() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let factors = vec![-0.2, 0.2];

        let results = distort_bonds(&fcc, 0, &factors, None, 3.0).unwrap();

        assert_eq!(results.len(), 2, "Should have one result per factor");
        assert_eq!(results[0].distortion_factor, Some(-0.2));
        assert_eq!(results[1].distortion_factor, Some(0.2));
        assert_eq!(results[0].center_site_idx, Some(0));

        // Verify structures have same number of atoms
        for result in &results {
            assert_eq!(result.structure.num_sites(), 4);
        }
    }

    #[test]
    fn test_distort_bonds_invalid_center() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let result = distort_bonds(&fcc, 10, &[0.1], None, 3.0);

        assert!(result.is_err());
        match result {
            Err(FerroxError::InvalidStructure { index, .. }) => {
                assert_eq!(index, 10);
            }
            _ => panic!("Expected InvalidStructure error"),
        }
    }

    #[test]
    fn test_distort_bonds_limited_neighbors() {
        let fcc = make_fcc(Element::Cu, 3.61);

        // Limit to 2 neighbors
        let results = distort_bonds(&fcc, 0, &[0.1], Some(2), 3.0).unwrap();

        assert_eq!(results.len(), 1);
        // The distorted structure should still have 4 atoms
        assert_eq!(results[0].structure.num_sites(), 4);
    }

    #[test]
    fn test_create_dimer_basic() {
        let fcc = make_fcc(Element::Cu, 3.61);

        // Create dimer between sites 0 and 1
        let result = create_dimer(&fcc, 0, 1, 2.0).unwrap();

        assert_eq!(result.distortion_type, "dimer");
        assert_eq!(result.structure.num_sites(), 4);

        // Verify the distance between sites 0 and 1 is approximately target
        let cart_coords = result.structure.cart_coords();
        let (dist, _) = minimum_image_distance(
            &cart_coords[0],
            &cart_coords[1],
            result.structure.lattice.matrix(),
            result.structure.lattice.pbc,
        );
        assert!(
            (dist - 2.0).abs() < 0.25,
            "Dimer distance should be ~2.0 Å, got {}",
            dist
        );
    }

    #[test]
    fn test_create_dimer_invalid_same_site() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let result = create_dimer(&fcc, 0, 0, 2.0);

        assert!(result.is_err());
        match result {
            Err(FerroxError::InvalidStructure { reason, .. }) => {
                assert!(reason.contains("different"));
            }
            _ => panic!("Expected InvalidStructure error"),
        }
    }

    #[test]
    fn test_create_dimer_invalid_target_distance() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let result = create_dimer(&fcc, 0, 1, -1.0);

        assert!(result.is_err());
        match result {
            Err(FerroxError::InvalidStructure { reason, .. }) => {
                assert!(reason.contains("positive"));
            }
            _ => panic!("Expected InvalidStructure error"),
        }
    }

    #[test]
    fn test_create_dimer_out_of_bounds() {
        let fcc = make_fcc(Element::Cu, 3.61);

        let result_a = create_dimer(&fcc, 10, 1, 2.0);
        assert!(result_a.is_err());

        let result_b = create_dimer(&fcc, 0, 10, 2.0);
        assert!(result_b.is_err());
    }

    #[test]
    fn test_rattle_structure_basic() {
        let fcc = make_fcc(Element::Cu, 3.61);

        let result = rattle_structure(&fcc, 0.1, 42, 0.5, 100).unwrap();

        assert_eq!(result.distortion_type, "rattle");
        assert_eq!(result.distortion_factor, Some(0.1));
        assert_eq!(result.structure.num_sites(), 4);

        // Positions should be different from original
        let original_frac = &fcc.frac_coords;
        let rattled_frac = &result.structure.frac_coords;

        let mut any_different = false;
        for (orig, rattled) in original_frac.iter().zip(rattled_frac.iter()) {
            if (orig - rattled).norm() > 1e-10 {
                any_different = true;
                break;
            }
        }
        assert!(any_different, "At least one position should be different");
    }

    #[test]
    fn test_rattle_structure_reproducibility() {
        let fcc = make_fcc(Element::Cu, 3.61);

        let result1 = rattle_structure(&fcc, 0.1, 42, 0.5, 100).unwrap();
        let result2 = rattle_structure(&fcc, 0.1, 42, 0.5, 100).unwrap();

        // Same seed should give same result
        for (pos1, pos2) in result1
            .structure
            .frac_coords
            .iter()
            .zip(result2.structure.frac_coords.iter())
        {
            assert!(
                (pos1 - pos2).norm() < 1e-10,
                "Same seed should give reproducible results"
            );
        }

        // Different seed should give different result
        let result3 = rattle_structure(&fcc, 0.1, 123, 0.5, 100).unwrap();
        let mut any_different = false;
        for (pos1, pos3) in result1
            .structure
            .frac_coords
            .iter()
            .zip(result3.structure.frac_coords.iter())
        {
            if (pos1 - pos3).norm() > 1e-10 {
                any_different = true;
                break;
            }
        }
        assert!(
            any_different,
            "Different seed should give different results"
        );
    }

    #[test]
    fn test_rattle_structure_negative_stdev() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let result = rattle_structure(&fcc, -0.1, 42, 0.5, 100);

        assert!(result.is_err());
    }

    #[test]
    fn test_rattle_structure_zero_stdev() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let result = rattle_structure(&fcc, 0.0, 42, 0.5, 100).unwrap();

        // With zero stdev, structure should be unchanged
        for (orig, rattled) in fcc
            .frac_coords
            .iter()
            .zip(result.structure.frac_coords.iter())
        {
            assert!(
                (orig - rattled).norm() < 1e-10,
                "Zero stdev should leave structure unchanged"
            );
        }
    }

    #[test]
    fn test_local_rattle_basic() {
        let fcc = make_fcc(Element::Cu, 3.61);

        let result = local_rattle(&fcc, 0, 0.3, 2.0, 42).unwrap();

        assert_eq!(result.distortion_type, "local_rattle");
        assert_eq!(result.distortion_factor, Some(0.3));
        assert_eq!(result.center_site_idx, Some(0));
        assert_eq!(result.structure.num_sites(), 4);
    }

    #[test]
    fn test_local_rattle_amplitude_decay() {
        // Use a larger structure to test decay
        let lattice = Lattice::cubic(10.0);
        let species = vec![Species::neutral(Element::Cu); 3];
        let frac_coords = vec![
            Vector3::new(0.1, 0.1, 0.1), // center
            Vector3::new(0.2, 0.1, 0.1), // close to center (~1 Å)
            Vector3::new(0.8, 0.8, 0.8), // far from center (~12 Å)
        ];
        let structure = Structure::new(lattice, species, frac_coords);
        let orig_cart = structure.cart_coords();

        // Run multiple trials to average out random direction effects
        let n_trials = 10;
        let mut close_total = 0.0;
        let mut far_total = 0.0;

        for seed in 0..n_trials {
            let result = local_rattle(&structure, 0, 1.0, 2.0, seed).unwrap();
            let new_cart = result.structure.cart_coords();
            close_total += (new_cart[1] - orig_cart[1]).norm();
            far_total += (new_cart[2] - orig_cart[2]).norm();
        }

        let avg_close = close_total / n_trials as f64;
        let avg_far = far_total / n_trials as f64;

        // With decay_radius=2.0, close atom (~1 Å) has exp(-1/2)≈0.61 amplitude
        // Far atom (~12 Å) has exp(-12/2)≈0.0025 amplitude
        // So avg_far should be much smaller than avg_close
        // Use 0.5 threshold to catch "no decay" mutation while allowing variance
        assert!(
            avg_far < avg_close * 0.5,
            "Avg far displacement ({:.4}) should be < half of avg close ({:.4})",
            avg_far,
            avg_close
        );
    }

    #[test]
    fn test_local_rattle_invalid_center() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let result = local_rattle(&fcc, 10, 0.3, 2.0, 42);

        assert!(result.is_err());
    }

    #[test]
    fn test_local_rattle_invalid_decay_radius() {
        let fcc = make_fcc(Element::Cu, 3.61);

        let result_zero = local_rattle(&fcc, 0, 0.3, 0.0, 42);
        assert!(result_zero.is_err());

        let result_negative = local_rattle(&fcc, 0, 0.3, -1.0, 42);
        assert!(result_negative.is_err());
    }

    #[test]
    fn test_local_rattle_reproducibility() {
        let fcc = make_fcc(Element::Cu, 3.61);

        let result1 = local_rattle(&fcc, 0, 0.3, 2.0, 42).unwrap();
        let result2 = local_rattle(&fcc, 0, 0.3, 2.0, 42).unwrap();

        for (pos1, pos2) in result1
            .structure
            .frac_coords
            .iter()
            .zip(result2.structure.frac_coords.iter())
        {
            assert!(
                (pos1 - pos2).norm() < 1e-10,
                "Same seed should give reproducible results"
            );
        }
    }

    #[test]
    fn test_minimum_image_distance() {
        let lattice = Lattice::cubic(4.0);
        let matrix = lattice.matrix();

        // Two atoms at opposite corners should be close via PBC
        let pos_a = Vector3::new(0.5, 0.5, 0.5);
        let pos_b = Vector3::new(3.5, 3.5, 3.5);

        let (dist, _) = minimum_image_distance(&pos_a, &pos_b, matrix, [true, true, true]);

        // Should be sqrt(3) ≈ 1.73 Å, not sqrt(27) ≈ 5.2 Å
        assert!(
            dist < 2.0,
            "Minimum image distance should be < 2 Å, got {}",
            dist
        );
    }

    #[test]
    fn test_random_unit_vector_normalization() {
        let mut rng = StdRng::seed_from_u64(42);

        for _ in 0..100 {
            let vec = random_unit_vector(&mut rng);
            let norm = vec.norm();
            assert!(
                (norm - 1.0).abs() < 1e-10,
                "Unit vector norm should be 1.0, got {}",
                norm
            );
        }
    }

    #[test]
    fn test_distortion_result_serialization() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let result = rattle_structure(&fcc, 0.1, 42, 0.5, 100).unwrap();

        // Should serialize without error
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("rattle"));

        // Should deserialize back
        let deserialized: DistortionResult = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.distortion_type, "rattle");
    }

    #[test]
    fn test_empty_distortion_factors() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let results = distort_bonds(&fcc, 0, &[], None, 3.0).unwrap();

        assert!(
            results.is_empty(),
            "Empty factors should give empty results"
        );
    }

    #[test]
    fn test_distort_bonds_preserves_species() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let results = distort_bonds(&fcc, 0, &[0.1], None, 3.0).unwrap();

        // Check that all species are preserved
        for (orig, new) in fcc
            .site_occupancies
            .iter()
            .zip(results[0].structure.site_occupancies.iter())
        {
            assert_eq!(orig.species.len(), new.species.len());
        }
    }
}
