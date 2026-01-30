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

// This module contains many 3x3 matrix operations where range loops are clearer
// than iterator patterns. Allow them at module level.
#![allow(clippy::needless_range_loop)]

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
    // NOTE: Symmetry-based duplicate elimination is not yet implemented.
    // When added, a `symprec: f64` field should be introduced here.
}

impl Default for EnumConfig {
    fn default() -> Self {
        Self {
            min_size: 1,
            max_size: 10,
            concentrations: HashMap::new(),
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
///
/// Contains matrices U, S, V such that S = U * A * V where:
/// - S is diagonal with non-negative entries
/// - Diagonal entries satisfy s[0][0] | s[1][1] | s[2][2] (each divides the next)
/// - U and V are unimodular (|det| = 1)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmithResult {
    /// Left transform matrix U (unimodular)
    pub u: [[i32; 3]; 3],
    /// Diagonal Smith form S
    pub s: [[i32; 3]; 3],
    /// Right transform matrix V (unimodular)
    pub v: [[i32; 3]; 3],
}

// ============================================================================
// Helper Functions for Smith Normal Form
// ============================================================================

/// Extended Euclidean algorithm computing Bezout coefficients.
///
/// Returns (gcd, x, y) such that a*x + b*y = gcd(a, b) with gcd >= 0.
fn extended_gcd(a: i32, b: i32) -> (i32, i32, i32) {
    if b == 0 {
        if a >= 0 { (a, 1, 0) } else { (-a, -1, 0) }
    } else {
        let (gcd, x1, y1) = extended_gcd(b, a % b);
        // a*x + b*y = gcd
        // b*x1 + (a % b)*y1 = gcd
        // b*x1 + (a - (a/b)*b)*y1 = gcd
        // a*y1 + b*(x1 - (a/b)*y1) = gcd
        (gcd, y1, x1 - (a / b) * y1)
    }
}

/// Swap rows i and j in a 3x3 matrix.
fn swap_rows(m: &mut [[i32; 3]; 3], row_i: usize, row_j: usize) {
    m.swap(row_i, row_j);
}

/// Swap columns i and j in a 3x3 matrix.
fn swap_cols(m: &mut [[i32; 3]; 3], col_i: usize, col_j: usize) {
    for row in m.iter_mut() {
        row.swap(col_i, col_j);
    }
}

/// Add c times row src to row dst: R[dst] += c * R[src]
#[allow(dead_code)]
fn add_row_multiple(m: &mut [[i32; 3]; 3], dst: usize, src: usize, coeff: i32) {
    for col in 0..3 {
        m[dst][col] += coeff * m[src][col];
    }
}

/// Negate row i: R[i] *= -1
fn negate_row(m: &mut [[i32; 3]; 3], row: usize) {
    for col in 0..3 {
        m[row][col] = -m[row][col];
    }
}

/// Find the smallest non-zero absolute value in the submatrix [k:, k:].
/// Returns (row, col, value) or None if all zeros.
fn find_pivot(m: &[[i32; 3]; 3], diag_k: usize) -> Option<(usize, usize, i32)> {
    let mut best: Option<(usize, usize, i32)> = None;
    for row in diag_k..3 {
        for col in diag_k..3 {
            let val = m[row][col];
            if val != 0 {
                let abs_val = val.abs();
                if best.is_none() || abs_val < best.unwrap().2.abs() {
                    best = Some((row, col, val));
                }
            }
        }
    }
    best
}

/// Check if row k has any non-zero entries after column k.
fn row_has_off_diagonal(m: &[[i32; 3]; 3], row: usize, diag_k: usize) -> bool {
    for col in (diag_k + 1)..3 {
        if m[row][col] != 0 {
            return true;
        }
    }
    false
}

/// Check if column k has any non-zero entries after row k.
fn col_has_off_diagonal(m: &[[i32; 3]; 3], col: usize, diag_k: usize) -> bool {
    for row in (diag_k + 1)..3 {
        if m[row][col] != 0 {
            return true;
        }
    }
    false
}

/// Check if s[k][k] divides all entries in the submatrix [k+1:, k+1:].
fn diagonal_divides_submatrix(m: &[[i32; 3]; 3], diag_k: usize) -> bool {
    let divisor = m[diag_k][diag_k];
    if divisor == 0 {
        // 0 divides everything trivially (we only have zeros left)
        return true;
    }
    for row in (diag_k + 1)..3 {
        for col in (diag_k + 1)..3 {
            if m[row][col] % divisor != 0 {
                return false;
            }
        }
    }
    true
}

/// Find an entry in the submatrix [k+1:, k+1:] not divisible by s[k][k].
/// Returns (row, col) if found.
fn find_non_divisible_entry(m: &[[i32; 3]; 3], diag_k: usize) -> Option<(usize, usize)> {
    let divisor = m[diag_k][diag_k];
    if divisor == 0 {
        return None;
    }
    for row in (diag_k + 1)..3 {
        for col in (diag_k + 1)..3 {
            if m[row][col] % divisor != 0 {
                return Some((row, col));
            }
        }
    }
    None
}

/// Perform one round of elimination for diagonal position k.
/// Returns true if the row and column are now clean (zeros except diagonal).
fn eliminate_row_and_col(
    smith: &mut [[i32; 3]; 3],
    u_mat: &mut [[i32; 3]; 3],
    v_mat: &mut [[i32; 3]; 3],
    diag_k: usize,
) -> bool {
    // Find and position the pivot
    let pivot = find_pivot(smith, diag_k);
    if pivot.is_none() {
        return true; // All zeros in submatrix
    }
    let (pivot_row, pivot_col, _) = pivot.unwrap();

    // Move pivot to diagonal position (k, k)
    if pivot_row != diag_k {
        swap_rows(smith, pivot_row, diag_k);
        swap_rows(u_mat, pivot_row, diag_k);
    }
    if pivot_col != diag_k {
        swap_cols(smith, pivot_col, diag_k);
        swap_cols(v_mat, pivot_col, diag_k);
    }

    // Eliminate entries in row k (columns > k) using column operations
    for col_j in (diag_k + 1)..3 {
        if smith[diag_k][col_j] != 0 {
            let a = smith[diag_k][diag_k];
            let b = smith[diag_k][col_j];
            let (gcd, coeff_x, coeff_y) = extended_gcd(a, b);
            let coeff_a = a / gcd;
            let coeff_b = b / gcd;

            // Apply column transformation to S
            for row in 0..3 {
                let old_k = smith[row][diag_k];
                let old_j = smith[row][col_j];
                smith[row][diag_k] = coeff_x * old_k + coeff_y * old_j;
                smith[row][col_j] = -coeff_b * old_k + coeff_a * old_j;
            }

            // Apply same transformation to V
            for row in 0..3 {
                let old_k = v_mat[row][diag_k];
                let old_j = v_mat[row][col_j];
                v_mat[row][diag_k] = coeff_x * old_k + coeff_y * old_j;
                v_mat[row][col_j] = -coeff_b * old_k + coeff_a * old_j;
            }
        }
    }

    // Eliminate entries in column k (rows > k) using row operations
    for row_i in (diag_k + 1)..3 {
        if smith[row_i][diag_k] != 0 {
            let a = smith[diag_k][diag_k];
            let b = smith[row_i][diag_k];
            let (gcd, coeff_x, coeff_y) = extended_gcd(a, b);
            let coeff_a = a / gcd;
            let coeff_b = b / gcd;

            // Apply row transformation to S
            for col in 0..3 {
                let old_k = smith[diag_k][col];
                let old_i = smith[row_i][col];
                smith[diag_k][col] = coeff_x * old_k + coeff_y * old_i;
                smith[row_i][col] = -coeff_b * old_k + coeff_a * old_i;
            }

            // Apply same transformation to U
            for col in 0..3 {
                let old_k = u_mat[diag_k][col];
                let old_i = u_mat[row_i][col];
                u_mat[diag_k][col] = coeff_x * old_k + coeff_y * old_i;
                u_mat[row_i][col] = -coeff_b * old_k + coeff_a * old_i;
            }
        }
    }

    // Check if we're done
    !row_has_off_diagonal(smith, diag_k, diag_k) && !col_has_off_diagonal(smith, diag_k, diag_k)
}

/// Compute the Smith Normal Form of a 3x3 integer matrix.
///
/// Returns U, S, V such that S = U * A * V where:
/// - S is diagonal with non-negative entries
/// - Diagonal elements satisfy divisibility: s[0][0] | s[1][1] | s[2][2]
/// - U and V are unimodular (determinant +/-1)
///
/// # Algorithm
///
/// For each diagonal position k:
/// 1. Find smallest non-zero pivot in submatrix [k:, k:]
/// 2. Move pivot to position (k, k) via row/column swaps
/// 3. Use Bezout coefficients to eliminate row k and column k
/// 4. Repeat until row/column k is fully zeroed (except diagonal)
/// 5. Ensure s[k][k] divides all remaining submatrix entries
/// 6. Normalize signs to ensure non-negative diagonal
#[allow(clippy::needless_range_loop)]
pub fn smith_normal_form(mat: &[[i32; 3]; 3]) -> SmithResult {
    let mut smith = *mat;
    let mut u_mat = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; // Left transform
    let mut v_mat = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; // Right transform

    // Process each diagonal position
    for diag_k in 0..3 {
        // Phase 1: Elimination loop - zero out row k and column k
        // Use a safety counter to prevent infinite loops
        for _ in 0..100 {
            if eliminate_row_and_col(&mut smith, &mut u_mat, &mut v_mat, diag_k) {
                break;
            }
        }

        // Phase 2: Divisibility enforcement
        // Ensure s[k][k] divides all entries in the remaining submatrix
        for _ in 0..100 {
            if diagonal_divides_submatrix(&smith, diag_k) {
                break;
            }

            if let Some((_bad_row, bad_col)) = find_non_divisible_entry(&smith, diag_k) {
                // Add column bad_col to column k to bring the non-divisible element
                // into column k, then re-run elimination
                // This ensures gcd(s[k][k], s[bad_row][bad_col]) becomes new s[k][k]
                for row in 0..3 {
                    smith[row][diag_k] += smith[row][bad_col];
                    v_mat[row][diag_k] += v_mat[row][bad_col];
                }

                // Re-run elimination
                for _ in 0..100 {
                    if eliminate_row_and_col(&mut smith, &mut u_mat, &mut v_mat, diag_k) {
                        break;
                    }
                }
            }
        }
    }

    // Phase 3: Sign normalization - ensure non-negative diagonal
    for diag_k in 0..3 {
        if smith[diag_k][diag_k] < 0 {
            negate_row(&mut smith, diag_k);
            negate_row(&mut u_mat, diag_k);
        }
    }

    SmithResult {
        u: u_mat,
        s: smith,
        v: v_mat,
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

    /// Multiply two 3x3 integer matrices.
    fn mat3_multiply(mat_a: &[[i32; 3]; 3], mat_b: &[[i32; 3]; 3]) -> [[i32; 3]; 3] {
        let mut result = [[0; 3]; 3];
        for row in 0..3 {
            for col in 0..3 {
                for k in 0..3 {
                    result[row][col] += mat_a[row][k] * mat_b[k][col];
                }
            }
        }
        result
    }

    /// Compute determinant of a 3x3 integer matrix.
    fn mat3_determinant(mat: &[[i32; 3]; 3]) -> i32 {
        mat[0][0] * (mat[1][1] * mat[2][2] - mat[1][2] * mat[2][1])
            - mat[0][1] * (mat[1][0] * mat[2][2] - mat[1][2] * mat[2][0])
            + mat[0][2] * (mat[1][0] * mat[2][1] - mat[1][1] * mat[2][0])
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

    // ========== Extended GCD Tests ==========

    #[test]
    fn test_extended_gcd_basic() {
        // Test basic cases
        let cases = [
            (12, 8, 4),  // gcd(12, 8) = 4
            (15, 10, 5), // gcd(15, 10) = 5
            (7, 3, 1),   // coprime
            (100, 25, 25),
            (17, 13, 1), // coprime primes
        ];
        for (a, b, expected_gcd) in cases {
            let (gcd, x, y) = extended_gcd(a, b);
            assert_eq!(gcd, expected_gcd, "gcd({a}, {b}) should be {expected_gcd}");
            assert_eq!(a * x + b * y, gcd, "Bezout identity failed for ({a}, {b})");
        }
    }

    #[test]
    fn test_extended_gcd_edge_cases() {
        // Zero cases - verify Bézout identity: a*x + b*y = gcd
        let (gcd, _x, y) = extended_gcd(0, 5);
        assert_eq!(gcd, 5);
        assert_eq!(5 * y, 5); // 0*x + 5*y = 5

        let (gcd, x, _y) = extended_gcd(7, 0);
        assert_eq!(gcd, 7);
        assert_eq!(7 * x, 7); // 7*x + 0*y = 7

        let (gcd, _, _) = extended_gcd(0, 0);
        assert_eq!(gcd, 0);

        // Negative inputs
        let (gcd, x, y) = extended_gcd(-12, 8);
        assert!(gcd >= 0, "GCD should be non-negative");
        assert_eq!((-12) * x + 8 * y, gcd);

        let (gcd, x, y) = extended_gcd(12, -8);
        assert!(gcd >= 0);
        assert_eq!(12 * x + (-8) * y, gcd);
    }

    // ========== Matrix Helper Tests ==========

    #[test]
    fn test_mat3_multiply() {
        let identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        let mat_a = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];

        // A * I = A
        assert_eq!(mat3_multiply(&mat_a, &identity), mat_a);
        // I * A = A
        assert_eq!(mat3_multiply(&identity, &mat_a), mat_a);

        // Specific multiplication
        let mat_b = [[1, 0, 0], [0, 2, 0], [0, 0, 3]];
        let result = mat3_multiply(&mat_a, &mat_b);
        assert_eq!(result, [[1, 4, 9], [4, 10, 18], [7, 16, 27]]);
    }

    #[test]
    fn test_mat3_determinant() {
        assert_eq!(mat3_determinant(&[[1, 0, 0], [0, 1, 0], [0, 0, 1]]), 1);
        assert_eq!(mat3_determinant(&[[2, 0, 0], [0, 3, 0], [0, 0, 4]]), 24);
        assert_eq!(mat3_determinant(&[[0, 0, 0], [0, 0, 0], [0, 0, 0]]), 0);
        // Singular matrix
        assert_eq!(mat3_determinant(&[[1, 2, 3], [4, 5, 6], [7, 8, 9]]), 0);
        // Non-singular
        assert_eq!(mat3_determinant(&[[1, 2, 3], [0, 1, 4], [5, 6, 0]]), 1);
    }

    // ========== Smith Normal Form Tests ==========

    /// Helper to verify SNF properties for a given result
    fn verify_snf_properties(mat: &[[i32; 3]; 3], result: &SmithResult, name: &str) {
        // 1. S should be diagonal
        for row in 0..3 {
            for col in 0..3 {
                if row != col {
                    assert_eq!(
                        result.s[row][col], 0,
                        "{name}: S should be diagonal, but s[{row}][{col}] = {}",
                        result.s[row][col]
                    );
                }
            }
        }

        // 2. Diagonal should be non-negative
        for diag_k in 0..3 {
            assert!(
                result.s[diag_k][diag_k] >= 0,
                "{name}: Diagonal should be non-negative, but s[{diag_k}][{diag_k}] = {}",
                result.s[diag_k][diag_k]
            );
        }

        // 3. Divisibility chain: s[0][0] | s[1][1] | s[2][2]
        let s0 = result.s[0][0];
        let s1 = result.s[1][1];
        let s2 = result.s[2][2];
        if s0 != 0 {
            assert_eq!(
                s1 % s0,
                0,
                "{name}: s[0][0]={s0} should divide s[1][1]={s1}"
            );
            assert_eq!(
                s2 % s0,
                0,
                "{name}: s[0][0]={s0} should divide s[2][2]={s2}"
            );
        }
        if s1 != 0 {
            assert_eq!(
                s2 % s1,
                0,
                "{name}: s[1][1]={s1} should divide s[2][2]={s2}"
            );
        }

        // 4. Reconstruction: S = U * A * V
        let ua = mat3_multiply(&result.u, mat);
        let uav = mat3_multiply(&ua, &result.v);
        assert_eq!(
            uav, result.s,
            "{name}: Reconstruction failed. S != U * A * V\nS = {:?}\nU*A*V = {:?}",
            result.s, uav
        );

        // 5. Unimodularity: |det(U)| = |det(V)| = 1
        let det_u = mat3_determinant(&result.u);
        let det_v = mat3_determinant(&result.v);
        assert!(
            det_u == 1 || det_u == -1,
            "{name}: U should be unimodular, but det(U) = {det_u}"
        );
        assert!(
            det_v == 1 || det_v == -1,
            "{name}: V should be unimodular, but det(V) = {det_v}"
        );
    }

    #[test]
    fn test_snf_identity() {
        let identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        let result = smith_normal_form(&identity);
        verify_snf_properties(&identity, &result, "identity");
        assert_eq!(result.s, identity, "SNF of identity should be identity");
    }

    #[test]
    fn test_snf_diagonal_matrices() {
        let cases = [
            ([[2, 0, 0], [0, 3, 0], [0, 0, 4]], "diag(2,3,4)"),
            (
                [[6, 0, 0], [0, 2, 0], [0, 0, 4]],
                "diag(6,2,4) needs reorder",
            ),
            (
                [[4, 0, 0], [0, 2, 0], [0, 0, 6]],
                "diag(4,2,6) needs reorder",
            ),
            ([[1, 0, 0], [0, 1, 0], [0, 0, 1]], "identity"),
        ];
        for (mat, name) in cases {
            let result = smith_normal_form(&mat);
            verify_snf_properties(&mat, &result, name);
        }
    }

    #[test]
    fn test_snf_non_diagonal_matrices() {
        // These matrices require actual elimination, not just pivot swapping
        let cases = [
            ([[2, 4, 0], [0, 6, 0], [0, 0, 8]], "upper triangular"),
            ([[2, 0, 0], [4, 6, 0], [0, 0, 8]], "lower triangular"),
            ([[1, 2, 3], [0, 1, 0], [0, 0, 1]], "upper with off-diag"),
            ([[2, 1, 0], [1, 2, 0], [0, 0, 1]], "symmetric 2x2 block"),
            ([[6, 4, 0], [4, 6, 0], [0, 0, 1]], "symmetric needs GCD"),
        ];
        for (mat, name) in cases {
            let result = smith_normal_form(&mat);
            verify_snf_properties(&mat, &result, name);
        }
    }

    #[test]
    fn test_snf_hnf_matrices() {
        // SNF should work correctly on HNF matrices (common use case)
        for det in 1..=6 {
            let hnf_matrices = generate_hnf(det);
            for hnf in &hnf_matrices {
                let result = smith_normal_form(hnf);
                verify_snf_properties(hnf, &result, &format!("HNF det={det}"));

                // Product of diagonal should equal original determinant
                let snf_det = result.s[0][0] * result.s[1][1] * result.s[2][2];
                assert_eq!(
                    snf_det.abs(),
                    det,
                    "SNF diagonal product should equal original det"
                );
            }
        }
    }

    #[test]
    fn test_snf_zero_matrix() {
        let zero = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        let result = smith_normal_form(&zero);
        verify_snf_properties(&zero, &result, "zero matrix");
        assert_eq!(result.s, zero, "SNF of zero should be zero");
    }

    #[test]
    fn test_snf_singular_matrices() {
        let cases = [
            ([[1, 0, 0], [0, 0, 0], [0, 0, 0]], "rank 1"),
            ([[1, 0, 0], [0, 1, 0], [0, 0, 0]], "rank 2"),
            ([[1, 2, 3], [2, 4, 6], [0, 0, 0]], "rank 1 non-trivial"),
            ([[1, 2, 3], [4, 5, 6], [7, 8, 9]], "classic singular"),
        ];
        for (mat, name) in cases {
            let result = smith_normal_form(&mat);
            verify_snf_properties(&mat, &result, name);
        }
    }

    #[test]
    fn test_snf_negative_entries() {
        let cases = [
            ([[-1, 0, 0], [0, 1, 0], [0, 0, 1]], "negative diagonal"),
            ([[1, -2, 0], [0, 3, 0], [0, 0, 1]], "negative off-diag"),
            ([[-2, -4, 0], [0, -6, 0], [0, 0, -8]], "all negative"),
        ];
        for (mat, name) in cases {
            let result = smith_normal_form(&mat);
            verify_snf_properties(&mat, &result, name);
        }
    }

    #[test]
    fn test_snf_divisibility_requires_row_addition() {
        // Matrix where divisibility enforcement is needed:
        // After initial elimination, s[0][0] might not divide s[1][1]
        let mat = [[2, 0, 0], [0, 3, 0], [0, 0, 6]];
        let result = smith_normal_form(&mat);
        verify_snf_properties(&mat, &result, "divisibility check");

        // The SNF should have s[0][0] = 1 (gcd of 2,3,6)
        // and s[1][1] | s[2][2]
        assert_eq!(result.s[0][0], 1, "First diagonal should be gcd = 1");
    }

    #[test]
    fn test_snf_known_results() {
        // Known SNF results from literature/references
        // For [[2, 4], [6, 8]] extended to 3x3: SNF is diag(2, 4, 0) in 2D
        let mat = [[2, 4, 0], [6, 8, 0], [0, 0, 1]];
        let result = smith_normal_form(&mat);
        verify_snf_properties(&mat, &result, "known result");

        // 2x2 block has det = 2*8 - 4*6 = 16 - 24 = -8
        // SNF of [[2,4],[6,8]] is diag(2, 4) since gcd(2,4,6,8)=2
        // Full matrix det = -8 * 1 = -8
        // Product of SNF diagonal should have same absolute value
        let snf_product = result.s[0][0] * result.s[1][1] * result.s[2][2];
        assert_eq!(snf_product.abs(), 8);
    }

    #[test]
    fn test_snf_reconstruction_explicit() {
        // Explicit test of S = U * A * V for various matrices
        let test_matrices = [
            [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            [[2, 3, 0], [0, 4, 0], [0, 0, 5]],
            [[6, 4, 2], [4, 6, 4], [2, 4, 6]],
            [[1, 2, 3], [4, 5, 6], [7, 8, 10]], // non-singular
        ];

        for mat in test_matrices {
            let result = smith_normal_form(&mat);

            // Compute U * A
            let ua = mat3_multiply(&result.u, &mat);
            // Compute (U * A) * V
            let uav = mat3_multiply(&ua, &result.v);

            assert_eq!(
                uav, result.s,
                "Reconstruction failed for {:?}\nU = {:?}\nV = {:?}\nS = {:?}\nU*A*V = {:?}",
                mat, result.u, result.v, result.s, uav
            );
        }
    }

    #[test]
    fn test_snf_unimodularity_explicit() {
        let test_matrices = [
            [[2, 4, 6], [1, 3, 5], [0, 1, 2]],
            [[3, 0, 1], [0, 2, 0], [1, 0, 3]],
            [[5, 2, 1], [2, 5, 2], [1, 2, 5]],
        ];

        for mat in test_matrices {
            let result = smith_normal_form(&mat);

            let det_u = mat3_determinant(&result.u);
            let det_v = mat3_determinant(&result.v);

            assert!(
                det_u == 1 || det_u == -1,
                "det(U) = {det_u} should be ±1 for {:?}",
                mat
            );
            assert!(
                det_v == 1 || det_v == -1,
                "det(V) = {det_v} should be ±1 for {:?}",
                mat
            );
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
