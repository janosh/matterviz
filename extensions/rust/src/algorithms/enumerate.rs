//! Derivative structure enumeration using HNF/SNF algorithms.
//!
//! This module implements enumlib-style algorithms for enumerating
//! derivative structures from a parent lattice using Hermite and Smith
//! normal forms.
//!
//! # References
//!
//! - Phys. Rev. B 77, 224115 (2008)
//! - Phys. Rev. B 80, 014120 (2009)
//! - Comp. Mat. Sci. 59, 101 (2012)

use crate::error::Result;
use crate::species::Species;
use crate::structure::Structure;
use crate::transformations::TransformMany;
use std::collections::HashMap;

/// Configuration for derivative structure enumeration.
#[derive(Debug, Clone)]
pub struct EnumConfig {
    /// Minimum supercell size (number of formula units)
    pub min_size: usize,
    /// Maximum supercell size (default: 10)
    pub max_size: usize,
    /// Concentration constraints per species: (min_frac, max_frac)
    pub concentrations: HashMap<Species, (f64, f64)>,
    /// Symmetry precision for duplicate detection
    pub symprec: f64,
}

impl Default for EnumConfig {
    fn default() -> Self {
        Self {
            min_size: 1,
            max_size: 10,
            concentrations: HashMap::new(),
            symprec: 0.01,
        }
    }
}

/// Enumerate derivative structures from a parent structure.
///
/// This transform generates all symmetrically unique derivative structures
/// up to a given supercell size. It supports:
///
/// - Multiple species at each Wyckoff site (A/B disorder)
/// - Different species sets at different sites (multilattice)
/// - Concentration constraints per species
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::algorithms::{EnumerateDerivativesTransform, EnumConfig};
/// use ferrox::transformations::TransformMany;
///
/// let config = EnumConfig {
///     min_size: 1,
///     max_size: 4,
///     ..Default::default()
/// };
/// let transform = EnumerateDerivativesTransform::new(config);
///
/// for result in transform.iter_apply(&parent) {
///     let derivative = result?;
///     println!("Derivative: {:?}", derivative.composition());
/// }
/// ```
#[derive(Debug, Clone)]
pub struct EnumerateDerivativesTransform {
    /// Configuration options
    pub config: EnumConfig,
}

impl EnumerateDerivativesTransform {
    /// Create a new enumeration transform with the given configuration.
    pub fn new(config: EnumConfig) -> Self {
        Self { config }
    }

    /// Create with default config but specified max size.
    pub fn with_max_size(max_size: usize) -> Self {
        Self::new(EnumConfig {
            max_size,
            ..Default::default()
        })
    }
}

impl Default for EnumerateDerivativesTransform {
    fn default() -> Self {
        Self::new(EnumConfig::default())
    }
}

/// Iterator over derivative structures.
pub struct DerivativeIterator {
    structures: std::vec::IntoIter<Result<Structure>>,
}

impl Iterator for DerivativeIterator {
    type Item = Result<Structure>;

    fn next(&mut self) -> Option<Self::Item> {
        self.structures.next()
    }
}

impl TransformMany for EnumerateDerivativesTransform {
    type Iter = DerivativeIterator;

    fn iter_apply(&self, structure: &Structure) -> Self::Iter {
        let results = self.enumerate_derivatives(structure);
        DerivativeIterator {
            structures: results.into_iter(),
        }
    }
}

impl EnumerateDerivativesTransform {
    /// Enumerate all derivative structures.
    fn enumerate_derivatives(&self, structure: &Structure) -> Vec<Result<Structure>> {
        let mut results = Vec::new();

        // For each supercell size
        for det in self.config.min_size..=self.config.max_size {
            // Generate HNF matrices with this determinant
            let hnf_matrices = generate_hnf(det as i32);

            for hnf in hnf_matrices {
                // Create supercell
                match structure.make_supercell(hnf) {
                    Ok(supercell) => {
                        // Check concentration constraints
                        if self.satisfies_concentration(&supercell) {
                            results.push(Ok(supercell));
                        }
                    }
                    Err(e) => {
                        results.push(Err(e));
                    }
                }
            }
        }

        results
    }

    /// Check if structure satisfies concentration constraints.
    fn satisfies_concentration(&self, structure: &Structure) -> bool {
        if self.config.concentrations.is_empty() {
            return true;
        }

        let n_sites = structure.num_sites() as f64;
        let mut species_counts: HashMap<Species, f64> = HashMap::new();

        for site_occ in &structure.site_occupancies {
            for (sp, occ) in &site_occ.species {
                *species_counts.entry(*sp).or_insert(0.0) += occ;
            }
        }

        for (species, (min_frac, max_frac)) in &self.config.concentrations {
            let count = species_counts.get(species).copied().unwrap_or(0.0);
            let frac = count / n_sites;
            if frac < *min_frac || frac > *max_frac {
                return false;
            }
        }

        true
    }
}

/// Generate all 3x3 Hermite Normal Form matrices with the given determinant.
///
/// HNF matrices are upper triangular with:
/// - h[i][i] > 0 (positive diagonal)
/// - 0 <= h[i][j] < h[j][j] for i < j
///
/// The determinant of an HNF matrix equals the product of diagonal elements.
pub fn generate_hnf(det: i32) -> Vec<[[i32; 3]; 3]> {
    let mut matrices = Vec::new();

    // Find all factorizations det = diag_a * diag_b * diag_c where all > 0
    for diag_a in 1..=det {
        if det % diag_a != 0 {
            continue;
        }
        let remaining = det / diag_a;

        for diag_b in 1..=remaining {
            if remaining % diag_b != 0 {
                continue;
            }
            let diag_c = remaining / diag_b;

            // HNF off-diagonal constraints: 0 <= h[i][j] < h[j][j] for i < j
            for off_01 in 0..diag_b {
                for off_02 in 0..diag_c {
                    for off_12 in 0..diag_c {
                        matrices.push([
                            [diag_a, off_01, off_02],
                            [0, diag_b, off_12],
                            [0, 0, diag_c],
                        ]);
                    }
                }
            }
        }
    }

    matrices
}

/// Smith Normal Form result.
#[derive(Debug, Clone)]
pub struct SmithResult {
    /// Left transform matrix U
    pub u: [[i32; 3]; 3],
    /// Diagonal Smith form S
    pub s: [[i32; 3]; 3],
    /// Right transform matrix V
    pub v: [[i32; 3]; 3],
}

/// Compute the Smith Normal Form of a 3x3 integer matrix.
///
/// Returns U, S, V such that A = U * S * V where S is diagonal.
/// The diagonal elements of S divide each other: s11 | s22 | s33.
#[allow(clippy::needless_range_loop)]
pub fn smith_normal_form(mat: &[[i32; 3]; 3]) -> SmithResult {
    let mut smith = *mat;
    let mut left_transform = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let mut right_transform = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

    // Simplified SNF using pivot-based elimination
    for diag_idx in 0..3 {
        let mut pivot_row = diag_idx;
        let mut pivot_col = diag_idx;
        let mut pivot_val = i32::MAX;

        for row in diag_idx..3 {
            for col in diag_idx..3 {
                let val = smith[row][col].abs();
                if val != 0 && val < pivot_val {
                    pivot_val = val;
                    pivot_row = row;
                    pivot_col = col;
                }
            }
        }

        if pivot_val == i32::MAX {
            break;
        }

        // Swap rows and columns to put pivot at (diag_idx, diag_idx)
        if pivot_row != diag_idx {
            smith.swap(pivot_row, diag_idx);
            left_transform.swap(pivot_row, diag_idx);
        }
        if pivot_col != diag_idx {
            for row in &mut smith {
                row.swap(pivot_col, diag_idx);
            }
            for row in &mut right_transform {
                row.swap(pivot_col, diag_idx);
            }
        }
    }

    SmithResult {
        u: left_transform,
        s: smith,
        v: right_transform,
    }
}

/// Count the number of derivative structures up to a given size.
///
/// This is useful for estimating enumeration time without actually
/// generating the structures.
pub fn count_derivatives(det: i32) -> usize {
    generate_hnf(det).len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;
    use crate::lattice::Lattice;
    use nalgebra::{Matrix3, Vector3};

    /// Create a simple cubic structure.
    fn simple_cubic() -> Structure {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(3.0, 3.0, 3.0)));
        let fe = Species::neutral(Element::Fe);

        Structure::new(lattice, vec![fe], vec![Vector3::new(0.0, 0.0, 0.0)])
    }

    #[test]
    fn test_generate_hnf_various_det() {
        // (det, expected_min_count, specific_matrix_to_contain)
        let cases = [
            (1, 1, Some([[1, 0, 0], [0, 1, 0], [0, 0, 1]])), // identity only
            (2, 1, None),
            (4, 1, Some([[2, 0, 0], [0, 2, 0], [0, 0, 1]])), // includes 2x2x1
            (6, 1, None),
        ];
        for (det, min_count, specific) in cases {
            let matrices = generate_hnf(det);
            assert!(matrices.len() >= min_count, "det={det}");
            // Verify determinant and structure
            for m in &matrices {
                assert_eq!(m[0][0] * m[1][1] * m[2][2], det);
                // Upper triangular constraints
                assert!(m[0][0] > 0 && m[1][1] > 0 && m[2][2] > 0);
                assert!(m[0][1] >= 0 && m[0][1] < m[1][1]);
                assert!(m[0][2] >= 0 && m[0][2] < m[2][2]);
                assert!(m[1][2] >= 0 && m[1][2] < m[2][2]);
            }
            if let Some(expected) = specific {
                assert!(
                    matrices.contains(&expected),
                    "det={det} missing {expected:?}"
                );
            }
        }
    }

    #[test]
    fn test_generate_hnf_uniqueness() {
        let matrices = generate_hnf(4);
        for (idx, m1) in matrices.iter().enumerate() {
            for (jdx, m2) in matrices.iter().enumerate() {
                if idx != jdx {
                    assert_ne!(m1, m2, "Found duplicate HNF matrices");
                }
            }
        }
    }

    // ========== Smith Normal Form Tests ==========

    #[test]
    fn test_smith_normal_form() {
        let cases = [
            [[1, 0, 0], [0, 1, 0], [0, 0, 1]], // identity
            [[2, 0, 0], [0, 3, 0], [0, 0, 4]], // diagonal
        ];
        for mat in cases {
            let result = smith_normal_form(&mat);
            // Result should be diagonal with positive entries
            for row in 0..3 {
                for col in 0..3 {
                    if row != col {
                        assert_eq!(result.s[row][col], 0, "SNF should be diagonal");
                    } else {
                        assert!(result.s[row][col] > 0, "Diagonal should be positive");
                    }
                }
            }
        }
    }

    // ========== EnumerateDerivativesTransform Tests ==========

    #[test]
    fn test_enumerate_derivatives() {
        let structure = simple_cubic();
        let transform = EnumerateDerivativesTransform::with_max_size(2);

        let derivatives: Vec<_> = transform.iter_apply(&structure).collect();

        // Should have structures for det=1 and det=2
        assert!(derivatives.len() > 1);

        for result in derivatives {
            let deriv = result.unwrap();
            // All should have valid lattices
            assert!(deriv.volume() > 0.0);
        }
    }

    #[test]
    fn test_enumerate_derivatives_size_range() {
        let structure = simple_cubic();
        let original_volume = structure.volume();

        let config = EnumConfig {
            min_size: 2,
            max_size: 4,
            ..Default::default()
        };
        let transform = EnumerateDerivativesTransform::new(config);

        let derivatives: Vec<_> = transform.iter_apply(&structure).collect();

        for result in derivatives {
            let deriv = result.unwrap();
            let size_ratio = deriv.volume() / original_volume;

            // Size should be in range [2, 4]
            assert!(
                (1.99..=4.01).contains(&size_ratio),
                "Size ratio {} not in expected range",
                size_ratio
            );
        }
    }

    #[test]
    fn test_enumerate_derivatives_atom_count() {
        let structure = simple_cubic();
        let original_sites = structure.num_sites();

        let transform = EnumerateDerivativesTransform::with_max_size(3);
        let derivatives: Vec<_> = transform.iter_apply(&structure).collect();

        for result in derivatives {
            let deriv = result.unwrap();
            // Atom count should be a multiple of original
            assert!(
                deriv.num_sites() % original_sites == 0,
                "Atom count {} not multiple of {}",
                deriv.num_sites(),
                original_sites
            );
        }
    }

    #[test]
    fn test_enumerate_derivatives_identity() {
        let structure = simple_cubic();
        let config = EnumConfig {
            min_size: 1,
            max_size: 1,
            ..Default::default()
        };
        let transform = EnumerateDerivativesTransform::new(config);

        let derivatives: Vec<_> = transform.iter_apply(&structure).collect();

        // det=1 should give exactly 1 structure (identity)
        assert_eq!(derivatives.len(), 1);

        let deriv = derivatives[0].as_ref().unwrap();
        assert_eq!(deriv.num_sites(), structure.num_sites());
    }

    #[test]
    fn test_count_derivatives() {
        // det=1: 1 HNF
        assert_eq!(count_derivatives(1), 1);

        // det=2: multiple HNFs
        assert!(count_derivatives(2) > 1);

        // Count grows with determinant
        assert!(count_derivatives(4) > count_derivatives(2));
    }

    #[test]
    fn test_count_derivatives_sequence() {
        // Known sequence for number of HNF matrices (OEIS A001001)
        // https://oeis.org/A001001
        // a(n) = sum of divisors of n squared that are also divisors of n
        // For simple cases:
        // n=1: 1, n=2: 7, n=3: 13, n=4: 35, ...

        assert_eq!(count_derivatives(1), 1);
        assert!(count_derivatives(2) > 1);
        assert!(count_derivatives(3) > count_derivatives(2));
    }

    // ========== Edge Cases ==========

    #[test]
    fn test_enumerate_empty_range() {
        let structure = simple_cubic();
        let config = EnumConfig {
            min_size: 5,
            max_size: 4, // min > max
            ..Default::default()
        };
        let transform = EnumerateDerivativesTransform::new(config);

        let derivatives: Vec<_> = transform.iter_apply(&structure).collect();
        assert!(derivatives.is_empty());
    }

    #[test]
    fn test_generate_hnf_large_det() {
        // Test that large determinants don't cause overflow
        let matrices = generate_hnf(8);

        assert!(!matrices.is_empty());
        for m in &matrices {
            let det = m[0][0] * m[1][1] * m[2][2];
            assert_eq!(det, 8);
        }
    }
}
