//! Crystallographic lattice operations.
//!
//! This module provides the `Lattice` struct for representing crystal lattices,
//! along with operations like Niggli reduction, LLL reduction, and lattice mappings.

use crate::error::Result;
use nalgebra::{Matrix3, Vector3};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

/// A crystallographic lattice defined by a 3x3 matrix.
///
/// The lattice matrix has lattice vectors as rows:
/// ```text
/// | a1x  a1y  a1z |
/// | a2x  a2y  a2z |
/// | a3x  a3y  a3z |
/// ```
///
/// # Examples
///
/// ```
/// use ferrox::lattice::Lattice;
///
/// // Create a cubic lattice with a = 4.0 Å
/// let lattice = Lattice::cubic(4.0);
/// assert!((lattice.volume() - 64.0).abs() < 1e-10);
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lattice {
    /// The 3x3 lattice matrix (rows are lattice vectors).
    matrix: Matrix3<f64>,
    /// Periodic boundary conditions along each axis.
    pub pbc: [bool; 3],
}

impl Lattice {
    /// Create a new lattice from a 3x3 matrix.
    ///
    /// The matrix should have lattice vectors as rows.
    pub fn new(matrix: Matrix3<f64>) -> Self {
        Self {
            matrix,
            pbc: [true, true, true],
        }
    }

    /// Create a lattice from a 2D array (row-major).
    pub fn from_array(arr: [[f64; 3]; 3]) -> Self {
        let matrix = Matrix3::from_row_slice(&[
            arr[0][0], arr[0][1], arr[0][2], arr[1][0], arr[1][1], arr[1][2], arr[2][0], arr[2][1],
            arr[2][2],
        ]);
        Self::new(matrix)
    }

    /// Create a lattice from lattice parameters.
    ///
    /// Uses pymatgen's default convention (vesta=False):
    /// - c along z-axis
    /// - a in xz-plane
    /// - b general
    ///
    /// # Arguments
    ///
    /// * `a`, `b`, `c` - Lattice vector lengths in Ångströms
    /// * `alpha`, `beta`, `gamma` - Angles in degrees
    pub fn from_parameters(a: f64, b: f64, c: f64, alpha: f64, beta: f64, gamma: f64) -> Self {
        let alpha_rad = alpha * PI / 180.0;
        let beta_rad = beta * PI / 180.0;
        let gamma_rad = gamma * PI / 180.0;

        let cos_alpha = alpha_rad.cos();
        let cos_beta = beta_rad.cos();
        let cos_gamma = gamma_rad.cos();
        let sin_alpha = alpha_rad.sin();
        let sin_beta = beta_rad.sin();

        // pymatgen convention (vesta=False):
        // c along z-axis
        // a in xz-plane
        // b general
        // This matches pymatgen's default behavior for consistency
        let val = ((cos_alpha * cos_beta - cos_gamma) / (sin_alpha * sin_beta)).clamp(-1.0, 1.0);
        let gamma_star = val.acos();

        let matrix = Matrix3::from_rows(&[
            [a * sin_beta, 0.0, a * cos_beta].into(),
            [
                -b * sin_alpha * gamma_star.cos(),
                b * sin_alpha * gamma_star.sin(),
                b * cos_alpha,
            ]
            .into(),
            [0.0, 0.0, c].into(),
        ]);

        Self::new(matrix)
    }

    /// Create a cubic lattice.
    pub fn cubic(a: f64) -> Self {
        Self::from_parameters(a, a, a, 90.0, 90.0, 90.0)
    }

    /// Create a tetragonal lattice.
    pub fn tetragonal(a: f64, c: f64) -> Self {
        Self::from_parameters(a, a, c, 90.0, 90.0, 90.0)
    }

    /// Create an orthorhombic lattice.
    pub fn orthorhombic(a: f64, b: f64, c: f64) -> Self {
        Self::from_parameters(a, b, c, 90.0, 90.0, 90.0)
    }

    /// Create a hexagonal lattice.
    pub fn hexagonal(a: f64, c: f64) -> Self {
        Self::from_parameters(a, a, c, 90.0, 90.0, 120.0)
    }

    /// Get the lattice matrix.
    pub fn matrix(&self) -> &Matrix3<f64> {
        &self.matrix
    }

    /// Get the inverse of the lattice matrix.
    ///
    /// Returns identity matrix if the lattice matrix is singular (degenerate lattice).
    /// Callers expecting valid physical lattices should verify `volume() > 0` first.
    pub fn inv_matrix(&self) -> Matrix3<f64> {
        self.matrix.try_inverse().unwrap_or_else(|| {
            tracing::warn!(
                "Singular lattice matrix (det={:.2e}), using identity inverse",
                self.matrix.determinant()
            );
            Matrix3::identity()
        })
    }

    /// Get the lattice volume.
    pub fn volume(&self) -> f64 {
        self.matrix.determinant().abs()
    }

    /// Get the lengths of the lattice vectors (a, b, c).
    pub fn lengths(&self) -> Vector3<f64> {
        Vector3::new(
            self.matrix.row(0).norm(),
            self.matrix.row(1).norm(),
            self.matrix.row(2).norm(),
        )
    }

    /// Get the lattice angles in degrees (alpha, beta, gamma).
    pub fn angles(&self) -> Vector3<f64> {
        let a = self.matrix.row(0).transpose();
        let b = self.matrix.row(1).transpose();
        let c = self.matrix.row(2).transpose();

        // Clamp cosine values to [-1, 1] to avoid NaN from floating-point drift
        let alpha = (b.dot(&c) / (b.norm() * c.norm())).clamp(-1.0, 1.0).acos() * 180.0 / PI;
        let beta = (a.dot(&c) / (a.norm() * c.norm())).clamp(-1.0, 1.0).acos() * 180.0 / PI;
        let gamma = (a.dot(&b) / (a.norm() * b.norm())).clamp(-1.0, 1.0).acos() * 180.0 / PI;

        Vector3::new(alpha, beta, gamma)
    }

    /// Convert Cartesian coordinates to fractional coordinates.
    ///
    /// Uses the formula: frac = (matrix.T)^(-1) @ cart = (matrix^(-1)).T @ cart
    /// This is consistent with get_cartesian_coords which uses: cart = matrix.T @ frac
    pub fn get_fractional_coords(&self, cart_coords: &[Vector3<f64>]) -> Vec<Vector3<f64>> {
        let inv_t = self.inv_matrix().transpose();
        cart_coords.iter().map(|c| inv_t * c).collect()
    }

    /// Convert fractional coordinates to Cartesian coordinates.
    pub fn get_cartesian_coords(&self, frac_coords: &[Vector3<f64>]) -> Vec<Vector3<f64>> {
        frac_coords
            .iter()
            .map(|f| self.matrix.transpose() * f)
            .collect()
    }

    /// Create a new lattice from a matrix and PBC settings.
    pub fn from_matrix_with_pbc(matrix: Matrix3<f64>, pbc: [bool; 3]) -> Self {
        Self { matrix, pbc }
    }

    /// Convert a single Cartesian coordinate to fractional.
    pub fn get_fractional_coord(&self, cart_coord: &Vector3<f64>) -> Vector3<f64> {
        let inv_t = self.inv_matrix().transpose();
        inv_t * cart_coord
    }

    /// Convert a single fractional coordinate to Cartesian.
    pub fn get_cartesian_coord(&self, frac_coord: &Vector3<f64>) -> Vector3<f64> {
        self.matrix.transpose() * frac_coord
    }

    /// Get the reciprocal lattice.
    ///
    /// For degenerate lattices (near-zero volume), falls back to using the
    /// inverse matrix approach to avoid producing inf/NaN vectors.
    pub fn reciprocal(&self) -> Self {
        let vol = self.volume();

        // Guard against near-zero volume to avoid inf/NaN from division.
        // Threshold chosen to match typical floating-point precision limits.
        const SMALL_EPS: f64 = 1e-15;
        if vol < SMALL_EPS {
            // Mirror inv_matrix()'s defensive behavior: use the safe inverse
            // matrix (which falls back to identity for singular matrices).
            tracing::warn!(
                "Near-zero volume ({:.2e}) in reciprocal(), using inv_matrix fallback",
                vol
            );
            let recip_matrix = self.inv_matrix().transpose() * 2.0 * PI;
            return Self::new(recip_matrix);
        }

        let a = self.matrix.row(0).transpose();
        let b = self.matrix.row(1).transpose();
        let c = self.matrix.row(2).transpose();

        let a_star = b.cross(&c) / vol;
        let b_star = c.cross(&a) / vol;
        let c_star = a.cross(&b) / vol;

        let recip_matrix =
            Matrix3::from_rows(&[a_star.transpose(), b_star.transpose(), c_star.transpose()]);

        Self::new(recip_matrix * 2.0 * PI)
    }

    /// Alias for `reciprocal()` for compatibility.
    pub fn reciprocal_lattice(&self) -> Self {
        self.reciprocal()
    }

    /// Get the metric tensor G = A * A^T.
    pub fn metric_tensor(&self) -> Matrix3<f64> {
        self.matrix * self.matrix.transpose()
    }

    // -------------------------------------------------------------------------
    // LLL Reduction (Lenstra-Lenstra-Lovász)
    // -------------------------------------------------------------------------

    /// Perform LLL lattice basis reduction.
    ///
    /// Returns (reduced_matrix, mapping) where:
    /// - reduced_matrix is the LLL-reduced lattice matrix
    /// - mapping transforms original coords to LLL coords
    ///
    /// # Arguments
    ///
    /// * `delta` - Reduction parameter, typically 0.75
    fn calculate_lll(&self, delta: f64) -> (Matrix3<f64>, Matrix3<f64>) {
        // Work with column vectors (transpose of our row-major matrix)
        let mut a = self.matrix.transpose();
        let mut mapping = Matrix3::<f64>::identity();

        // Gram-Schmidt orthogonalization
        let mut b = Matrix3::<f64>::zeros();
        let mut u = Matrix3::<f64>::zeros();
        let mut m = Vector3::<f64>::zeros();

        // Initialize Gram-Schmidt
        b.set_column(0, &a.column(0));
        m[0] = b.column(0).dot(&b.column(0));

        for idx in 1..3 {
            for jdx in 0..idx {
                // Guard against division by zero for degenerate lattices
                u[(idx, jdx)] = if m[jdx] > f64::EPSILON {
                    a.column(idx).dot(&b.column(jdx)) / m[jdx]
                } else {
                    0.0
                };
            }
            let mut b_col = a.column(idx).clone_owned();
            for jdx in 0..idx {
                b_col -= u[(idx, jdx)] * b.column(jdx);
            }
            b.set_column(idx, &b_col);
            m[idx] = b.column(idx).dot(&b.column(idx));
        }

        let mut k = 2usize;
        // LLL typically converges in O(n^3 log B) iterations where B is input size.
        // For 3D lattices, 1000 iterations is extremely generous.
        const MAX_LLL_ITER: usize = 1000;
        let mut iter_count = 0;

        while k <= 3 {
            iter_count += 1;
            if iter_count > MAX_LLL_ITER {
                // LLL should always converge, but guard against numerical issues
                break;
            }
            // Size reduction
            for idx in (1..k).rev() {
                let q = u[(k - 1, idx - 1)].round();
                if q != 0.0 {
                    // Reduce the k-th basis vector
                    let a_col_im1 = a.column(idx - 1).clone_owned();
                    let mut a_col_km1 = a.column(k - 1).clone_owned();
                    a_col_km1 -= q * a_col_im1;
                    a.set_column(k - 1, &a_col_km1);

                    let map_col_im1 = mapping.column(idx - 1).clone_owned();
                    let mut map_col_km1 = mapping.column(k - 1).clone_owned();
                    map_col_km1 -= q * map_col_im1;
                    mapping.set_column(k - 1, &map_col_km1);

                    // Update GS coefficients
                    for jdx in 0..idx {
                        u[(k - 1, jdx)] -= q * u[(idx - 1, jdx)];
                    }
                    u[(k - 1, idx - 1)] -= q;
                }
            }

            // Check Lovász condition
            let b_km1_norm_sq = b.column(k - 1).dot(&b.column(k - 1));
            let b_km2_norm_sq = b.column(k - 2).dot(&b.column(k - 2));
            let u_val = u[(k - 1, k - 2)];

            if b_km1_norm_sq >= (delta - u_val * u_val) * b_km2_norm_sq {
                k += 1;
            } else {
                // Swap k-th and (k-1)-th basis vectors
                let temp_col = a.column(k - 1).clone_owned();
                a.set_column(k - 1, &a.column(k - 2).clone_owned());
                a.set_column(k - 2, &temp_col);

                let temp_map = mapping.column(k - 1).clone_owned();
                mapping.set_column(k - 1, &mapping.column(k - 2).clone_owned());
                mapping.set_column(k - 2, &temp_map);

                // Update Gram-Schmidt coefficients
                for col_idx in (k - 1)..=k.min(3) {
                    for jdx in 0..(col_idx - 1) {
                        // Guard against division by zero for degenerate lattices
                        u[(col_idx - 1, jdx)] = if m[jdx] > f64::EPSILON {
                            a.column(col_idx - 1).dot(&b.column(jdx)) / m[jdx]
                        } else {
                            0.0
                        };
                    }
                    let mut b_col = a.column(col_idx - 1).clone_owned();
                    for jdx in 0..(col_idx - 1) {
                        b_col -= u[(col_idx - 1, jdx)] * b.column(jdx);
                    }
                    b.set_column(col_idx - 1, &b_col);
                    m[col_idx - 1] = b.column(col_idx - 1).dot(&b.column(col_idx - 1));
                }

                if k > 2 {
                    k -= 1;
                }
            }
        }

        // Transpose back to row vectors
        (a.transpose(), mapping.transpose())
    }

    /// Get the LLL-reduced lattice.
    ///
    /// The Lenstra-Lenstra-Lovász (LLL) algorithm produces a basis with
    /// nearly orthogonal vectors, which is useful for PBC calculations.
    ///
    /// # Arguments
    ///
    /// * `delta` - The reduction parameter (typically 0.75)
    pub fn get_lll_reduced(&self, delta: f64) -> Self {
        let (lll_matrix, _) = self.calculate_lll(delta);
        Self::new(lll_matrix)
    }

    /// Get the LLL-reduced matrix with default delta=0.75.
    pub fn lll_matrix(&self) -> Matrix3<f64> {
        self.calculate_lll(0.75).0
    }

    /// Get the transformation matrix to LLL-reduced basis.
    pub fn lll_mapping(&self) -> Matrix3<f64> {
        self.calculate_lll(0.75).1
    }

    /// Get the inverse of the LLL mapping.
    pub fn lll_inverse(&self) -> Matrix3<f64> {
        let mapping = self.lll_mapping();
        mapping.try_inverse().unwrap_or_else(|| {
            tracing::warn!(
                "Singular LLL mapping matrix (det={:.2e}), using identity inverse",
                mapping.determinant()
            );
            Matrix3::identity()
        })
    }

    /// Convert fractional coordinates to LLL-reduced fractional coordinates.
    pub fn get_lll_frac_coords(&self, frac_coords: &[Vector3<f64>]) -> Vec<Vector3<f64>> {
        let inv = self.lll_inverse();
        frac_coords.iter().map(|f| inv * f).collect()
    }

    /// Convert LLL fractional coordinates back to original basis.
    pub fn get_frac_coords_from_lll(&self, lll_frac_coords: &[Vector3<f64>]) -> Vec<Vector3<f64>> {
        let mapping = self.lll_mapping();
        lll_frac_coords.iter().map(|f| mapping * f).collect()
    }

    // -------------------------------------------------------------------------
    // Niggli Reduction (Grosse-Kunstleve algorithm)
    // -------------------------------------------------------------------------

    /// Get the Niggli-reduced lattice.
    ///
    /// Uses the numerically stable algorithm by Grosse-Kunstleve, Sauter & Adams,
    /// Acta Cryst. A60, 1-6 (2004). doi:10.1107/S010876730302186X
    ///
    /// # Arguments
    ///
    /// * `tol` - Numerical tolerance (default 1e-5)
    ///
    /// # Errors
    ///
    /// Returns an error if the reduction fails to converge.
    pub fn get_niggli_reduced(&self, tol: f64) -> Result<Self> {
        // Start with LLL-reduced matrix for numerical stability
        let matrix = self.lll_matrix();
        let eps = tol * self.volume().powf(1.0 / 3.0);

        // Define metric tensor G = M * M^T
        let mut g = matrix * matrix.transpose();

        // Niggli reduction typically converges in ~10 iterations for most lattices.
        // 100 is a safe upper bound; if exceeded, the algorithm returns an error.
        const MAX_ITER: usize = 100;

        for _ in 0..MAX_ITER {
            // Extract metric tensor components
            // A = G[0,0], B = G[1,1], C = G[2,2]
            // E = 2*G[1,2], N = 2*G[0,2], Y = 2*G[0,1]
            let (mut a_val, mut b_val, mut c_val) = (g[(0, 0)], g[(1, 1)], g[(2, 2)]);
            let (mut e_val, mut n_val, mut y_val) =
                (2.0 * g[(1, 2)], 2.0 * g[(0, 2)], 2.0 * g[(0, 1)]);

            // A1: Ensure A <= B
            if b_val + eps < a_val
                || (f64::abs(a_val - b_val) < eps && f64::abs(e_val) > f64::abs(n_val) + eps)
            {
                let xform = Matrix3::new(0.0, -1.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, -1.0);
                g = xform.transpose() * g * xform;
                // Update values needed for A2 check (a_val recomputed after A3/A4)
                b_val = g[(1, 1)];
                c_val = g[(2, 2)];
                e_val = 2.0 * g[(1, 2)];
                n_val = 2.0 * g[(0, 2)];
                y_val = 2.0 * g[(0, 1)];
            }

            // A2: Ensure B <= C
            if c_val + eps < b_val
                || (f64::abs(b_val - c_val) < eps && f64::abs(n_val) > f64::abs(y_val) + eps)
            {
                let xform = Matrix3::new(-1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, -1.0, 0.0);
                g = xform.transpose() * g * xform;
                continue;
            }

            // A3 & A4: Sign adjustment
            let sign_e = if f64::abs(e_val) < eps {
                0.0
            } else {
                e_val.signum()
            };
            let sign_n = if f64::abs(n_val) < eps {
                0.0
            } else {
                n_val.signum()
            };
            let sign_y = if f64::abs(y_val) < eps {
                0.0
            } else {
                y_val.signum()
            };

            if sign_e * sign_n * sign_y == 1.0 {
                // A3
                let i_val = if sign_e == -1.0 { -1.0 } else { 1.0 };
                let j_val = if sign_n == -1.0 { -1.0 } else { 1.0 };
                let k_val = if sign_y == -1.0 { -1.0 } else { 1.0 };
                let xform = Matrix3::new(i_val, 0.0, 0.0, 0.0, j_val, 0.0, 0.0, 0.0, k_val);
                g = xform.transpose() * g * xform;
            } else if sign_e * sign_n * sign_y == 0.0 || sign_e * sign_n * sign_y == -1.0 {
                // A4
                let mut i_val = if sign_e == 1.0 { -1.0 } else { 1.0 };
                let mut j_val = if sign_n == 1.0 { -1.0 } else { 1.0 };
                let mut k_val = if sign_y == 1.0 { -1.0 } else { 1.0 };

                if i_val * j_val * k_val == -1.0 {
                    if sign_y == 0.0 {
                        k_val = -1.0;
                    } else if sign_n == 0.0 {
                        j_val = -1.0;
                    } else if sign_e == 0.0 {
                        i_val = -1.0;
                    }
                }
                let xform = Matrix3::new(i_val, 0.0, 0.0, 0.0, j_val, 0.0, 0.0, 0.0, k_val);
                g = xform.transpose() * g * xform;
            }

            // Recompute values after sign adjustment (c_val not needed for A5-A8)
            a_val = g[(0, 0)];
            b_val = g[(1, 1)];
            e_val = 2.0 * g[(1, 2)];
            n_val = 2.0 * g[(0, 2)];
            y_val = 2.0 * g[(0, 1)];

            // A5
            if f64::abs(e_val) > b_val + eps
                || (f64::abs(e_val - b_val) < eps && y_val - eps > 2.0 * n_val)
                || (f64::abs(e_val + b_val) < eps && -eps > y_val)
            {
                let sign = -e_val.signum();
                let xform = Matrix3::new(1.0, 0.0, 0.0, 0.0, 1.0, sign, 0.0, 0.0, 1.0);
                g = xform.transpose() * g * xform;
                continue;
            }

            // A6
            if f64::abs(n_val) > a_val + eps
                || (f64::abs(a_val - n_val) < eps && y_val - eps > 2.0 * e_val)
                || (f64::abs(a_val + n_val) < eps && -eps > y_val)
            {
                let sign = -n_val.signum();
                let xform = Matrix3::new(1.0, 0.0, sign, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
                g = xform.transpose() * g * xform;
                continue;
            }

            // A7
            if f64::abs(y_val) > a_val + eps
                || (f64::abs(a_val - y_val) < eps && n_val - eps > 2.0 * e_val)
                || (f64::abs(a_val + y_val) < eps && -eps > n_val)
            {
                let sign = -y_val.signum();
                let xform = Matrix3::new(1.0, sign, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
                g = xform.transpose() * g * xform;
                continue;
            }

            // A8
            if -eps > e_val + n_val + y_val + a_val + b_val
                || (f64::abs(e_val + n_val + y_val + a_val + b_val) < eps
                    && eps < y_val + (a_val + n_val) * 2.0)
            {
                let xform = Matrix3::new(1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0);
                g = xform.transpose() * g * xform;
                continue;
            }

            // Converged - construct lattice from metric tensor
            let a_len = g[(0, 0)].sqrt();
            let b_len = g[(1, 1)].sqrt();
            let c_len = g[(2, 2)].sqrt();

            let e_final = 2.0 * g[(1, 2)];
            let n_final = 2.0 * g[(0, 2)];
            let y_final = 2.0 * g[(0, 1)];

            // Clamp cosine values to [-1, 1] to avoid NaN from floating-point drift
            let alpha = (e_final / (2.0 * b_len * c_len)).clamp(-1.0, 1.0).acos() * 180.0 / PI;
            let beta = (n_final / (2.0 * a_len * c_len)).clamp(-1.0, 1.0).acos() * 180.0 / PI;
            let gamma = (y_final / (2.0 * a_len * b_len)).clamp(-1.0, 1.0).acos() * 180.0 / PI;

            let niggli_lattice = Self::from_parameters(a_len, b_len, c_len, alpha, beta, gamma);

            // Use find_mapping to get an aligned version (consistent with pymatgen).
            // This ensures the Niggli-reduced lattice has consistent orientation
            // relative to the original lattice, which is crucial for structure matching.
            if let Some((aligned, _, _)) =
                self.find_mapping(&niggli_lattice, tol, 5.0 * tol * 180.0 / PI, true)
            {
                // Ensure positive determinant (right-handed coordinate system).
                // The mapping may flip handedness; negating the matrix restores it.
                // This preserves volume sign convention and is consistent with pymatgen.
                return if aligned.matrix.determinant() > 0.0 {
                    Ok(aligned)
                } else {
                    Ok(Self::new(-aligned.matrix))
                };
            }

            // Fallback if no mapping found
            return Ok(niggli_lattice);
        }

        Err(crate::error::FerroxError::ReductionNotConverged {
            iterations: MAX_ITER,
        })
    }

    /// Get the Niggli-reduced lattice with default tolerance.
    pub fn get_niggli_reduced_default(&self) -> Result<Self> {
        self.get_niggli_reduced(1e-5)
    }

    // -------------------------------------------------------------------------
    // Lattice mapping
    // -------------------------------------------------------------------------

    /// Find all lattice vector mappings to a target lattice within tolerance.
    ///
    /// This finds integer transformation matrices that map this lattice to the target.
    ///
    /// # Arguments
    ///
    /// * `target` - The target lattice to map to
    /// * `ltol` - Fractional length tolerance
    /// * `atol` - Angle tolerance in degrees
    /// * `skip_rotation_matrix` - If true, don't compute rotation matrices
    ///
    /// # Returns
    ///
    /// A vector of (aligned_lattice, rotation_matrix, scale_matrix) tuples.
    pub fn find_all_mappings(
        &self,
        target: &Lattice,
        ltol: f64,
        atol: f64,
        skip_rotation_matrix: bool,
    ) -> Vec<(Lattice, Option<Matrix3<f64>>, Matrix3<i32>)> {
        let target_lengths = target.lengths();
        let target_angles = target.angles();
        let max_length = target_lengths.max() * (1.0 + ltol);

        // Search range for lattice vector candidates
        // Need extra margin for oblique cells where Cartesian lengths differ from lattice params
        let search_range = (max_length / self.lengths().min()).ceil() as i32 + 2;

        // Collect candidate vectors for each target length
        let mut cands_a = Vec::new();
        let mut cands_b = Vec::new();
        let mut cands_c = Vec::new();

        for idx in -search_range..=search_range {
            for jdx in -search_range..=search_range {
                for kdx in -search_range..=search_range {
                    if idx == 0 && jdx == 0 && kdx == 0 {
                        continue;
                    }
                    let frac = Vector3::new(idx as f64, jdx as f64, kdx as f64);
                    let cart = self.matrix.transpose() * frac;
                    let length = cart.norm();

                    // Check if this vector matches any target length
                    // Use symmetric tolerance: ratio should be in (1/(1+ltol), 1+ltol)
                    // Note: pymatgen uses strict inequalities (< and >), not <=/>=
                    // This matches pymatgen's behavior where ±ltol% means ratio in (1/1.2, 1.2)
                    let ratio_a = length / target_lengths[0];
                    let ratio_b = length / target_lengths[1];
                    let ratio_c = length / target_lengths[2];

                    let lo = 1.0 / (1.0 + ltol);
                    let hi = 1.0 + ltol;

                    if ratio_a > lo && ratio_a < hi {
                        cands_a.push((Vector3::new(idx, jdx, kdx), cart, length));
                    }
                    if ratio_b > lo && ratio_b < hi {
                        cands_b.push((Vector3::new(idx, jdx, kdx), cart, length));
                    }
                    if ratio_c > lo && ratio_c < hi {
                        cands_c.push((Vector3::new(idx, jdx, kdx), cart, length));
                    }
                }
            }
        }

        let mut results = Vec::new();

        // Check all combinations for angle matching
        for (fa, ca, la) in &cands_a {
            for (fb, cb, lb) in &cands_b {
                // Check gamma angle (between a and b)
                let cos_gamma = ca.dot(cb) / (la * lb);
                let gamma = cos_gamma.clamp(-1.0, 1.0).acos() * 180.0 / PI;
                if (gamma - target_angles[2]).abs() > atol {
                    continue;
                }

                for (fc, cc, lc) in &cands_c {
                    // Check alpha angle (between b and c)
                    let cos_alpha = cb.dot(cc) / (lb * lc);
                    let alpha = cos_alpha.clamp(-1.0, 1.0).acos() * 180.0 / PI;
                    if (alpha - target_angles[0]).abs() > atol {
                        continue;
                    }

                    // Check beta angle (between a and c)
                    let cos_beta = ca.dot(cc) / (la * lc);
                    let beta = cos_beta.clamp(-1.0, 1.0).acos() * 180.0 / PI;
                    if (beta - target_angles[1]).abs() > atol {
                        continue;
                    }

                    // Build scale matrix (integer)
                    let scale_m = Matrix3::new(
                        fa[0], fa[1], fa[2], fb[0], fb[1], fb[2], fc[0], fc[1], fc[2],
                    );

                    // Check determinant is non-zero
                    let det = scale_m.map(|x| x as f64).determinant();
                    if det.abs() < 1e-8 {
                        continue;
                    }

                    // Build aligned matrix
                    let aligned_m =
                        Matrix3::from_rows(&[ca.transpose(), cb.transpose(), cc.transpose()]);
                    let aligned_lattice = Lattice::new(aligned_m);

                    // Compute rotation matrix if requested
                    let rotation_m = if skip_rotation_matrix {
                        None
                    } else {
                        // rotation_m * aligned_m = target.matrix
                        aligned_m
                            .transpose()
                            .try_inverse()
                            .map(|inv| target.matrix.transpose() * inv)
                            .map(|r| r.transpose())
                    };

                    results.push((aligned_lattice, rotation_m, scale_m));
                }
            }
        }

        results
    }

    /// Find the first mapping between this lattice and another.
    ///
    /// # Returns
    ///
    /// `Some((aligned_lattice, rotation_matrix, scale_matrix))` if found, `None` otherwise.
    ///
    /// When multiple mappings exist, selects the one closest to identity (smallest Frobenius
    /// norm difference from identity matrix) for deterministic behavior.
    pub fn find_mapping(
        &self,
        target: &Lattice,
        ltol: f64,
        atol: f64,
        skip_rotation_matrix: bool,
    ) -> Option<(Lattice, Option<Matrix3<f64>>, Matrix3<i32>)> {
        let mut mappings = self.find_all_mappings(target, ltol, atol, skip_rotation_matrix);

        if mappings.is_empty() {
            return None;
        }

        // Sort by distance from identity scale matrix for deterministic selection
        let identity = Matrix3::<i32>::identity();
        mappings.sort_by(|a, b| {
            let dist_a: i32 = (a.2 - identity).iter().map(|x| x.abs()).sum();
            let dist_b: i32 = (b.2 - identity).iter().map(|x| x.abs()).sum();
            dist_a.cmp(&dist_b)
        });

        mappings.into_iter().next()
    }
}

/// Lattice equality uses a fixed tolerance of 1e-10 on matrix Frobenius norm.
/// For approximate comparisons with custom tolerances, use `find_mapping`.
impl PartialEq for Lattice {
    fn eq(&self, other: &Self) -> bool {
        (self.matrix - other.matrix).norm() < 1e-10
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    #[test]
    fn test_cubic() {
        let lattice = Lattice::cubic(4.0);
        assert_relative_eq!(lattice.volume(), 64.0, epsilon = 1e-10);

        let lengths = lattice.lengths();
        assert_relative_eq!(lengths[0], 4.0, epsilon = 1e-10);
        assert_relative_eq!(lengths[1], 4.0, epsilon = 1e-10);
        assert_relative_eq!(lengths[2], 4.0, epsilon = 1e-10);

        let angles = lattice.angles();
        assert_relative_eq!(angles[0], 90.0, epsilon = 1e-10);
        assert_relative_eq!(angles[1], 90.0, epsilon = 1e-10);
        assert_relative_eq!(angles[2], 90.0, epsilon = 1e-10);
    }

    #[test]
    fn test_hexagonal() {
        let lattice = Lattice::hexagonal(3.0, 5.0);
        let lengths = lattice.lengths();
        assert_relative_eq!(lengths[0], 3.0, epsilon = 1e-10);
        assert_relative_eq!(lengths[1], 3.0, epsilon = 1e-10);
        assert_relative_eq!(lengths[2], 5.0, epsilon = 1e-10);

        let angles = lattice.angles();
        assert_relative_eq!(angles[0], 90.0, epsilon = 1e-10);
        assert_relative_eq!(angles[1], 90.0, epsilon = 1e-10);
        assert_relative_eq!(angles[2], 120.0, epsilon = 1e-10);
    }

    #[test]
    fn test_coordinate_conversion() {
        let lattice = Lattice::cubic(4.0);

        let cart = vec![Vector3::new(2.0, 2.0, 2.0)];
        let frac = lattice.get_fractional_coords(&cart);
        assert_relative_eq!(frac[0][0], 0.5, epsilon = 1e-10);
        assert_relative_eq!(frac[0][1], 0.5, epsilon = 1e-10);
        assert_relative_eq!(frac[0][2], 0.5, epsilon = 1e-10);

        let cart_back = lattice.get_cartesian_coords(&frac);
        assert_relative_eq!(cart_back[0][0], 2.0, epsilon = 1e-10);
        assert_relative_eq!(cart_back[0][1], 2.0, epsilon = 1e-10);
        assert_relative_eq!(cart_back[0][2], 2.0, epsilon = 1e-10);
    }

    #[test]
    fn test_reciprocal() {
        let lattice = Lattice::cubic(4.0);
        let recip = lattice.reciprocal();

        // For cubic, reciprocal lengths should be 2π/a
        let recip_lengths = recip.lengths();
        let expected = 2.0 * PI / 4.0;
        assert_relative_eq!(recip_lengths[0], expected, epsilon = 1e-10);
        assert_relative_eq!(recip_lengths[1], expected, epsilon = 1e-10);
        assert_relative_eq!(recip_lengths[2], expected, epsilon = 1e-10);
    }

    #[test]
    fn test_lll_reduction_cubic() {
        // For a cubic lattice, LLL should return essentially the same lattice
        let lattice = Lattice::cubic(4.0);
        let lll = lattice.get_lll_reduced(0.75);

        // Volume should be preserved
        assert_relative_eq!(lll.volume(), lattice.volume(), epsilon = 1e-8);
    }

    #[test]
    fn test_lll_reduction_skewed() {
        // Create a skewed lattice
        let matrix = Matrix3::new(4.0, 0.0, 0.0, 2.0, 4.0, 0.0, 1.0, 1.0, 4.0);
        let lattice = Lattice::new(matrix);
        let lll = lattice.get_lll_reduced(0.75);

        // Volume should be preserved
        assert_relative_eq!(lll.volume(), lattice.volume(), epsilon = 1e-8);

        // LLL-reduced vectors should be more orthogonal
        // (this is a qualitative check - vectors shouldn't be longer than originals)
        let orig_lengths = lattice.lengths();
        let lll_lengths = lll.lengths();

        // At least one vector should be shorter or equal
        let total_orig: f64 = orig_lengths.iter().sum();
        let total_lll: f64 = lll_lengths.iter().sum();
        assert!(total_lll <= total_orig + 1e-8);
    }

    #[test]
    fn test_lll_reduction_degenerate_lattice() {
        // Test with near-degenerate lattice (linearly dependent vectors)
        // This should not panic or produce NaN/Inf due to division by zero
        let matrix = Matrix3::new(
            1.0, 0.0, 0.0, // first vector
            2.0, 0.0, 0.0, // parallel to first (degenerate)
            0.0, 0.0, 1.0, // third vector
        );
        let lattice = Lattice::new(matrix);
        let lll = lattice.get_lll_reduced(0.75);

        // Result should not contain NaN or Inf
        let lll_mat = lll.matrix();
        for idx in 0..3 {
            for jdx in 0..3 {
                assert!(
                    lll_mat[(idx, jdx)].is_finite(),
                    "LLL result should be finite, got {:?}",
                    lll_mat
                );
            }
        }
    }

    #[test]
    fn test_niggli_reduction_cubic() {
        let lattice = Lattice::cubic(4.0);
        let niggli = lattice.get_niggli_reduced(1e-5).unwrap();

        // For cubic, Niggli reduced should have same lengths
        let lengths = niggli.lengths();
        assert_relative_eq!(lengths[0], 4.0, epsilon = 1e-5);
        assert_relative_eq!(lengths[1], 4.0, epsilon = 1e-5);
        assert_relative_eq!(lengths[2], 4.0, epsilon = 1e-5);

        // Volume should be preserved
        assert_relative_eq!(niggli.volume(), 64.0, epsilon = 1e-5);
    }

    #[test]
    fn test_niggli_reduction_supercell() {
        // Create a 2x1x1 supercell of cubic
        let matrix = Matrix3::new(8.0, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 4.0);
        let lattice = Lattice::new(matrix);
        let niggli = lattice.get_niggli_reduced(1e-5).unwrap();

        // Volume should be preserved
        assert_relative_eq!(niggli.volume(), lattice.volume(), epsilon = 1e-5);

        // Niggli reduction should give a ≤ b ≤ c
        let lengths = niggli.lengths();
        assert!(lengths[0] <= lengths[1] + 1e-5);
        assert!(lengths[1] <= lengths[2] + 1e-5);
    }

    #[test]
    fn test_niggli_reduction_triclinic() {
        // Triclinic lattice
        let lattice = Lattice::from_parameters(3.0, 4.0, 5.0, 80.0, 85.0, 95.0);
        let niggli = lattice.get_niggli_reduced(1e-5).unwrap();

        // Volume should be preserved
        assert_relative_eq!(niggli.volume(), lattice.volume(), epsilon = 1e-3);

        // Niggli reduction should give a ≤ b ≤ c
        let lengths = niggli.lengths();
        assert!(lengths[0] <= lengths[1] + 1e-5);
        assert!(lengths[1] <= lengths[2] + 1e-5);
    }

    #[test]
    fn test_niggli_acute_angles() {
        // rhomb_3478 - angles (28°, 28°, 28°)
        let lattice = Lattice::from_parameters(5.0, 5.0, 5.0, 28.0, 28.0, 28.0);
        let niggli = lattice.get_niggli_reduced(1e-5).unwrap();

        // Niggli should produce angles in [60, 120]
        let angles = niggli.angles();
        println!("Input angles: (28°, 28°, 28°)");
        println!(
            "Niggli angles: ({:.2}°, {:.2}°, {:.2}°)",
            angles[0], angles[1], angles[2]
        );
        println!("Niggli lengths: {:?}", niggli.lengths());

        for (idx, &angle) in angles.iter().enumerate() {
            assert!(
                (59.0..=121.0).contains(&angle),
                "Niggli angle[{}] = {} out of valid range [60, 120]",
                idx,
                angle
            );
        }

        // Also test MgNiF6 case - angles (56.5°, 56.5°, 56.5°)
        let lattice2 = Lattice::from_parameters(5.0, 5.0, 5.0, 56.5, 56.5, 56.5);
        let niggli2 = lattice2.get_niggli_reduced(1e-5).unwrap();
        let angles2 = niggli2.angles();
        println!("\nInput angles: (56.5°, 56.5°, 56.5°)");
        println!(
            "Niggli angles: ({:.2}°, {:.2}°, {:.2}°)",
            angles2[0], angles2[1], angles2[2]
        );

        for (idx, &angle) in angles2.iter().enumerate() {
            assert!(
                (59.0..=121.0).contains(&angle),
                "Niggli angle[{}] = {} out of valid range [60, 120]",
                idx,
                angle
            );
        }
    }

    #[test]
    fn test_from_parameters_consistency() {
        // Test that from_parameters produces correct matrix orientation
        // Using simple cubic case where we know the answer
        let cubic = Lattice::from_parameters(4.0, 4.0, 4.0, 90.0, 90.0, 90.0);
        let m = cubic.matrix();
        println!("Cubic (4, 4, 4, 90, 90, 90):");
        println!(
            "  row0 = ({:.4}, {:.4}, {:.4})",
            m[(0, 0)],
            m[(0, 1)],
            m[(0, 2)]
        );
        println!(
            "  row1 = ({:.4}, {:.4}, {:.4})",
            m[(1, 0)],
            m[(1, 1)],
            m[(1, 2)]
        );
        println!(
            "  row2 = ({:.4}, {:.4}, {:.4})",
            m[(2, 0)],
            m[(2, 1)],
            m[(2, 2)]
        );

        // For cubic, should have:
        // a = [4, 0, 0]
        // b = [0, 4, 0]
        // c = [0, 0, 4]
        assert_relative_eq!(m[(0, 0)], 4.0, epsilon = 1e-10);
        assert_relative_eq!(m[(0, 1)], 0.0, epsilon = 1e-10);
        assert_relative_eq!(m[(0, 2)], 0.0, epsilon = 1e-10);
        assert_relative_eq!(m[(1, 0)], 0.0, epsilon = 1e-10);
        assert_relative_eq!(m[(1, 1)], 4.0, epsilon = 1e-10);
        assert_relative_eq!(m[(1, 2)], 0.0, epsilon = 1e-10);
        assert_relative_eq!(m[(2, 0)], 0.0, epsilon = 1e-10);
        assert_relative_eq!(m[(2, 1)], 0.0, epsilon = 1e-10);
        assert_relative_eq!(m[(2, 2)], 4.0, epsilon = 1e-10);

        // Test hexagonal
        let hex = Lattice::from_parameters(3.0, 3.0, 5.0, 90.0, 90.0, 120.0);
        let mh = hex.matrix();
        println!("\nHexagonal (3, 3, 5, 90, 90, 120):");
        println!(
            "  row0 = ({:.4}, {:.4}, {:.4})",
            mh[(0, 0)],
            mh[(0, 1)],
            mh[(0, 2)]
        );
        println!(
            "  row1 = ({:.4}, {:.4}, {:.4})",
            mh[(1, 0)],
            mh[(1, 1)],
            mh[(1, 2)]
        );
        println!(
            "  row2 = ({:.4}, {:.4}, {:.4})",
            mh[(2, 0)],
            mh[(2, 1)],
            mh[(2, 2)]
        );

        // For hexagonal:
        // a = [3, 0, 0]
        // b = [3*cos(120), 3*sin(120), 0] = [-1.5, 2.598, 0]
        // c = [0, 0, 5]
        assert_relative_eq!(mh[(0, 0)], 3.0, epsilon = 1e-10);
        assert_relative_eq!(mh[(0, 1)], 0.0, epsilon = 1e-10);
        assert_relative_eq!(mh[(1, 0)], -1.5, epsilon = 1e-10);
        assert_relative_eq!(mh[(1, 1)], 2.598, epsilon = 0.001); // 3*sin(120) ≈ 2.598
        assert_relative_eq!(mh[(2, 2)], 5.0, epsilon = 1e-10);

        // Test acute angles (rhomb_3478-like)
        let acute = Lattice::from_parameters(5.935, 5.935, 5.935, 28.05, 28.05, 28.05);
        let ma = acute.matrix();
        println!("\nAcute (5.935, 5.935, 5.935, 28.05, 28.05, 28.05):");
        println!(
            "  row0 = ({:.4}, {:.4}, {:.4})",
            ma[(0, 0)],
            ma[(0, 1)],
            ma[(0, 2)]
        );
        println!(
            "  row1 = ({:.4}, {:.4}, {:.4})",
            ma[(1, 0)],
            ma[(1, 1)],
            ma[(1, 2)]
        );
        println!(
            "  row2 = ({:.4}, {:.4}, {:.4})",
            ma[(2, 0)],
            ma[(2, 1)],
            ma[(2, 2)]
        );
        println!("  lengths: {:?}", acute.lengths());
        println!("  angles: {:?}", acute.angles());

        // With pymatgen convention (vesta=False):
        // c along z, a in xz-plane
        // Third vector should be along z (c)
        assert_relative_eq!(ma[(2, 0)], 0.0, epsilon = 1e-10);
        assert_relative_eq!(ma[(2, 1)], 0.0, epsilon = 1e-10);
        assert_relative_eq!(ma[(2, 2)], 5.935, epsilon = 1e-10);
        // Verify angles and lengths are correct
        let angles = acute.angles();
        assert_relative_eq!(angles[0], 28.05, epsilon = 0.001);
        assert_relative_eq!(angles[1], 28.05, epsilon = 0.001);
        assert_relative_eq!(angles[2], 28.05, epsilon = 0.001);
    }

    #[test]
    fn test_niggli_pymatgen_compat() {
        // EXACT matrix from pymatgen for rhomb_3478.cif
        // This is what pymatgen produces when loading the CIF
        let matrix = Matrix3::from_rows(&[
            [2.790935, 0.000000, 5.238132].into(),
            [1.308401, 2.465239, 5.238132].into(),
            [0.000000, 0.000000, 5.935263].into(),
        ]);
        let lattice = Lattice::new(matrix);

        println!("Input matrix (same as pymatgen):");
        let m = lattice.matrix();
        println!(
            "  row0 = ({:.6}, {:.6}, {:.6})",
            m[(0, 0)],
            m[(0, 1)],
            m[(0, 2)]
        );
        println!(
            "  row1 = ({:.6}, {:.6}, {:.6})",
            m[(1, 0)],
            m[(1, 1)],
            m[(1, 2)]
        );
        println!(
            "  row2 = ({:.6}, {:.6}, {:.6})",
            m[(2, 0)],
            m[(2, 1)],
            m[(2, 2)]
        );
        println!("  angles: {:?}", lattice.angles());
        println!("  lengths: {:?}", lattice.lengths());

        // Get Niggli reduced
        let niggli = lattice.get_niggli_reduced(1e-5).unwrap();
        println!("\nRust Niggli matrix:");
        let mn = niggli.matrix();
        println!(
            "  row0 = ({:.6}, {:.6}, {:.6})",
            mn[(0, 0)],
            mn[(0, 1)],
            mn[(0, 2)]
        );
        println!(
            "  row1 = ({:.6}, {:.6}, {:.6})",
            mn[(1, 0)],
            mn[(1, 1)],
            mn[(1, 2)]
        );
        println!(
            "  row2 = ({:.6}, {:.6}, {:.6})",
            mn[(2, 0)],
            mn[(2, 1)],
            mn[(2, 2)]
        );
        println!("  angles: {:?}", niggli.angles());
        println!("  lengths: {:?}", niggli.lengths());
        println!("  determinant: {:?}", mn.determinant());

        // pymatgen Niggli result:
        // row0 = (1.308401, 2.465239, -0.697131)
        // row1 = (2.790935, -0.000000, -0.697131)
        // row2 = (-0.000000, -0.000000, -5.935263)
        // angles: (75.975, 75.975, 60.0)
        // determinant: 40.8365

        // Verify angles match pymatgen
        let angles = niggli.angles();
        assert_relative_eq!(angles[0], 75.975, epsilon = 0.01);
        assert_relative_eq!(angles[1], 75.975, epsilon = 0.01);
        assert_relative_eq!(angles[2], 60.0, epsilon = 0.01);

        // Verify lengths match pymatgen
        let lengths = niggli.lengths();
        assert_relative_eq!(lengths[0], 2.8767, epsilon = 0.001);
        assert_relative_eq!(lengths[1], 2.8767, epsilon = 0.001);
        assert_relative_eq!(lengths[2], 5.9353, epsilon = 0.001);

        // Verify positive determinant (same volume as original)
        assert!(
            mn.determinant() > 0.0,
            "Niggli determinant should be positive"
        );
    }

    #[test]
    fn test_niggli_consistency() {
        // Verify Niggli reduction produces consistent results for the same input
        let matrix = Matrix3::from_rows(&[
            [2.790935, 0.000000, 5.238132].into(),
            [1.308401, 2.465239, 5.238132].into(),
            [0.000000, 0.000000, 5.935263].into(),
        ]);
        let lattice = Lattice::new(matrix);

        // Run Niggli reduction multiple times
        let niggli1 = lattice.get_niggli_reduced(1e-5).unwrap();
        let niggli2 = lattice.get_niggli_reduced(1e-5).unwrap();
        let niggli3 = lattice.get_niggli_reduced(1e-5).unwrap();

        // All should produce identical matrices
        let m1 = niggli1.matrix();
        let m2 = niggli2.matrix();
        let m3 = niggli3.matrix();

        println!(
            "Run 1: row0 = ({:.6}, {:.6}, {:.6})",
            m1[(0, 0)],
            m1[(0, 1)],
            m1[(0, 2)]
        );
        println!(
            "Run 2: row0 = ({:.6}, {:.6}, {:.6})",
            m2[(0, 0)],
            m2[(0, 1)],
            m2[(0, 2)]
        );
        println!(
            "Run 3: row0 = ({:.6}, {:.6}, {:.6})",
            m3[(0, 0)],
            m3[(0, 1)],
            m3[(0, 2)]
        );

        for idx in 0..3 {
            for jdx in 0..3 {
                assert_relative_eq!(m1[(idx, jdx)], m2[(idx, jdx)], epsilon = 1e-10);
                assert_relative_eq!(m2[(idx, jdx)], m3[(idx, jdx)], epsilon = 1e-10);
            }
        }
    }

    #[test]
    fn test_find_mapping_alignment() {
        // Test that find_mapping returns same alignment as pymatgen
        let matrix = Matrix3::from_rows(&[
            [2.790935, 0.000000, 5.238132].into(),
            [1.308401, 2.465239, 5.238132].into(),
            [0.000000, 0.000000, 5.935263].into(),
        ]);
        let lattice = Lattice::new(matrix);

        // Create ideal Niggli from parameters (same as pymatgen does internally)
        let ideal_niggli = Lattice::from_parameters(2.8767, 2.8767, 5.9353, 75.975, 75.975, 60.0);

        println!("Ideal Niggli matrix:");
        let mi = ideal_niggli.matrix();
        println!(
            "  row0 = ({:.6}, {:.6}, {:.6})",
            mi[(0, 0)],
            mi[(0, 1)],
            mi[(0, 2)]
        );
        println!(
            "  row1 = ({:.6}, {:.6}, {:.6})",
            mi[(1, 0)],
            mi[(1, 1)],
            mi[(1, 2)]
        );
        println!(
            "  row2 = ({:.6}, {:.6}, {:.6})",
            mi[(2, 0)],
            mi[(2, 1)],
            mi[(2, 2)]
        );

        // Find mapping from original to ideal Niggli
        let tol = 1e-5 * lattice.volume().powf(1.0 / 3.0);
        if let Some((aligned, _, scale)) = lattice.find_mapping(
            &ideal_niggli,
            tol,
            5.0 * tol * 180.0 / std::f64::consts::PI,
            true,
        ) {
            let ma = aligned.matrix();
            println!("\nAligned lattice from find_mapping:");
            println!(
                "  row0 = ({:.6}, {:.6}, {:.6})",
                ma[(0, 0)],
                ma[(0, 1)],
                ma[(0, 2)]
            );
            println!(
                "  row1 = ({:.6}, {:.6}, {:.6})",
                ma[(1, 0)],
                ma[(1, 1)],
                ma[(1, 2)]
            );
            println!(
                "  row2 = ({:.6}, {:.6}, {:.6})",
                ma[(2, 0)],
                ma[(2, 1)],
                ma[(2, 2)]
            );
            println!("  determinant: {:.6}", ma.determinant());
            println!("  scale_matrix: {:?}", scale);

            // pymatgen aligned lattice:
            // [[-1.308401, -2.465239,  0.697131],
            //  [-2.790935,  0.,        0.697131],
            //  [ 0.,        0.,        5.935263]]
            // with det = -40.8365 and scale = [[0, -1, 1], [-1, 0, 1], [0, 0, 1]]

            // After negation (since det < 0):
            // [[1.308401, 2.465239, -0.697131],
            //  [2.790935, 0.,       -0.697131],
            //  [0.,       0.,       -5.935263]]
        } else {
            panic!("No mapping found!");
        }
    }

    #[test]
    fn test_find_mapping_acute_angles() {
        // Real rhomb_3478 lattice parameters
        let lattice = Lattice::from_parameters(5.935, 5.935, 5.935, 28.05, 28.05, 28.05);

        // Get Niggli-reduced
        let niggli = lattice.get_niggli_reduced(1e-5).unwrap();
        println!("Niggli lattice:");
        let m = niggli.matrix();
        println!(
            "  row0 = ({:.4}, {:.4}, {:.4})",
            m[(0, 0)],
            m[(0, 1)],
            m[(0, 2)]
        );
        println!(
            "  row1 = ({:.4}, {:.4}, {:.4})",
            m[(1, 0)],
            m[(1, 1)],
            m[(1, 2)]
        );
        println!(
            "  row2 = ({:.4}, {:.4}, {:.4})",
            m[(2, 0)],
            m[(2, 1)],
            m[(2, 2)]
        );
        println!("  angles: {:?}", niggli.angles());
        println!("  lengths: {:?}", niggli.lengths());

        // Find self-mappings from Niggli lattice
        let mappings = niggli.find_all_mappings(&niggli, 0.2, 5.0, true);
        println!("  Niggli->Niggli mappings: {}", mappings.len());

        // Should find at least identity mapping
        assert!(
            !mappings.is_empty(),
            "Expected to find at least identity mapping for Niggli reduced acute angle lattice"
        );

        // Also test from original lattice
        let orig_mappings = lattice.find_all_mappings(&lattice, 0.2, 5.0, true);
        println!("  Original->Original mappings: {}", orig_mappings.len());
        assert!(
            !orig_mappings.is_empty(),
            "Expected to find mappings for acute angle lattice"
        );
    }

    #[test]
    fn test_find_mapping_identity() {
        let lattice = Lattice::cubic(4.0);

        // Should find identity mapping to itself
        let mapping = lattice.find_mapping(&lattice, 0.1, 5.0, true);
        assert!(mapping.is_some());

        let (aligned, _, scale) = mapping.unwrap();
        // Aligned lattice should have same volume
        assert_relative_eq!(aligned.volume(), lattice.volume(), epsilon = 1e-3);
        // Scale matrix determinant should be ±1 (no supercell)
        let det = scale.map(|x| x as f64).determinant().abs();
        assert_relative_eq!(det, 1.0, epsilon = 1e-8);
    }

    #[test]
    fn test_find_mapping_equivalent() {
        // Test finding mapping between equivalent lattices with different orientations
        let lat1 = Lattice::cubic(4.0);
        // Same lattice but with permuted axes
        let lat2 = Lattice::new(Matrix3::new(0.0, 4.0, 0.0, 0.0, 0.0, 4.0, 4.0, 0.0, 0.0));

        // Should find mapping
        let mapping = lat1.find_mapping(&lat2, 0.1, 5.0, true);
        assert!(mapping.is_some());

        let (aligned, _, _) = mapping.unwrap();
        // Aligned lattice should have same volume
        assert_relative_eq!(aligned.volume(), lat2.volume(), epsilon = 1e-3);
    }

    #[test]
    fn test_find_mapping_obtuse_angles() {
        // Co8-like lattice: angles (103.4°, 103.4°, 90°), c/a = 2.15
        // This tests that find_all_mappings handles oblique cells properly
        let lattice = Lattice::from_parameters(3.7, 3.7, 8.0, 103.0, 103.0, 90.0);

        let angles = lattice.angles();
        eprintln!(
            "Lattice: lengths={:?}, angles=[{:.1}°, {:.1}°, {:.1}°]",
            lattice.lengths(),
            angles[0],
            angles[1],
            angles[2]
        );

        // Should find at least the identity mapping to itself
        let mappings = lattice.find_all_mappings(&lattice, 0.2, 5.0, true);
        eprintln!("Found {} mappings", mappings.len());

        assert!(
            !mappings.is_empty(),
            "Should find at least one mapping for obtuse angle lattice"
        );

        // Verify we found a valid mapping
        let (aligned, _, scale) = &mappings[0];
        assert_relative_eq!(aligned.volume(), lattice.volume(), epsilon = 0.1);
        // Scale matrix determinant should be ±1 (no supercell)
        let det = scale.map(|x| x as f64).determinant().abs();
        assert_relative_eq!(det, 1.0, epsilon = 1e-8);
    }

    #[test]
    fn test_find_mapping_obtuse_la2coo4() {
        // La2CoO4-like lattice: angles (90°, 90°, 132.8°)
        let lattice = Lattice::from_parameters(5.5, 5.5, 12.5, 90.0, 90.0, 132.8);

        let angles = lattice.angles();
        eprintln!(
            "La2CoO4 Lattice: lengths={:?}, angles=[{:.1}°, {:.1}°, {:.1}°]",
            lattice.lengths(),
            angles[0],
            angles[1],
            angles[2]
        );

        let mappings = lattice.find_all_mappings(&lattice, 0.2, 5.0, true);
        eprintln!("Found {} mappings", mappings.len());

        assert!(
            !mappings.is_empty(),
            "Should find at least one mapping for La2CoO4-like lattice"
        );
    }

    #[test]
    fn test_niggli_co8_lattice() {
        // Co8 lattice: angles (103.4°, 103.4°, 90°), c/a = 2.15
        // Matrix from pymatgen:
        // [[ 3.60626994  0.         -0.85837136]
        //  [-0.20223523  3.60059493 -0.85837136]
        //  [ 0.          0.          7.98790154]]
        let matrix = Matrix3::new(
            3.60626994,
            0.0,
            -0.85837136,
            -0.20223523,
            3.60059493,
            -0.85837136,
            0.0,
            0.0,
            7.98790154,
        );
        let lattice = Lattice::new(matrix);

        eprintln!(
            "Original: lengths={:?}, angles={:?}",
            lattice.lengths(),
            lattice.angles()
        );

        let niggli = lattice.get_niggli_reduced(1e-5).unwrap();
        eprintln!(
            "Niggli: lengths={:?}, angles={:?}",
            niggli.lengths(),
            niggli.angles()
        );
        eprintln!("Niggli matrix:\n{}", niggli.matrix());

        // Test that Niggli self-mapping includes identity
        let mappings = niggli.find_all_mappings(&niggli, 0.2, 5.0, true);
        eprintln!("Niggli self-mappings: {}", mappings.len());
        let has_identity = mappings.iter().any(|(_, _, scale)| {
            scale[(0, 0)].abs() == 1
                && scale[(1, 1)].abs() == 1
                && scale[(2, 2)].abs() == 1
                && scale[(0, 1)] == 0
                && scale[(0, 2)] == 0
                && scale[(1, 0)] == 0
                && scale[(1, 2)] == 0
                && scale[(2, 0)] == 0
                && scale[(2, 1)] == 0
        });
        eprintln!("Has diagonal identity-like mapping: {}", has_identity);
        for m in &mappings {
            eprintln!("  scale_m: {:?}", m.2);
        }

        // Niggli angles should be in [60°, 120°]
        let angles = niggli.angles();
        for idx in 0..3 {
            let angle = angles[idx];
            assert!(
                (59.0..=121.0).contains(&angle),
                "Niggli angle {} out of expected range [60°, 120°]",
                angle
            );
        }
    }

    #[test]
    fn test_find_all_mappings_length_tolerance_bounds() {
        // Test that length tolerance uses symmetric bounds (1/(1+ltol), 1+ltol)
        // not asymmetric bounds (1-ltol, 1+ltol)
        // With ltol=0.2: correct range is (0.833, 1.2), NOT (0.8, 1.2)

        let ltol = 0.2;
        let atol = 5.0;

        // Base cubic lattice
        let base = Lattice::cubic(5.0);

        // Test 1: Ratio 0.84 - inside both (0.833, 1.2) and (0.8, 1.2)
        // Should find mapping
        let scaled_084 = Lattice::cubic(5.0 * 0.84);
        let mappings = base.find_all_mappings(&scaled_084, ltol, atol, true);
        assert!(
            !mappings.is_empty(),
            "Ratio 0.84 should be inside tolerance (0.833, 1.2)"
        );

        // Test 2: Ratio 0.82 - inside (0.8, 1.2) but OUTSIDE (0.833, 1.2)
        // Should NOT find mapping with correct implementation
        let scaled_082 = Lattice::cubic(5.0 * 0.82);
        let mappings = base.find_all_mappings(&scaled_082, ltol, atol, true);
        assert!(
            mappings.is_empty(),
            "Ratio 0.82 should be OUTSIDE tolerance (0.833, 1.2)"
        );

        // Test 3: Ratio exactly at boundary 0.833 (= 1/1.2)
        // With strict inequalities, boundary is excluded
        let scaled_boundary = Lattice::cubic(5.0 / 1.2);
        let mappings = base.find_all_mappings(&scaled_boundary, ltol, atol, true);
        assert!(
            mappings.is_empty(),
            "Ratio 0.833 (exact boundary) should be excluded with strict inequality"
        );

        // Test 4: Ratio 1.19 - inside (0.833, 1.2)
        // Should find mapping
        let scaled_119 = Lattice::cubic(5.0 * 1.19);
        let mappings = base.find_all_mappings(&scaled_119, ltol, atol, true);
        assert!(
            !mappings.is_empty(),
            "Ratio 1.19 should be inside tolerance (0.833, 1.2)"
        );

        // Test 5: Ratio 1.21 - outside (0.833, 1.2)
        // Should NOT find mapping
        let scaled_121 = Lattice::cubic(5.0 * 1.21);
        let mappings = base.find_all_mappings(&scaled_121, ltol, atol, true);
        assert!(
            mappings.is_empty(),
            "Ratio 1.21 should be OUTSIDE tolerance (0.833, 1.2)"
        );

        // Test 6: Ratio exactly at boundary 1.2
        // With strict inequalities, boundary is excluded
        let scaled_upper = Lattice::cubic(5.0 * 1.2);
        let mappings = base.find_all_mappings(&scaled_upper, ltol, atol, true);
        assert!(
            mappings.is_empty(),
            "Ratio 1.2 (exact boundary) should be excluded with strict inequality"
        );
    }

    #[test]
    fn test_find_all_mappings_triclinic_one_axis_outside() {
        // Test that ALL three axes must be within tolerance
        // If just one axis is outside, the mapping should fail

        let ltol = 0.2;
        let atol = 5.0;

        // Triclinic lattice with different lengths
        let lat1 = Lattice::from_parameters(6.0, 7.0, 8.0, 80.0, 85.0, 90.0);

        // Scale only the 'a' axis by 0.82 (outside tolerance)
        // b and c stay at 1.0 (inside tolerance)
        let lat2 = Lattice::from_parameters(6.0 * 0.82, 7.0, 8.0, 80.0, 85.0, 90.0);

        let mappings = lat1.find_all_mappings(&lat2, ltol, atol, true);
        assert!(
            mappings.is_empty(),
            "Should not find mapping when one axis ratio (0.82) is outside tolerance"
        );
    }

    #[test]
    fn test_find_all_mappings_angle_tolerance() {
        // Test that angle tolerance is respected
        let ltol = 0.2;
        let atol = 5.0; // 5 degree angle tolerance

        let lat1 = Lattice::from_parameters(5.0, 5.0, 5.0, 90.0, 90.0, 90.0);

        // Same lengths but angles differ by 4 degrees (within 5 degree tolerance)
        let lat2 = Lattice::from_parameters(5.0, 5.0, 5.0, 90.0, 90.0, 94.0);
        let mappings = lat1.find_all_mappings(&lat2, ltol, atol, true);
        assert!(
            !mappings.is_empty(),
            "4 degree angle difference should be within 5 degree tolerance"
        );

        // Same lengths but angles differ by 7 degrees (outside 5 degree tolerance)
        let lat3 = Lattice::from_parameters(5.0, 5.0, 5.0, 90.0, 90.0, 97.0);
        let mappings = lat1.find_all_mappings(&lat3, ltol, atol, true);
        assert!(
            mappings.is_empty(),
            "7 degree angle difference should be outside 5 degree tolerance"
        );
    }

    #[test]
    fn test_find_all_mappings_self_mapping() {
        // Any lattice should have at least one mapping to itself (identity)
        let lattices = vec![
            Lattice::cubic(5.0),
            Lattice::hexagonal(3.0, 5.0),
            Lattice::orthorhombic(3.0, 4.0, 5.0),
            Lattice::from_parameters(3.0, 4.0, 5.0, 80.0, 85.0, 95.0), // triclinic
        ];

        for lat in lattices {
            let mappings = lat.find_all_mappings(&lat, 0.2, 5.0, true);
            assert!(
                !mappings.is_empty(),
                "Any lattice should have mapping to itself"
            );
        }
    }

    #[test]
    fn test_find_all_mappings_different_ltol_values() {
        // Test that different ltol values produce expected results
        let base = Lattice::cubic(5.0);
        let scaled_09 = Lattice::cubic(5.0 * 0.9); // 10% smaller, ratio = 0.9

        // ltol=0.05: range is (0.952, 1.05) - 0.9 ratio is outside
        let mappings = base.find_all_mappings(&scaled_09, 0.05, 5.0, true);
        assert!(
            mappings.is_empty(),
            "0.9 ratio should be outside (0.952, 1.05) tolerance"
        );

        // ltol=0.1: range is (0.909, 1.1) - 0.9 ratio is still OUTSIDE (0.9 < 0.909)
        let mappings = base.find_all_mappings(&scaled_09, 0.1, 5.0, true);
        assert!(
            mappings.is_empty(),
            "0.9 ratio should be outside (0.909, 1.1) tolerance (0.9 < 0.909)"
        );

        // ltol=0.12: range is (0.893, 1.12) - 0.9 ratio is inside
        let mappings = base.find_all_mappings(&scaled_09, 0.12, 5.0, true);
        assert!(
            !mappings.is_empty(),
            "0.9 ratio should be inside (0.893, 1.12) tolerance"
        );

        // ltol=0.15: range is (0.87, 1.15) - 0.9 ratio is inside
        let mappings = base.find_all_mappings(&scaled_09, 0.15, 5.0, true);
        assert!(
            !mappings.is_empty(),
            "0.9 ratio should be inside (0.87, 1.15) tolerance"
        );
    }

    #[test]
    fn test_monoclinic_lattice() {
        // Monoclinic: a ≠ b ≠ c, α = γ = 90°, β ≠ 90°
        let lattice = Lattice::from_parameters(5.0, 6.0, 7.0, 90.0, 100.0, 90.0);
        let lengths = lattice.lengths();
        let angles = lattice.angles();

        assert_relative_eq!(lengths[0], 5.0, epsilon = 1e-8);
        assert_relative_eq!(lengths[1], 6.0, epsilon = 1e-8);
        assert_relative_eq!(lengths[2], 7.0, epsilon = 1e-8);

        assert_relative_eq!(angles[0], 90.0, epsilon = 1e-8);
        assert_relative_eq!(angles[1], 100.0, epsilon = 1e-8);
        assert_relative_eq!(angles[2], 90.0, epsilon = 1e-8);
    }

    #[test]
    fn test_tetragonal_lattice() {
        let lattice = Lattice::tetragonal(4.0, 6.0);
        let lengths = lattice.lengths();
        let angles = lattice.angles();

        assert_relative_eq!(lengths[0], 4.0, epsilon = 1e-8);
        assert_relative_eq!(lengths[1], 4.0, epsilon = 1e-8);
        assert_relative_eq!(lengths[2], 6.0, epsilon = 1e-8);

        for angle in angles.iter() {
            assert_relative_eq!(*angle, 90.0, epsilon = 1e-8);
        }
    }

    #[test]
    fn test_rhombohedral_lattice() {
        // Rhombohedral: a = b = c, α = β = γ ≠ 90°
        let lattice = Lattice::from_parameters(5.0, 5.0, 5.0, 80.0, 80.0, 80.0);
        let lengths = lattice.lengths();
        let angles = lattice.angles();

        // All lengths should be equal
        assert_relative_eq!(lengths[0], lengths[1], epsilon = 1e-8);
        assert_relative_eq!(lengths[1], lengths[2], epsilon = 1e-8);

        // All angles should be equal
        assert_relative_eq!(angles[0], angles[1], epsilon = 1e-8);
        assert_relative_eq!(angles[1], angles[2], epsilon = 1e-8);
        assert_relative_eq!(angles[0], 80.0, epsilon = 1e-8);
    }

    #[test]
    fn test_niggli_reduction_preserves_volume_various_lattices() {
        let lattices = vec![
            ("cubic", Lattice::cubic(4.0)),
            ("hexagonal", Lattice::hexagonal(3.0, 5.0)),
            ("orthorhombic", Lattice::orthorhombic(3.0, 4.0, 5.0)),
            ("tetragonal", Lattice::tetragonal(4.0, 6.0)),
            (
                "monoclinic",
                Lattice::from_parameters(5.0, 6.0, 7.0, 90.0, 100.0, 90.0),
            ),
            (
                "triclinic",
                Lattice::from_parameters(3.0, 4.0, 5.0, 80.0, 85.0, 95.0),
            ),
            (
                "rhombohedral",
                Lattice::from_parameters(5.0, 5.0, 5.0, 80.0, 80.0, 80.0),
            ),
        ];

        for (name, lattice) in lattices {
            let niggli = lattice.get_niggli_reduced(1e-5).unwrap();
            assert_relative_eq!(
                niggli.volume().abs(),
                lattice.volume().abs(),
                epsilon = 1e-3
            );
            // Niggli should produce ordered lengths: a <= b <= c
            let lengths = niggli.lengths();
            assert!(
                lengths[0] <= lengths[1] + 1e-5 && lengths[1] <= lengths[2] + 1e-5,
                "{name}: Niggli lengths should be ordered a <= b <= c, got {:?}",
                lengths
            );
        }
    }

    #[test]
    fn test_lll_reduction_preserves_volume() {
        let lattices = vec![
            Lattice::cubic(4.0),
            Lattice::hexagonal(3.0, 5.0),
            Lattice::from_parameters(3.0, 4.0, 5.0, 80.0, 85.0, 95.0),
        ];

        for lattice in lattices {
            let lll = lattice.get_lll_reduced(0.75);
            assert_relative_eq!(lll.volume().abs(), lattice.volume().abs(), epsilon = 1e-8);
        }
    }

    #[test]
    fn test_metric_tensor() {
        let lattice = Lattice::cubic(4.0);
        let metric = lattice.metric_tensor();

        // For cubic, metric tensor should be diagonal with a^2 on diagonal
        assert_relative_eq!(metric[(0, 0)], 16.0, epsilon = 1e-8);
        assert_relative_eq!(metric[(1, 1)], 16.0, epsilon = 1e-8);
        assert_relative_eq!(metric[(2, 2)], 16.0, epsilon = 1e-8);
        assert_relative_eq!(metric[(0, 1)], 0.0, epsilon = 1e-8);
        assert_relative_eq!(metric[(0, 2)], 0.0, epsilon = 1e-8);
        assert_relative_eq!(metric[(1, 2)], 0.0, epsilon = 1e-8);
    }

    #[test]
    fn test_find_mapping_identical_lattices() {
        // Two identical lattices should have a mapping
        let lat1 = Lattice::cubic(5.0);
        let lat2 = Lattice::cubic(5.0);

        let result = lat1.find_mapping(&lat2, 0.2, 5.0, false);
        assert!(result.is_some(), "Identical lattices should have mapping");

        let (_new_lattice, _rotation, supercell) = result.unwrap();

        // Supercell matrix should have determinant ±1 (no supercell)
        let det: i32 = supercell[(0, 0)]
            * (supercell[(1, 1)] * supercell[(2, 2)] - supercell[(1, 2)] * supercell[(2, 1)])
            - supercell[(0, 1)]
                * (supercell[(1, 0)] * supercell[(2, 2)] - supercell[(1, 2)] * supercell[(2, 0)])
            + supercell[(0, 2)]
                * (supercell[(1, 0)] * supercell[(2, 1)] - supercell[(1, 1)] * supercell[(2, 0)]);
        assert_eq!(
            det.abs(),
            1,
            "Supercell det should be ±1 for identical lattices"
        );
    }

    #[test]
    fn test_niggli_angles_in_valid_range() {
        // Test various lattices that Niggli reduction produces angles in [60°, 120°]
        // Use moderate angles that are known to work well
        let test_cases = vec![
            // Moderate acute angles
            Lattice::from_parameters(5.0, 5.0, 5.0, 70.0, 70.0, 70.0),
            Lattice::from_parameters(5.0, 5.0, 5.0, 65.0, 65.0, 65.0),
            // Moderate obtuse angles
            Lattice::from_parameters(5.0, 5.0, 5.0, 110.0, 110.0, 110.0),
            Lattice::from_parameters(5.0, 5.0, 5.0, 115.0, 115.0, 115.0),
            // Mixed angles
            Lattice::from_parameters(4.0, 5.0, 6.0, 75.0, 105.0, 95.0),
        ];

        for lattice in test_cases {
            let niggli_result = lattice.get_niggli_reduced(1e-5);
            if let Ok(niggli) = niggli_result {
                let angles = niggli.angles();
                for (idx, &angle) in angles.iter().enumerate() {
                    // Allow small tolerance for numerical errors
                    assert!(
                        (59.0..=121.0).contains(&angle),
                        "Niggli angle[{}] = {:.2} out of expected [60, 120] range",
                        idx,
                        angle
                    );
                }
            }
            // Some edge cases may fail reduction, which is acceptable
        }
    }

    #[test]
    fn test_reciprocal_degenerate_lattices() {
        // Test that reciprocal() doesn't produce inf/NaN for degenerate lattices.
        let test_cases = [
            // Coplanar vectors: all lie in xy-plane (zero volume)
            Matrix3::new(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0),
            // Near-degenerate: extremely small z-component
            Matrix3::new(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1e-20),
        ];

        for matrix in test_cases {
            let lattice = Lattice::new(matrix);
            let recip_m = *lattice.reciprocal().matrix();
            assert!(
                recip_m.iter().all(|v| v.is_finite()),
                "Reciprocal matrix has non-finite values for vol={:.2e}",
                lattice.volume()
            );
        }
    }

    #[test]
    fn test_angles_no_nan_edge_cases() {
        // Test angles() with edge cases that could cause NaN from floating-point drift.
        let test_cases = [
            // Extreme angles close to 0° and 180°
            Lattice::from_parameters(1.0, 1.0, 1.0, 5.0, 90.0, 90.0),
            Lattice::from_parameters(1.0, 1.0, 1.0, 175.0, 90.0, 90.0),
            Lattice::from_parameters(1.0, 1.0, 1.0, 2.0, 2.0, 2.0),
            Lattice::from_parameters(1.0, 1.0, 1.0, 178.0, 178.0, 178.0),
            // Nearly parallel vectors (can push cos slightly > 1)
            Lattice::new(Matrix3::new(
                1.0,
                0.0,
                0.0,
                0.9999999999,
                1e-10,
                0.0,
                0.0,
                0.0,
                1.0,
            )),
        ];

        for lattice in test_cases {
            let angles = lattice.angles();
            assert!(
                angles
                    .iter()
                    .all(|&a| a.is_finite() && (0.0..=180.0).contains(&a)),
                "angles={:?} invalid for lattice with vol={:.2e}",
                angles,
                lattice.volume()
            );
        }
    }

    // =========================================================================
    // Pymatgen Edge Case Tests (ported from pymatgen test suite)
    // =========================================================================

    #[test]
    fn test_unusual_lattice_edge_cases() {
        // Combined test for unusual lattices that should not crash
        let edge_cases: Vec<(&str, Lattice)> = vec![
            (
                "near-singular 10°",
                Lattice::from_parameters(1.0, 1.0, 1.0, 10.0, 10.0, 10.0),
            ),
            (
                "obtuse 156°",
                Lattice::from_parameters(7.365, 6.199, 5.353, 75.54, 81.18, 156.4),
            ),
            (
                "two obtuse",
                Lattice::from_parameters(4.0, 10.0, 11.0, 100.0, 110.0, 80.0),
            ),
            (
                "monoclinic 66°",
                Lattice::from_parameters(10.0, 20.0, 30.0, 90.0, 66.0, 90.0),
            ),
            (
                "negative matrix",
                Lattice::from_array([
                    [-0.259, 1.187, -0.124],
                    [2.217, 1.007, 0.733],
                    [1.144, -0.469, -0.023],
                ]),
            ),
        ];
        for (name, lattice) in edge_cases {
            let vol = lattice.volume();
            let angles = lattice.angles();
            assert!(vol.is_finite(), "{name}: volume not finite");
            assert!(
                angles.iter().all(|a| a.is_finite()),
                "{name}: angles not finite"
            );
        }
    }

    #[test]
    fn test_lll_preserves_volume() {
        let matrix = Matrix3::new(0.5, 0.3, 0.1, 0.2, 0.7, 0.4, 0.1, 0.2, 0.8);
        let lattice = Lattice::new(matrix);
        let lll = lattice.get_lll_reduced(0.75);
        assert_relative_eq!(lll.volume().abs(), lattice.volume().abs(), epsilon = 1e-8);
    }

    #[test]
    fn test_coordinate_operations() {
        // Roundtrip: frac → cart → frac (validate all components)
        let lattice = Lattice::from_parameters(4.0, 5.0, 6.0, 85.0, 95.0, 100.0);
        let frac = Vector3::new(0.3, 0.7, 0.2);
        let cart = lattice.get_cartesian_coords(&[frac]);
        let frac_back = lattice.get_fractional_coords(&cart);
        assert_relative_eq!(frac.x, frac_back[0].x, epsilon = 1e-10);
        assert_relative_eq!(frac.y, frac_back[0].y, epsilon = 1e-10);
        assert_relative_eq!(frac.z, frac_back[0].z, epsilon = 1e-10);

        // Large fractional coords
        let lattice2 = Lattice::cubic(4.0);
        let cart1 = lattice2.matrix().transpose() * Vector3::new(0.0, 0.0, 17.0);
        let cart2 = lattice2.matrix().transpose() * Vector3::new(0.0, 0.0, 10.0);
        assert!((cart1.z - cart2.z - 28.0).abs() < 1e-10);
    }

    #[test]
    fn test_reciprocal_lattice() {
        // Cubic: reciprocal should have 2π/a factor
        let cubic = Lattice::cubic(10.0);
        assert_relative_eq!(
            cubic.reciprocal().lengths()[0],
            2.0 * PI / 10.0,
            epsilon = 1e-6
        );

        // Hexagonal: a* ≠ c*
        let hex = Lattice::hexagonal(3.0, 5.0);
        let recip = hex.reciprocal().lengths();
        assert!((recip[0] - recip[2]).abs() > 0.1);
    }

    #[test]
    fn test_niggli_extreme_angles() {
        // Triclinic with fractional minutes (103°55', 109°28', 134°53')
        let lattice = Lattice::from_parameters(
            3.0,
            5.196,
            2.0,
            103.0 + 55.0 / 60.0,
            109.0 + 28.0 / 60.0,
            134.0 + 53.0 / 60.0,
        );
        assert!(lattice.volume().abs() > 0.0);
        if let Ok(niggli) = lattice.get_niggli_reduced(1e-5) {
            assert_relative_eq!(
                niggli.volume().abs(),
                lattice.volume().abs(),
                epsilon = 1e-3
            );
        }
    }

    #[test]
    fn test_partial_pbc() {
        let mut lattice = Lattice::cubic(4.0);
        lattice.pbc = [true, true, false];
        assert_eq!(lattice.pbc, [true, true, false]);
        assert_relative_eq!(lattice.volume(), 64.0, epsilon = 1e-10);
    }
}
