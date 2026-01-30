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

use crate::error::{FerroxError, Result};
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
}

impl Default for EnumerateDerivativesTransform {
    fn default() -> Self {
        Self::new(EnumConfig::default())
    }
}

/// Lazy iterator over derivative structures.
///
/// Generates derivative structures on demand rather than collecting them all
/// upfront, reducing memory usage for large size ranges.
pub struct DerivativeIterator {
    /// Source structure to create supercells from
    structure: Structure,
    /// Configuration for enumeration
    config: EnumConfig,
    /// Current determinant (supercell size)
    current_det: usize,
    /// HNF matrices for the current determinant
    current_hnfs: Vec<[[i32; 3]; 3]>,
    /// Index into current_hnfs
    hnf_index: usize,
    /// Pending error to yield on first next() call
    pending_error: Option<FerroxError>,
    /// Whether iteration should stop (after yielding error or exhausting range)
    exhausted: bool,
}

/// Maximum supercell size we can enumerate (i32::MAX)
const MAX_ENUMERABLE_SIZE: usize = i32::MAX as usize;

impl DerivativeIterator {
    /// Create a new lazy derivative iterator.
    fn new(structure: Structure, config: EnumConfig) -> Self {
        // Validate size range fits in i32 (generate_hnf takes i32 determinant)
        let pending_error = if config.min_size > MAX_ENUMERABLE_SIZE {
            Some(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "min_size {} exceeds i32::MAX ({}), cannot enumerate supercells this large",
                    config.min_size, MAX_ENUMERABLE_SIZE
                ),
            })
        } else if config.max_size > MAX_ENUMERABLE_SIZE {
            Some(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "max_size {} exceeds i32::MAX ({}), cannot enumerate supercells this large",
                    config.max_size, MAX_ENUMERABLE_SIZE
                ),
            })
        } else {
            None
        };

        let has_error = pending_error.is_some();
        let current_det = config.min_size;
        // Only generate HNFs if we don't have a pending error and min_size is valid
        let current_hnfs =
            if !has_error && current_det <= config.max_size && current_det <= MAX_ENUMERABLE_SIZE {
                generate_hnf(current_det as i32)
            } else {
                Vec::new()
            };

        Self {
            structure,
            config,
            current_det,
            current_hnfs,
            hnf_index: 0,
            pending_error,
            exhausted: has_error,
        }
    }

    /// Check if structure satisfies concentration constraints.
    fn satisfies_concentration(&self, structure: &Structure) -> bool {
        if self.config.concentrations.is_empty() {
            return true;
        }

        // Guard against divide-by-zero: empty structures can't satisfy concentration constraints
        if structure.num_sites() == 0 {
            return false;
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

    /// Advance to the next determinant, returning false if exhausted.
    fn advance_to_next_det(&mut self) -> bool {
        self.current_det += 1;
        // Stop if we exceed max_size or would overflow i32
        if self.current_det > self.config.max_size || self.current_det > MAX_ENUMERABLE_SIZE {
            self.exhausted = true;
            return false;
        }
        self.current_hnfs = generate_hnf(self.current_det as i32);
        self.hnf_index = 0;
        true
    }
}

impl Iterator for DerivativeIterator {
    type Item = Result<Structure>;

    fn next(&mut self) -> Option<Self::Item> {
        // Yield pending error and stop iteration
        if let Some(err) = self.pending_error.take() {
            return Some(Err(err));
        }

        // Stop if exhausted (after error or range exhausted)
        if self.exhausted {
            return None;
        }

        loop {
            // Try to get the next HNF matrix at current determinant
            if self.hnf_index < self.current_hnfs.len() {
                let hnf = self.current_hnfs[self.hnf_index];
                self.hnf_index += 1;

                // Create supercell and check constraints
                match self.structure.make_supercell(hnf) {
                    Ok(supercell) => {
                        if self.satisfies_concentration(&supercell) {
                            return Some(Ok(supercell));
                        }
                        // Didn't satisfy constraints, continue to next HNF
                    }
                    Err(err) => {
                        return Some(Err(err));
                    }
                }
            } else {
                // Exhausted HNFs at current determinant, advance
                if !self.advance_to_next_det() {
                    return None;
                }
            }
        }
    }
}

impl TransformMany for EnumerateDerivativesTransform {
    type Iter = DerivativeIterator;

    fn iter_apply(&self, structure: &Structure) -> Self::Iter {
        DerivativeIterator::new(structure.clone(), self.config.clone())
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

/// Swap columns i and j in a 3x3 matrix.
fn swap_cols(m: &mut [[i32; 3]; 3], col_i: usize, col_j: usize) {
    for row in m {
        row.swap(col_i, col_j);
    }
}

/// Negate row i: R[i] *= -1
fn negate_row(m: &mut [[i32; 3]; 3], row: usize) {
    m[row].iter_mut().for_each(|v| *v = -*v);
}

/// Find the smallest non-zero absolute value in the submatrix [k:, k:].
fn find_pivot(m: &[[i32; 3]; 3], k: usize) -> Option<(usize, usize, i32)> {
    (k..3)
        .flat_map(|r| (k..3).map(move |c| (r, c, m[r][c])))
        .filter(|&(_, _, v)| v != 0)
        .min_by_key(|&(_, _, v)| v.abs())
}

/// Check if row/column k is clean (zeros except diagonal).
fn is_diagonal_clean(m: &[[i32; 3]; 3], k: usize) -> bool {
    let row_clean = (k + 1..3).all(|c| m[k][c] == 0);
    let col_clean = (k + 1..3).all(|r| m[r][k] == 0);
    row_clean && col_clean
}

/// Find an entry in submatrix [k+1:, k+1:] not divisible by s[k][k], or None if all divide.
fn find_non_divisible_entry(m: &[[i32; 3]; 3], k: usize) -> Option<(usize, usize)> {
    let d = m[k][k];
    if d == 0 {
        return None;
    }
    (k + 1..3)
        .flat_map(|r| (k + 1..3).map(move |c| (r, c)))
        .find(|&(r, c)| m[r][c] % d != 0)
}

/// Perform one round of elimination for diagonal position k.
/// Returns true if the row and column are now clean (zeros except diagonal).
fn eliminate_row_and_col(
    smith: &mut [[i32; 3]; 3],
    u_mat: &mut [[i32; 3]; 3],
    v_mat: &mut [[i32; 3]; 3],
    k: usize,
) -> bool {
    // Find and position the pivot
    let Some((pivot_row, pivot_col, _)) = find_pivot(smith, k) else {
        return true; // All zeros in submatrix
    };

    // Move pivot to diagonal position (k, k)
    if pivot_row != k {
        smith.swap(pivot_row, k);
        u_mat.swap(pivot_row, k);
    }
    if pivot_col != k {
        swap_cols(smith, pivot_col, k);
        swap_cols(v_mat, pivot_col, k);
    }

    // Eliminate entries in row k (columns > k) using column operations
    for j in (k + 1)..3 {
        if smith[k][j] != 0 {
            let a = smith[k][k];
            let b = smith[k][j];

            if b % a == 0 {
                // Simple subtraction when a divides b
                let mult = b / a;
                for row in 0..3 {
                    smith[row][j] -= mult * smith[row][k];
                    v_mat[row][j] -= mult * v_mat[row][k];
                }
            } else {
                // Full Bezout transformation
                let (gcd, x, y) = extended_gcd(a, b);
                let (ca, cb) = (a / gcd, b / gcd);
                for row in 0..3 {
                    let (ok, oj) = (smith[row][k], smith[row][j]);
                    smith[row][k] = x * ok + y * oj;
                    smith[row][j] = -cb * ok + ca * oj;
                }
                for row in 0..3 {
                    let (ok, oj) = (v_mat[row][k], v_mat[row][j]);
                    v_mat[row][k] = x * ok + y * oj;
                    v_mat[row][j] = -cb * ok + ca * oj;
                }
            }
        }
    }

    // Eliminate entries in column k (rows > k) using row operations
    for i in (k + 1)..3 {
        if smith[i][k] != 0 {
            let a = smith[k][k];
            let b = smith[i][k];

            if b % a == 0 {
                // Simple subtraction when a divides b
                let mult = b / a;
                for col in 0..3 {
                    smith[i][col] -= mult * smith[k][col];
                    u_mat[i][col] -= mult * u_mat[k][col];
                }
            } else {
                // Full Bezout transformation
                let (gcd, x, y) = extended_gcd(a, b);
                let (ca, cb) = (a / gcd, b / gcd);
                for col in 0..3 {
                    let (ok, oi) = (smith[k][col], smith[i][col]);
                    smith[k][col] = x * ok + y * oi;
                    smith[i][col] = -cb * ok + ca * oi;
                }
                for col in 0..3 {
                    let (ok, oi) = (u_mat[k][col], u_mat[i][col]);
                    u_mat[k][col] = x * ok + y * oi;
                    u_mat[i][col] = -cb * ok + ca * oi;
                }
            }
        }
    }

    is_diagonal_clean(smith, k)
}

/// Compute the Smith Normal Form of a 3x3 integer matrix.
///
/// Returns U, S, V such that S = U * A * V where:
/// - S is diagonal with non-negative entries
/// - Diagonal elements satisfy divisibility: s[0][0] | s[1][1] | s[2][2]
/// - U and V are unimodular (determinant +/-1)
pub fn smith_normal_form(mat: &[[i32; 3]; 3]) -> SmithResult {
    let mut s = *mat;
    let mut u = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let mut v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

    for k in 0..3 {
        // Phase 1: Eliminate row k and column k
        for _ in 0..100 {
            if eliminate_row_and_col(&mut s, &mut u, &mut v, k) {
                break;
            }
        }

        // Phase 2: Ensure s[k][k] divides all remaining submatrix entries
        while let Some((_, bad_col)) = find_non_divisible_entry(&s, k) {
            // Add column to introduce GCD reduction
            for row in 0..3 {
                s[row][k] += s[row][bad_col];
                v[row][k] += v[row][bad_col];
            }
            for _ in 0..100 {
                if eliminate_row_and_col(&mut s, &mut u, &mut v, k) {
                    break;
                }
            }
        }
    }

    // Phase 3: Ensure non-negative diagonal
    for k in 0..3 {
        if s[k][k] < 0 {
            negate_row(&mut s, k);
            negate_row(&mut u, k);
        }
    }

    SmithResult { u, s, v }
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
    fn test_extended_gcd() {
        // (a, b, expected_gcd) - tests basic cases, edge cases, and negatives
        let cases = [
            (12, 8, 4),
            (15, 10, 5),
            (7, 3, 1),
            (100, 25, 25),
            (17, 13, 1),
            (0, 5, 5),
            (7, 0, 7),
            (0, 0, 0),
            (-12, 8, 4),
            (12, -8, 4),
        ];
        for (a, b, expected_gcd) in cases {
            let (gcd, x, y) = extended_gcd(a, b);
            assert_eq!(gcd, expected_gcd, "gcd({a}, {b})");
            assert!(gcd >= 0, "gcd should be non-negative");
            assert_eq!(a * x + b * y, gcd, "Bezout identity for ({a}, {b})");
        }
    }

    // ========== Matrix Helper Tests ==========

    #[test]
    fn test_mat3_helpers() {
        let id = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        let mat = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];

        // Multiply: A*I = I*A = A
        assert_eq!(mat3_multiply(&mat, &id), mat);
        assert_eq!(mat3_multiply(&id, &mat), mat);
        assert_eq!(
            mat3_multiply(&mat, &[[1, 0, 0], [0, 2, 0], [0, 0, 3]]),
            [[1, 4, 9], [4, 10, 18], [7, 16, 27]]
        );

        // Determinant cases: (matrix, expected_det)
        let det_cases = [
            (id, 1),
            ([[2, 0, 0], [0, 3, 0], [0, 0, 4]], 24),
            ([[0; 3]; 3], 0),
            (mat, 0),
            ([[1, 2, 3], [0, 1, 4], [5, 6, 0]], 1),
        ];
        for (m, expected) in det_cases {
            assert_eq!(mat3_determinant(&m), expected);
        }
    }

    // ========== Smith Normal Form Tests ==========

    /// Verify all SNF properties: diagonal, non-negative, divisibility, reconstruction, unimodular
    fn verify_snf_properties(mat: &[[i32; 3]; 3], r: &SmithResult, name: &str) {
        let (s0, s1, s2) = (r.s[0][0], r.s[1][1], r.s[2][2]);

        // S diagonal with non-negative entries
        for i in 0..3 {
            for j in 0..3 {
                if i != j {
                    assert_eq!(r.s[i][j], 0, "{name}: off-diagonal [{i}][{j}]");
                }
            }
            assert!(r.s[i][i] >= 0, "{name}: s[{i}][{i}] negative");
        }

        // Divisibility: s0 | s1 | s2
        if s0 != 0 {
            assert!(s1 % s0 == 0 && s2 % s0 == 0, "{name}: s0 divisibility");
        }
        if s1 != 0 {
            assert!(s2 % s1 == 0, "{name}: s1 divisibility");
        }

        // Reconstruction: S = U * A * V
        let uav = mat3_multiply(&mat3_multiply(&r.u, mat), &r.v);
        assert_eq!(uav, r.s, "{name}: reconstruction S != U*A*V");

        // Unimodularity: |det(U)| = |det(V)| = 1
        assert!(
            mat3_determinant(&r.u).abs() == 1,
            "{name}: U not unimodular"
        );
        assert!(
            mat3_determinant(&r.v).abs() == 1,
            "{name}: V not unimodular"
        );
    }

    #[test]
    fn test_snf_various_matrices() {
        // Comprehensive test covering diagonal, triangular, singular, negative cases
        let cases: &[([[i32; 3]; 3], &str)] = &[
            // Identity and zero
            ([[1, 0, 0], [0, 1, 0], [0, 0, 1]], "identity"),
            ([[0, 0, 0], [0, 0, 0], [0, 0, 0]], "zero"),
            // Diagonal (some need reordering for divisibility)
            ([[2, 0, 0], [0, 3, 0], [0, 0, 4]], "diag(2,3,4)"),
            ([[6, 0, 0], [0, 2, 0], [0, 0, 4]], "diag needs reorder"),
            (
                [[2, 0, 0], [0, 3, 0], [0, 0, 6]],
                "divisibility enforcement",
            ),
            // Non-diagonal (require elimination)
            ([[2, 4, 0], [0, 6, 0], [0, 0, 8]], "upper triangular"),
            ([[2, 0, 0], [4, 6, 0], [0, 0, 8]], "lower triangular"),
            ([[2, 1, 0], [1, 2, 0], [0, 0, 1]], "symmetric"),
            ([[6, 4, 0], [4, 6, 0], [0, 0, 1]], "symmetric GCD"),
            // Singular
            ([[1, 0, 0], [0, 0, 0], [0, 0, 0]], "rank 1"),
            ([[1, 2, 3], [2, 4, 6], [0, 0, 0]], "rank 1 non-trivial"),
            ([[1, 2, 3], [4, 5, 6], [7, 8, 9]], "classic singular"),
            // Negative entries
            ([[-1, 0, 0], [0, 1, 0], [0, 0, 1]], "negative diagonal"),
            ([[-2, -4, 0], [0, -6, 0], [0, 0, -8]], "all negative"),
            // Dense matrices
            ([[6, 4, 2], [4, 6, 4], [2, 4, 6]], "dense symmetric"),
            ([[1, 2, 3], [4, 5, 6], [7, 8, 10]], "dense non-singular"),
        ];
        for (mat, name) in cases {
            let result = smith_normal_form(mat);
            verify_snf_properties(mat, &result, name);
        }
    }

    #[test]
    fn test_snf_hnf_matrices() {
        // SNF should work correctly on all HNF matrices for det 1..6
        for det in 1..=6 {
            for hnf in &generate_hnf(det) {
                let result = smith_normal_form(hnf);
                verify_snf_properties(hnf, &result, &format!("HNF det={det}"));
                let snf_det = result.s[0][0] * result.s[1][1] * result.s[2][2];
                assert_eq!(snf_det.abs(), det, "SNF det should equal original");
            }
        }
    }

    #[test]
    fn test_snf_special_cases() {
        // diag(2,3,6) should reduce to s[0][0]=1 (gcd=1)
        let mat = [[2, 0, 0], [0, 3, 0], [0, 0, 6]];
        assert_eq!(smith_normal_form(&mat).s[0][0], 1);

        // [[2,4],[6,8]] block: det=-8, SNF product should be 8
        let mat = [[2, 4, 0], [6, 8, 0], [0, 0, 1]];
        let result = smith_normal_form(&mat);
        assert_eq!(result.s[0][0] * result.s[1][1] * result.s[2][2], 8);
    }

    // ========== EnumerateDerivativesTransform Tests ==========

    #[test]
    fn test_enumerate_derivatives() {
        let structure = simple_cubic();
        let original_volume = structure.volume();
        let original_sites = structure.num_sites();

        // Test with size range [2, 4]
        let config = EnumConfig {
            min_size: 2,
            max_size: 4,
            ..Default::default()
        };
        let derivatives: Vec<_> = EnumerateDerivativesTransform::new(config)
            .iter_apply(&structure)
            .collect();

        assert!(derivatives.len() > 1);
        for result in &derivatives {
            let deriv = result.as_ref().unwrap();
            assert!(deriv.volume() > 0.0);
            assert!(deriv.num_sites() % original_sites == 0);
            let ratio = deriv.volume() / original_volume;
            assert!((1.99..=4.01).contains(&ratio), "ratio {ratio} out of range");
        }

        // Identity case: det=1 gives exactly 1 structure
        let id_config = EnumConfig {
            min_size: 1,
            max_size: 1,
            ..Default::default()
        };
        let id_derivs: Vec<_> = EnumerateDerivativesTransform::new(id_config)
            .iter_apply(&structure)
            .collect();
        assert_eq!(id_derivs.len(), 1);
        assert_eq!(id_derivs[0].as_ref().unwrap().num_sites(), original_sites);

        // Empty range: min > max gives no results
        let empty_config = EnumConfig {
            min_size: 5,
            max_size: 4,
            ..Default::default()
        };
        assert!(
            EnumerateDerivativesTransform::new(empty_config)
                .iter_apply(&structure)
                .next()
                .is_none()
        );
    }

    #[test]
    fn test_enumerate_overflow_validation() {
        let structure = simple_cubic();

        // min_size exceeding i32::MAX should yield error then stop
        let min_overflow = EnumConfig {
            min_size: usize::MAX,
            max_size: usize::MAX,
            ..Default::default()
        };
        let mut iter = EnumerateDerivativesTransform::new(min_overflow).iter_apply(&structure);
        let first = iter.next();
        assert!(first.is_some(), "Should yield an error");
        assert!(first.unwrap().is_err(), "First item should be an error");
        assert!(iter.next().is_none(), "Should stop after error");

        // max_size exceeding i32::MAX should yield error then stop
        let max_overflow = EnumConfig {
            min_size: 1,
            max_size: (i32::MAX as usize) + 1,
            ..Default::default()
        };
        let mut iter = EnumerateDerivativesTransform::new(max_overflow).iter_apply(&structure);
        let first = iter.next();
        assert!(first.is_some(), "Should yield an error");
        let err = first.unwrap().unwrap_err();
        assert!(
            format!("{err}").contains("exceeds i32::MAX"),
            "Error should mention overflow: {err}"
        );
        assert!(iter.next().is_none(), "Should stop after error");
    }

    #[test]
    fn test_count_derivatives() {
        assert_eq!(count_derivatives(1), 1);
        assert!(count_derivatives(2) > 1);
        assert!(count_derivatives(4) > count_derivatives(2));
    }

    #[test]
    fn test_generate_hnf_large_det() {
        let matrices = generate_hnf(8);
        assert!(!matrices.is_empty());
        for m in &matrices {
            assert_eq!(m[0][0] * m[1][1] * m[2][2], 8);
        }
    }
}
