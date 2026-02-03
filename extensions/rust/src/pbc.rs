//! Periodic boundary condition utilities.
//!
//! This module provides functions for computing shortest vectors and checking
//! coordinate subsets under periodic boundary conditions.

use crate::lattice::Lattice;
use nalgebra::Vector3;

/// Result type for pbc_shortest_vectors: (vectors, distances_squared, images)
pub type PbcShortestResult = (Vec<Vec<Vector3<f64>>>, Vec<Vec<f64>>, Vec<Vec<[i32; 3]>>);

/// Wrap fractional coordinates to the range [0, 1).
///
/// Uses `rem_euclid(1.0)` which computes the Euclidean remainder, correctly
/// handling negative inputs (e.g., `-0.1` wraps to `0.9`). This is preferred over
/// `coord % 1.0` which returns negative values for negative inputs, and over
/// `coord - coord.floor()` which can return exactly 1.0 due to floating-point
/// precision issues when `coord` is very close to an integer.
///
/// A guard handles the rare edge case where `rem_euclid` returns exactly 1.0.
///
/// # Examples
///
/// ```
/// use ferrox::pbc::wrap_frac_coord;
///
/// assert!((wrap_frac_coord(0.5) - 0.5).abs() < 1e-10);
/// assert!((wrap_frac_coord(-0.1) - 0.9).abs() < 1e-10);
/// assert!((wrap_frac_coord(1.3) - 0.3).abs() < 1e-10);
/// ```
#[inline]
pub fn wrap_frac_coord(coord: f64) -> f64 {
    let wrapped = coord.rem_euclid(1.0);
    // Guard against floating-point edge case where result is exactly 1.0
    if wrapped >= 1.0 { 0.0 } else { wrapped }
}

/// Wrap a Vector3 of fractional coordinates to the range [0, 1).
#[inline]
pub fn wrap_frac_coords(coords: &Vector3<f64>) -> Vector3<f64> {
    Vector3::new(
        wrap_frac_coord(coords[0]),
        wrap_frac_coord(coords[1]),
        wrap_frac_coord(coords[2]),
    )
}

/// Wrap fractional coordinates only along periodic axes.
/// Non-periodic axes retain their original values (may be outside [0, 1)).
#[inline]
pub fn wrap_frac_coords_pbc(coords: &Vector3<f64>, pbc: [bool; 3]) -> Vector3<f64> {
    Vector3::new(
        if pbc[0] {
            wrap_frac_coord(coords[0])
        } else {
            coords[0]
        },
        if pbc[1] {
            wrap_frac_coord(coords[1])
        } else {
            coords[1]
        },
        if pbc[2] {
            wrap_frac_coord(coords[2])
        } else {
            coords[2]
        },
    )
}

/// Check if two fractional coordinates match within tolerance under PBC.
#[inline]
fn coords_match_pbc(
    fc1: &Vector3<f64>,
    fc2: &Vector3<f64>,
    abs_tol: [f64; 3],
    pbc: [bool; 3],
) -> bool {
    for axis in 0..3 {
        let diff = fc1[axis] - fc2[axis];
        let wrapped_diff = if pbc[axis] { diff - diff.round() } else { diff };
        if wrapped_diff.abs() > abs_tol[axis] {
            return false;
        }
    }
    true
}

// === Minimum Image Distance Utilities ===

/// Calculate minimum image distance and displacement vector between two Cartesian points.
///
/// Returns (distance, displacement_vector) where displacement_vector points from pos_a to pos_b.
/// This function checks all 27 periodic images to find the shortest path.
///
/// # Arguments
///
/// * `pos_a` - First position in Cartesian coordinates
/// * `pos_b` - Second position in Cartesian coordinates
/// * `lattice_matrix` - 3x3 lattice matrix (rows are lattice vectors)
/// * `pbc` - Periodic boundary conditions along each axis
///
/// # Returns
///
/// Tuple of (distance, displacement_vector).
pub fn minimum_image_distance(
    pos_a: &Vector3<f64>,
    pos_b: &Vector3<f64>,
    lattice_matrix: &nalgebra::Matrix3<f64>,
    pbc: [bool; 3],
) -> (f64, Vector3<f64>) {
    let (dist_sq, vec) = minimum_image_distance_squared(pos_a, pos_b, lattice_matrix, pbc);
    (dist_sq.sqrt(), vec)
}

/// Calculate minimum image distance squared and displacement vector.
///
/// More efficient than `minimum_image_distance` when you only need to compare distances.
///
/// # Arguments
///
/// * `pos_a` - First position in Cartesian coordinates
/// * `pos_b` - Second position in Cartesian coordinates
/// * `lattice_matrix` - 3x3 lattice matrix (rows are lattice vectors)
/// * `pbc` - Periodic boundary conditions along each axis
///
/// # Returns
///
/// Tuple of (distance_squared, displacement_vector).
pub fn minimum_image_distance_squared(
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

    // Determine search range based on lattice skewness.
    // For highly skewed lattices, images beyond ±1 may be closer.
    let search_range = compute_search_range(lattice_matrix, &lattice_vecs);

    // Check periodic images within the determined range
    for shift_a in -search_range..=search_range {
        if !pbc[0] && shift_a != 0 {
            continue;
        }
        for shift_b in -search_range..=search_range {
            if !pbc[1] && shift_b != 0 {
                continue;
            }
            for shift_c in -search_range..=search_range {
                if !pbc[2] && shift_c != 0 {
                    continue;
                }
                if shift_a == 0 && shift_b == 0 && shift_c == 0 {
                    continue; // Already checked direct distance
                }

                let image_offset = (shift_a as f64) * lattice_vecs[0]
                    + (shift_b as f64) * lattice_vecs[1]
                    + (shift_c as f64) * lattice_vecs[2];

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

/// Compute the search range for periodic images based on lattice skewness.
///
/// For orthogonal or nearly orthogonal cells, ±1 (27 images) is sufficient.
/// For highly skewed cells, we need to search a larger range.
fn compute_search_range(
    lattice_matrix: &nalgebra::Matrix3<f64>,
    lattice_vecs: &[Vector3<f64>; 3],
) -> i32 {
    // Compute angles between lattice vectors to detect skewness
    let lengths = [
        lattice_vecs[0].norm(),
        lattice_vecs[1].norm(),
        lattice_vecs[2].norm(),
    ];

    // Avoid division by zero for degenerate lattices
    if lengths[0] < 1e-10 || lengths[1] < 1e-10 || lengths[2] < 1e-10 {
        return 1;
    }

    // Compute angles (in degrees) between lattice vector pairs
    let cos_alpha = lattice_vecs[1].dot(&lattice_vecs[2]) / (lengths[1] * lengths[2]); // angle bc
    let cos_beta = lattice_vecs[0].dot(&lattice_vecs[2]) / (lengths[0] * lengths[2]); // angle ac
    let cos_gamma = lattice_vecs[0].dot(&lattice_vecs[1]) / (lengths[0] * lengths[1]); // angle ab

    let alpha = cos_alpha.clamp(-1.0, 1.0).acos().to_degrees();
    let beta = cos_beta.clamp(-1.0, 1.0).acos().to_degrees();
    let gamma = cos_gamma.clamp(-1.0, 1.0).acos().to_degrees();

    // Check if any angle deviates significantly from 90° (threshold: 30°)
    let is_highly_skewed =
        (alpha - 90.0).abs() > 30.0 || (beta - 90.0).abs() > 30.0 || (gamma - 90.0).abs() > 30.0;

    if !is_highly_skewed {
        return 1; // Standard 27 images sufficient
    }

    // For skewed cells, compute search range based on perpendicular distances.
    // The perpendicular distance for axis i is |V| / |a_j × a_k| where j,k are the other axes.
    let volume = lattice_matrix.determinant().abs();
    if volume < 1e-10 {
        return 1; // Degenerate lattice
    }

    let cross_bc = lattice_vecs[1].cross(&lattice_vecs[2]);
    let cross_ac = lattice_vecs[0].cross(&lattice_vecs[2]);
    let cross_ab = lattice_vecs[0].cross(&lattice_vecs[1]);

    let perp_a = volume / cross_bc.norm().max(1e-10);
    let perp_b = volume / cross_ac.norm().max(1e-10);
    let perp_c = volume / cross_ab.norm().max(1e-10);
    let min_perp = perp_a.min(perp_b).min(perp_c);

    let max_length = lengths[0].max(lengths[1]).max(lengths[2]);

    // Search range: ceil(max_length / min_perp), clamped to reasonable bounds
    const MAX_SEARCH_RANGE: i32 = 5;
    if min_perp > 1e-10 {
        ((max_length / min_perp).ceil() as i32).clamp(1, MAX_SEARCH_RANGE)
    } else {
        2 // Fallback for near-degenerate lattices
    }
}

/// Find minimum distance from a Cartesian point to any atom in a list, considering PBC.
///
/// # Arguments
///
/// * `point` - The query point in Cartesian coordinates
/// * `atom_coords` - List of atom positions in Cartesian coordinates
/// * `lattice_matrix` - 3x3 lattice matrix (rows are lattice vectors)
/// * `pbc` - Periodic boundary conditions along each axis
///
/// # Returns
///
/// The minimum distance to any atom (f64::MAX if atom_coords is empty).
pub fn min_distance_to_atoms(
    point: &Vector3<f64>,
    atom_coords: &[Vector3<f64>],
    lattice_matrix: &nalgebra::Matrix3<f64>,
    pbc: [bool; 3],
) -> f64 {
    atom_coords
        .iter()
        .map(|atom| minimum_image_distance(point, atom, lattice_matrix, pbc).0)
        .fold(f64::MAX, f64::min)
}

/// Count atoms at approximately a given distance from a point (within tolerance).
///
/// Useful for determining coordination number of interstitial sites.
///
/// # Arguments
///
/// * `point` - The query point in Cartesian coordinates
/// * `atom_coords` - List of atom positions in Cartesian coordinates
/// * `lattice_matrix` - 3x3 lattice matrix (rows are lattice vectors)
/// * `pbc` - Periodic boundary conditions along each axis
/// * `target_dist` - The target distance to match
/// * `tolerance` - Distance tolerance for matching
///
/// # Returns
///
/// Number of atoms within `tolerance` of `target_dist` from `point`.
pub fn count_atoms_at_distance(
    point: &Vector3<f64>,
    atom_coords: &[Vector3<f64>],
    lattice_matrix: &nalgebra::Matrix3<f64>,
    pbc: [bool; 3],
    target_dist: f64,
    tolerance: f64,
) -> usize {
    atom_coords
        .iter()
        .filter(|atom| {
            let dist = minimum_image_distance(point, atom, lattice_matrix, pbc).0;
            (dist - target_dist).abs() < tolerance
        })
        .count()
}

// === Periodic Image Arrays ===
// Note: IMAGE_OFFSETS_I32 and IMAGES contain the same 27 offset values in different
// types (i32 vs f64). Both needed: i32 for integer arithmetic and PBC filtering,
// f64 for direct fractional coordinate math.

/// All 27 periodic image offsets as i32.
const IMAGE_OFFSETS_I32: [[i32; 3]; 27] = [
    [-1, -1, -1],
    [-1, -1, 0],
    [-1, -1, 1],
    [-1, 0, -1],
    [-1, 0, 0],
    [-1, 0, 1],
    [-1, 1, -1],
    [-1, 1, 0],
    [-1, 1, 1],
    [0, -1, -1],
    [0, -1, 0],
    [0, -1, 1],
    [0, 0, -1],
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, -1],
    [0, 1, 0],
    [0, 1, 1],
    [1, -1, -1],
    [1, -1, 0],
    [1, -1, 1],
    [1, 0, -1],
    [1, 0, 0],
    [1, 0, 1],
    [1, 1, -1],
    [1, 1, 0],
    [1, 1, 1],
];

/// Generate all periodic image offsets based on PBC flags.
///
/// For each periodic axis, generates offsets in {-1, 0, 1}.
/// For non-periodic axes, only generates 0.
///
/// # Example
///
/// ```
/// use ferrox::pbc::periodic_image_offsets;
///
/// // Full 3D PBC: 27 images
/// assert_eq!(periodic_image_offsets([true, true, true]).count(), 27);
///
/// // Slab (z non-periodic): 9 images
/// assert_eq!(periodic_image_offsets([true, true, false]).count(), 9);
/// ```
pub fn periodic_image_offsets(pbc: [bool; 3]) -> impl Iterator<Item = [i32; 3]> {
    IMAGE_OFFSETS_I32.into_iter().filter(move |img| {
        (pbc[0] || img[0] == 0) && (pbc[1] || img[1] == 0) && (pbc[2] || img[2] == 0)
    })
}

/// The 27 periodic images to check for full 3D PBC.
const IMAGES: [[f64; 3]; 27] = [
    [-1.0, -1.0, -1.0],
    [-1.0, -1.0, 0.0],
    [-1.0, -1.0, 1.0],
    [-1.0, 0.0, -1.0],
    [-1.0, 0.0, 0.0],
    [-1.0, 0.0, 1.0],
    [-1.0, 1.0, -1.0],
    [-1.0, 1.0, 0.0],
    [-1.0, 1.0, 1.0],
    [0.0, -1.0, -1.0],
    [0.0, -1.0, 0.0],
    [0.0, -1.0, 1.0],
    [0.0, 0.0, -1.0],
    [0.0, 0.0, 0.0],
    [0.0, 0.0, 1.0],
    [0.0, 1.0, -1.0],
    [0.0, 1.0, 0.0],
    [0.0, 1.0, 1.0],
    [1.0, -1.0, -1.0],
    [1.0, -1.0, 0.0],
    [1.0, -1.0, 1.0],
    [1.0, 0.0, -1.0],
    [1.0, 0.0, 0.0],
    [1.0, 0.0, 1.0],
    [1.0, 1.0, -1.0],
    [1.0, 1.0, 0.0],
    [1.0, 1.0, 1.0],
];

/// Compute the shortest vectors between two sets of fractional coordinates
/// under periodic boundary conditions.
///
/// # Arguments
///
/// * `lattice` - The lattice for PBC calculations
/// * `fcoords1` - First set of fractional coordinates
/// * `fcoords2` - Second set of fractional coordinates
/// * `mask` - Optional mask where `mask[i][j] = true` means skip pair (i, j)
/// * `lll_frac_tol` - Optional fractional tolerance for early termination
///
/// # Returns
///
/// A tuple of (vectors, distances_squared, images) where:
/// - `vectors[i][j]` is the shortest Cartesian vector from fcoords1[i] to fcoords2[j]
/// - `distances_squared[i][j]` is the squared length of that vector
/// - `images[i][j]` is the periodic image offset [da, db, dc] that gives the shortest distance
pub fn pbc_shortest_vectors(
    lattice: &Lattice,
    fcoords1: &[Vector3<f64>],
    fcoords2: &[Vector3<f64>],
    mask: Option<&[Vec<bool>]>,
    lll_frac_tol: Option<[f64; 3]>,
) -> PbcShortestResult {
    let n1 = fcoords1.len();
    let n2 = fcoords2.len();

    // Early return for empty inputs
    if n1 == 0 || n2 == 0 {
        return (vec![], vec![], vec![]);
    }

    // Use LLL-reduced coordinates for full 3D PBC
    let pbc = lattice.pbc;
    let use_lll = pbc[0] && pbc[1] && pbc[2];

    let (fc1, fc2, matrix, lll_mapping) = if use_lll {
        let lll_fc1 = lattice.get_lll_frac_coords(fcoords1);
        let lll_fc2 = lattice.get_lll_frac_coords(fcoords2);
        let lll_mat = lattice.lll_matrix();
        let lll_map = lattice.lll_mapping();
        (lll_fc1, lll_fc2, lll_mat, Some(lll_map))
    } else {
        (
            fcoords1.to_vec(),
            fcoords2.to_vec(),
            *lattice.matrix(),
            None,
        )
    };

    // Store both fractional and integer images for tracking
    let frac_images: Vec<[f64; 3]> = if use_lll {
        IMAGES.to_vec()
    } else {
        IMAGES
            .iter()
            .filter(|img| {
                (pbc[0] || img[0] == 0.0) && (pbc[1] || img[1] == 0.0) && (pbc[2] || img[2] == 0.0)
            })
            .copied()
            .collect()
    };

    // Convert fractional images to Cartesian
    let cart_images: Vec<Vector3<f64>> = frac_images
        .iter()
        .map(|img| matrix.transpose() * Vector3::from(*img))
        .collect();

    // Convert fractional coords to Cartesian (wrap only periodic axes)
    let cart_f1: Vec<Vector3<f64>> = fc1
        .iter()
        .map(|f| matrix.transpose() * wrap_frac_coords_pbc(f, pbc))
        .collect();

    let cart_f2: Vec<Vector3<f64>> = fc2
        .iter()
        .map(|f| matrix.transpose() * wrap_frac_coords_pbc(f, pbc))
        .collect();

    // Initialize output arrays with infinity/zeros for masked/skipped entries
    let mut vectors = vec![vec![Vector3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY); n2]; n1];
    let mut d2 = vec![vec![f64::INFINITY; n2]; n1];
    let mut result_images = vec![vec![[0i32; 3]; n2]; n1];

    for (idx, f1) in fc1.iter().enumerate() {
        for (jdx, f2) in fc2.iter().enumerate() {
            // Check mask
            if let Some(m) = mask
                && m[idx][jdx]
            {
                continue;
            }

            // Check fractional tolerance (only wrap periodic axes)
            let mut within_frac = true;
            if let Some(frac_tol) = lll_frac_tol {
                for axis in 0..3 {
                    let fdist = f2[axis] - f1[axis];
                    let wrapped = if pbc[axis] {
                        fdist - fdist.round()
                    } else {
                        fdist
                    };
                    if wrapped.abs() > frac_tol[axis] {
                        within_frac = false;
                        break;
                    }
                }
            }

            if !within_frac {
                continue;
            }

            // Compute pre-image vector (before adding periodic images)
            let pre_im = cart_f2[jdx] - cart_f1[idx];

            // Find shortest image
            let mut best_d2 = 1e100;
            let mut best_vec = pre_im;
            let mut best_image_idx = 0usize;

            for (im_idx, cart_im) in cart_images.iter().enumerate() {
                let vec = pre_im + cart_im;
                let dist_sq = vec.norm_squared();
                if dist_sq < best_d2 {
                    best_d2 = dist_sq;
                    best_vec = vec;
                    best_image_idx = im_idx;
                }
            }

            d2[idx][jdx] = best_d2;
            vectors[idx][jdx] = best_vec;

            // Convert image to original lattice basis if using LLL
            let lll_image = frac_images[best_image_idx];
            result_images[idx][jdx] = if let Some(ref mapping) = lll_mapping {
                // Transform from LLL basis back to original: orig_image = mapping * lll_image
                let orig_vec = mapping * Vector3::from(lll_image);
                // Debug check: transformed image should be near-integer (within 0.1)
                debug_assert!(
                    (0..3).all(|axis| (orig_vec[axis] - orig_vec[axis].round()).abs() < 0.1),
                    "LLL image transform gave non-integer result: {orig_vec:?}"
                );
                std::array::from_fn(|axis| orig_vec[axis].round() as i32)
            } else {
                lll_image.map(|val| val as i32)
            };
        }
    }

    (vectors, d2, result_images)
}

/// Check if all fractional coordinates in `subset` are contained in `superset`
/// under periodic boundary conditions.
///
/// # Arguments
///
/// * `subset` - Coordinates that should all appear in superset
/// * `superset` - Coordinates to search within
/// * `abs_tol` - Tolerance for each fractional coordinate
/// * `mask` - Mask where `mask[i][j] = true` means subset[i] cannot match superset[j]
/// * `pbc` - Periodic boundary conditions along each axis
///
/// # Returns
///
/// `true` if all coordinates in subset have a match in superset.
pub fn is_coord_subset_pbc(
    subset: &[Vector3<f64>],
    superset: &[Vector3<f64>],
    abs_tol: [f64; 3],
    mask: &[Vec<bool>],
    pbc: [bool; 3],
) -> bool {
    subset.iter().enumerate().all(|(idx, fc1)| {
        superset
            .iter()
            .enumerate()
            .any(|(jdx, fc2)| !mask[idx][jdx] && coords_match_pbc(fc1, fc2, abs_tol, pbc))
    })
}

/// Get the mapping from subset indices to superset indices under PBC.
///
/// # Arguments
///
/// * `subset` - Coordinates to map
/// * `superset` - Coordinates to map to
/// * `abs_tol` - Tolerance for matching
/// * `pbc` - Periodic boundary conditions
///
/// # Returns
///
/// A vector where `result[i]` is the index in superset that matches subset[i],
/// or `None` if any coordinate in subset has no match.
pub fn coord_list_mapping_pbc(
    subset: &[Vector3<f64>],
    superset: &[Vector3<f64>],
    abs_tol: f64,
    pbc: [bool; 3],
) -> Option<Vec<usize>> {
    let abs_tol_arr = [abs_tol, abs_tol, abs_tol];
    subset
        .iter()
        .map(|fc1| {
            superset
                .iter()
                .position(|fc2| coords_match_pbc(fc1, fc2, abs_tol_arr, pbc))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pbc_shortest_vectors() {
        let lattice = Lattice::cubic(4.0);

        // Same point: zero distance
        let coords = vec![Vector3::new(0.5, 0.5, 0.5)];
        let (vecs, d2, images) = pbc_shortest_vectors(&lattice, &coords, &coords, None, None);
        assert!(d2[0][0] < 1e-10);
        assert!(vecs[0][0].norm() < 1e-10);
        assert_eq!(images[0][0], [0, 0, 0]); // Same point, no image shift

        // Periodic wrap: 0.1 and 0.9 are 0.2 apart (via boundary)
        let c1 = vec![Vector3::new(0.1, 0.0, 0.0)];
        let c2 = vec![Vector3::new(0.9, 0.0, 0.0)];
        let (_, d2, images) = pbc_shortest_vectors(&lattice, &c1, &c2, None, None);
        assert!((d2[0][0] - (0.8_f64).powi(2)).abs() < 1e-8); // 0.2 * 4.0 = 0.8
        // Shortest path is via -1 in x direction (0.9 - 1.0 = -0.1, closer to 0.1)
        assert_eq!(images[0][0][0], -1); // Shift in -x direction

        // Corner wrap: (0.05, 0.05, 0.05) to (0.95, 0.95, 0.95) = 0.1 per axis
        let c1 = vec![Vector3::new(0.05, 0.05, 0.05)];
        let c2 = vec![Vector3::new(0.95, 0.95, 0.95)];
        let (_, d2, images) = pbc_shortest_vectors(&lattice, &c1, &c2, None, None);
        let expected = (3.0_f64).sqrt() * 0.4; // 0.1*4 per axis
        assert!((d2[0][0].sqrt() - expected).abs() < 1e-6);
        // Shortest path is via -1 in all directions
        assert_eq!(images[0][0], [-1, -1, -1]);
    }

    #[test]
    fn test_is_coord_subset_pbc() {
        let pbc = [true, true, true];
        let abs_tol = [0.05, 0.05, 0.05];

        // Basic subset
        let subset = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        let superset = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.5),
            Vector3::new(0.25, 0.25, 0.25),
        ];
        let mask = vec![vec![false; 3]; 2];
        assert!(is_coord_subset_pbc(&subset, &superset, abs_tol, &mask, pbc));

        // Periodic: 0.99 matches 0.01
        let subset = vec![Vector3::new(0.99, 0.0, 0.0)];
        let superset = vec![Vector3::new(0.01, 0.0, 0.0)];
        let mask = vec![vec![false; 1]; 1];
        assert!(is_coord_subset_pbc(&subset, &superset, abs_tol, &mask, pbc));

        // Not found
        let subset = vec![Vector3::new(0.3, 0.3, 0.3)];
        let superset = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        let mask = vec![vec![false; 2]; 1];
        let abs_tol_tight = [0.01, 0.01, 0.01];
        assert!(!is_coord_subset_pbc(
            &subset,
            &superset,
            abs_tol_tight,
            &mask,
            pbc
        ));
    }

    #[test]
    fn test_coord_list_mapping_pbc() {
        let subset = vec![Vector3::new(0.5, 0.5, 0.5), Vector3::new(0.0, 0.0, 0.0)];
        let superset = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.5),
            Vector3::new(0.25, 0.25, 0.25),
        ];
        let pbc = [true, true, true];

        // Returns mapping indices
        assert_eq!(
            coord_list_mapping_pbc(&subset, &superset, 0.01, pbc),
            Some(vec![1, 0])
        );

        // No match returns None
        let no_match = vec![Vector3::new(0.3, 0.3, 0.3)];
        assert!(coord_list_mapping_pbc(&no_match, &superset, 0.01, pbc).is_none());

        // Empty subset -> empty mapping
        let empty: Vec<Vector3<f64>> = vec![];
        assert_eq!(
            coord_list_mapping_pbc(&empty, &superset, 0.01, pbc),
            Some(vec![])
        );
    }

    #[test]
    fn test_pbc_various_lattices() {
        // Verify PBC shortest vectors are computed correctly for different lattice types
        let test_cases = [
            // (lattice, frac_coord1, frac_coord2, expected_max_dist)
            // For cubic: (0,0,0) to (0.5,0.5,0.5) is half body diagonal = a*sqrt(3)/2
            (
                Lattice::cubic(4.0),
                [0.0, 0.0, 0.0],
                [0.5, 0.5, 0.5],
                4.0 * (3.0_f64).sqrt() / 2.0,
            ),
            // Origin to origin should be 0
            (Lattice::cubic(4.0), [0.0, 0.0, 0.0], [0.0, 0.0, 0.0], 0.0),
            // PBC wrap: (0.9, 0, 0) to (0.1, 0, 0) should be 0.2*a = 0.8, not 0.8*a
            (Lattice::cubic(4.0), [0.9, 0.0, 0.0], [0.1, 0.0, 0.0], 0.8),
            // Hexagonal lattice
            (
                Lattice::hexagonal(3.0, 5.0),
                [0.0, 0.0, 0.0],
                [0.0, 0.0, 0.5],
                2.5,
            ),
            // Triclinic lattice - just verify it computes something reasonable
            (
                Lattice::from_parameters(3.0, 4.0, 5.0, 80.0, 85.0, 95.0),
                [0.0, 0.0, 0.0],
                [0.5, 0.5, 0.5],
                10.0,
            ),
        ];

        for (lattice, fc1, fc2, max_expected) in test_cases {
            let c1 = vec![Vector3::new(fc1[0], fc1[1], fc1[2])];
            let c2 = vec![Vector3::new(fc2[0], fc2[1], fc2[2])];
            let (vecs, d2, _images) = pbc_shortest_vectors(&lattice, &c1, &c2, None, None);

            let dist = d2[0][0].sqrt();
            assert!(dist >= 0.0, "Distance should be non-negative, got {dist}");
            assert!(
                dist <= max_expected + 0.1,
                "Distance {dist} exceeds expected max {max_expected} for {:?} -> {:?}",
                fc1,
                fc2
            );

            // Vector norm should match distance
            let vec_norm = vecs[0][0].norm();
            assert!(
                (vec_norm - dist).abs() < 1e-10,
                "Vector norm {vec_norm} != distance {dist}"
            );
        }
    }

    #[test]
    fn test_wrap_frac_coords_vector() {
        let v = Vector3::new(-0.1, 1.3, 0.5);
        let wrapped = wrap_frac_coords(&v);
        assert!((wrapped[0] - 0.9).abs() < 1e-10);
        assert!((wrapped[1] - 0.3).abs() < 1e-10);
        assert!((wrapped[2] - 0.5).abs() < 1e-10);

        // All negative
        let v2 = Vector3::new(-0.5, -0.25, -0.75);
        let wrapped2 = wrap_frac_coords(&v2);
        assert!((wrapped2[0] - 0.5).abs() < 1e-10);
        assert!((wrapped2[1] - 0.75).abs() < 1e-10);
        assert!((wrapped2[2] - 0.25).abs() < 1e-10);
    }

    #[test]
    fn test_wrap_frac_coords_pbc() {
        let v = Vector3::new(-0.5, 1.5, 2.3);
        // (pbc flags, expected x, expected y, expected z)
        let cases = [
            ([true, true, true], [0.5, 0.5, 0.3]), // all periodic: all wrap
            ([true, true, false], [0.5, 0.5, 2.3]), // slab: z unchanged
            ([true, false, false], [0.5, 1.5, 2.3]), // wire: only x wraps
            ([false, false, false], [-0.5, 1.5, 2.3]), // none: all unchanged
        ];
        for (pbc, expected) in cases {
            let result = wrap_frac_coords_pbc(&v, pbc);
            for axis in 0..3 {
                assert!(
                    (result[axis] - expected[axis]).abs() < 1e-10,
                    "pbc={pbc:?} axis={axis}: expected {}, got {}",
                    expected[axis],
                    result[axis]
                );
            }
        }
    }

    #[test]
    fn test_pbc_shortest_vectors_with_mask() {
        let lattice = Lattice::cubic(4.0);
        let c1 = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        let c2 = vec![Vector3::new(0.1, 0.0, 0.0), Vector3::new(0.6, 0.5, 0.5)];

        // Mask out (0,0) and (1,1) pairs
        let mask = vec![vec![true, false], vec![false, true]];
        let (vecs, d2, _images) = pbc_shortest_vectors(&lattice, &c1, &c2, Some(&mask), None);

        // Masked entries should be infinity
        assert!(d2[0][0].is_infinite());
        assert!(d2[1][1].is_infinite());

        // Unmasked entries should be computed
        assert!(d2[0][1] < 100.0);
        assert!(d2[1][0] < 100.0);
        assert!(vecs[0][1].norm() < 10.0);
    }

    #[test]
    fn test_pbc_shortest_vectors_with_frac_tol() {
        let lattice = Lattice::cubic(4.0);
        let c1 = vec![Vector3::new(0.0, 0.0, 0.0)];
        let c2 = vec![Vector3::new(0.5, 0.5, 0.5), Vector3::new(0.01, 0.01, 0.01)];

        // Tight tolerance - only nearby points
        let frac_tol = Some([0.1, 0.1, 0.1]);
        let (_, d2, _images) = pbc_shortest_vectors(&lattice, &c1, &c2, None, frac_tol);

        // (0.5, 0.5, 0.5) is outside tolerance
        assert!(d2[0][0].is_infinite());
        // (0.01, 0.01, 0.01) is within tolerance
        assert!(d2[0][1] < 1.0);
    }

    #[test]
    fn test_partial_pbc() {
        // Test with PBC only along some axes
        let abs_tol = [0.05, 0.05, 0.05];

        // PBC only along x-axis
        let pbc_x = [true, false, false];
        let c1 = Vector3::new(0.99, 0.0, 0.0);
        let c2 = Vector3::new(0.01, 0.0, 0.0);
        // Should match via PBC along x
        assert!(coords_match_pbc(&c1, &c2, abs_tol, pbc_x));

        // Same coords but y-axis - no PBC
        let c3 = Vector3::new(0.0, 0.99, 0.0);
        let c4 = Vector3::new(0.0, 0.01, 0.0);
        // Should NOT match (no PBC along y)
        assert!(!coords_match_pbc(&c3, &c4, abs_tol, pbc_x));

        // No PBC at all
        let no_pbc = [false, false, false];
        assert!(!coords_match_pbc(&c1, &c2, abs_tol, no_pbc));
    }

    #[test]
    fn test_pbc_shortest_vectors_partial_pbc_no_wrap() {
        // Non-periodic axes should NOT wrap coordinates outside [0,1)
        let mut lattice = Lattice::cubic(10.0);
        lattice.pbc = [true, true, false]; // z is not periodic

        // Coords at z=0.1 and z=1.5 (outside [0,1) on non-periodic axis)
        let c1 = vec![Vector3::new(0.5, 0.5, 0.1)];
        let c2 = vec![Vector3::new(0.5, 0.5, 1.5)];
        let (_, d2, _images) = pbc_shortest_vectors(&lattice, &c1, &c2, None, None);

        // Without fix: z=1.5 wraps to 0.5, distance would be 0.4*10=4
        // With fix: z stays at 1.5, distance is (1.5-0.1)*10=14
        let dist = d2[0][0].sqrt();
        assert!(
            dist > 10.0,
            "Non-periodic z should NOT wrap: expected ~14, got {dist}"
        );
    }

    #[test]
    fn test_coords_match_pbc_tolerance() {
        let pbc = [true, true, true];
        let c1 = Vector3::new(0.5, 0.5, 0.5);
        let tol = [0.01, 0.01, 0.01];
        // (coord, should_match)
        let cases = [
            (Vector3::new(0.5, 0.5, 0.5), true),   // exact
            (Vector3::new(0.505, 0.5, 0.5), true), // within tolerance
            (Vector3::new(0.52, 0.5, 0.5), false), // outside tolerance
        ];
        for (c2, expected) in cases {
            assert_eq!(coords_match_pbc(&c1, &c2, tol, pbc), expected);
        }
    }

    #[test]
    fn test_periodic_image_offsets_full_pbc() {
        let offsets: Vec<_> = periodic_image_offsets([true, true, true]).collect();
        assert_eq!(offsets.len(), 27);
        assert!(offsets.contains(&[0, 0, 0]));
        assert!(offsets.contains(&[-1, -1, -1]));
        assert!(offsets.contains(&[1, 1, 1]));
    }

    #[test]
    fn test_periodic_image_offsets_partial_pbc() {
        // Slab (z non-periodic)
        let offsets: Vec<_> = periodic_image_offsets([true, true, false]).collect();
        assert_eq!(offsets.len(), 9);
        assert!(offsets.iter().all(|img| img[2] == 0));

        // Wire (only x periodic)
        let offsets: Vec<_> = periodic_image_offsets([true, false, false]).collect();
        assert_eq!(offsets.len(), 3);

        // No PBC
        let offsets: Vec<_> = periodic_image_offsets([false, false, false]).collect();
        assert_eq!(offsets.len(), 1);
        assert_eq!(offsets[0], [0, 0, 0]);
    }

    #[test]
    fn test_minimum_image_distance_cubic() {
        let matrix = nalgebra::Matrix3::from_diagonal(&Vector3::new(4.0, 4.0, 4.0));
        let pbc = [true, true, true];

        // Same point
        let pos = Vector3::new(2.0, 2.0, 2.0);
        let (dist, _) = minimum_image_distance(&pos, &pos, &matrix, pbc);
        assert!(dist < 1e-10);

        // Points across boundary
        let pos_a = Vector3::new(0.5, 0.5, 0.5);
        let pos_b = Vector3::new(3.5, 3.5, 3.5);
        let (dist, _) = minimum_image_distance(&pos_a, &pos_b, &matrix, pbc);
        // Should be sqrt(3) ≈ 1.73 (via boundary), not sqrt(27) ≈ 5.2
        assert!(dist < 2.0, "Expected < 2.0, got {dist}");
    }

    #[test]
    fn test_min_distance_to_atoms() {
        let matrix = nalgebra::Matrix3::from_diagonal(&Vector3::new(10.0, 10.0, 10.0));
        let pbc = [true, true, true];

        let atoms = vec![Vector3::new(1.0, 1.0, 1.0), Vector3::new(5.0, 5.0, 5.0)];

        // Point close to first atom
        let point = Vector3::new(1.5, 1.0, 1.0);
        let dist = min_distance_to_atoms(&point, &atoms, &matrix, pbc);
        assert!((dist - 0.5).abs() < 1e-10);

        // Point near boundary, closer to wrapped image
        let point2 = Vector3::new(9.5, 1.0, 1.0);
        let dist2 = min_distance_to_atoms(&point2, &atoms, &matrix, pbc);
        // Should find distance to image of (1,1,1) at (11,1,1), so dist = 1.5
        assert!((dist2 - 1.5).abs() < 1e-10);
    }

    #[test]
    fn test_count_atoms_at_distance() {
        let matrix = nalgebra::Matrix3::from_diagonal(&Vector3::new(10.0, 10.0, 10.0));
        let pbc = [true, true, true];

        // Atoms arranged in octahedral coordination around origin
        let atoms = [
            Vector3::new(2.0, 0.0, 0.0),
            Vector3::new(-2.0, 0.0, 0.0),
            Vector3::new(0.0, 2.0, 0.0),
            Vector3::new(0.0, -2.0, 0.0),
            Vector3::new(0.0, 0.0, 2.0),
            Vector3::new(0.0, 0.0, -2.0),
        ];
        // Wrap negative coords to [0,10)
        let atoms: Vec<_> = atoms
            .iter()
            .map(|a| {
                Vector3::new(
                    if a.x < 0.0 { a.x + 10.0 } else { a.x },
                    if a.y < 0.0 { a.y + 10.0 } else { a.y },
                    if a.z < 0.0 { a.z + 10.0 } else { a.z },
                )
            })
            .collect();

        let point = Vector3::new(0.0, 0.0, 0.0);
        let count = count_atoms_at_distance(&point, &atoms, &matrix, pbc, 2.0, 0.5);
        assert_eq!(count, 6);
    }
}
