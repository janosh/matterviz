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
/// Uses `coord - coord.floor()` instead of `coord % 1.0` because Rust's modulo
/// operator returns negative values for negative inputs (e.g., `-0.1 % 1.0 = -0.1`),
/// while `floor()` correctly wraps to [0, 1) for all inputs.
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
    coord - coord.floor()
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
    atol: [f64; 3],
    pbc: [bool; 3],
) -> bool {
    for axis in 0..3 {
        let diff = fc1[axis] - fc2[axis];
        let wrapped_diff = if pbc[axis] { diff - diff.round() } else { diff };
        if wrapped_diff.abs() > atol[axis] {
            return false;
        }
    }
    true
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
            if let Some(ftol) = lll_frac_tol {
                for axis in 0..3 {
                    let fdist = f2[axis] - f1[axis];
                    let wrapped = if pbc[axis] {
                        fdist - fdist.round()
                    } else {
                        fdist
                    };
                    if wrapped.abs() > ftol[axis] {
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
/// * `atol` - Tolerance for each fractional coordinate
/// * `mask` - Mask where `mask[i][j] = true` means subset[i] cannot match superset[j]
/// * `pbc` - Periodic boundary conditions along each axis
///
/// # Returns
///
/// `true` if all coordinates in subset have a match in superset.
pub fn is_coord_subset_pbc(
    subset: &[Vector3<f64>],
    superset: &[Vector3<f64>],
    atol: [f64; 3],
    mask: &[Vec<bool>],
    pbc: [bool; 3],
) -> bool {
    subset.iter().enumerate().all(|(idx, fc1)| {
        superset
            .iter()
            .enumerate()
            .any(|(jdx, fc2)| !mask[idx][jdx] && coords_match_pbc(fc1, fc2, atol, pbc))
    })
}

/// Get the mapping from subset indices to superset indices under PBC.
///
/// # Arguments
///
/// * `subset` - Coordinates to map
/// * `superset` - Coordinates to map to
/// * `atol` - Tolerance for matching
/// * `pbc` - Periodic boundary conditions
///
/// # Returns
///
/// A vector where `result[i]` is the index in superset that matches subset[i],
/// or `None` if any coordinate in subset has no match.
pub fn coord_list_mapping_pbc(
    subset: &[Vector3<f64>],
    superset: &[Vector3<f64>],
    atol: f64,
    pbc: [bool; 3],
) -> Option<Vec<usize>> {
    let atol_arr = [atol, atol, atol];
    subset
        .iter()
        .map(|fc1| {
            superset
                .iter()
                .position(|fc2| coords_match_pbc(fc1, fc2, atol_arr, pbc))
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
        let atol = [0.05, 0.05, 0.05];

        // Basic subset
        let subset = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        let superset = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.5),
            Vector3::new(0.25, 0.25, 0.25),
        ];
        let mask = vec![vec![false; 3]; 2];
        assert!(is_coord_subset_pbc(&subset, &superset, atol, &mask, pbc));

        // Periodic: 0.99 matches 0.01
        let subset = vec![Vector3::new(0.99, 0.0, 0.0)];
        let superset = vec![Vector3::new(0.01, 0.0, 0.0)];
        let mask = vec![vec![false; 1]; 1];
        assert!(is_coord_subset_pbc(&subset, &superset, atol, &mask, pbc));

        // Not found
        let subset = vec![Vector3::new(0.3, 0.3, 0.3)];
        let superset = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        let mask = vec![vec![false; 2]; 1];
        let atol_tight = [0.01, 0.01, 0.01];
        assert!(!is_coord_subset_pbc(
            &subset, &superset, atol_tight, &mask, pbc
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
        let ftol = Some([0.1, 0.1, 0.1]);
        let (_, d2, _images) = pbc_shortest_vectors(&lattice, &c1, &c2, None, ftol);

        // (0.5, 0.5, 0.5) is outside tolerance
        assert!(d2[0][0].is_infinite());
        // (0.01, 0.01, 0.01) is within tolerance
        assert!(d2[0][1] < 1.0);
    }

    #[test]
    fn test_partial_pbc() {
        // Test with PBC only along some axes
        let atol = [0.05, 0.05, 0.05];

        // PBC only along x-axis
        let pbc_x = [true, false, false];
        let c1 = Vector3::new(0.99, 0.0, 0.0);
        let c2 = Vector3::new(0.01, 0.0, 0.0);
        // Should match via PBC along x
        assert!(coords_match_pbc(&c1, &c2, atol, pbc_x));

        // Same coords but y-axis - no PBC
        let c3 = Vector3::new(0.0, 0.99, 0.0);
        let c4 = Vector3::new(0.0, 0.01, 0.0);
        // Should NOT match (no PBC along y)
        assert!(!coords_match_pbc(&c3, &c4, atol, pbc_x));

        // No PBC at all
        let no_pbc = [false, false, false];
        assert!(!coords_match_pbc(&c1, &c2, atol, no_pbc));
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
}
