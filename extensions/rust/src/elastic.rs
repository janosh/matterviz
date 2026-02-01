//! Elastic tensor analysis for crystalline materials.
//!
//! This module provides functions for computing and analyzing elastic properties
//! from stress-strain relationships, including:
//! - Strain generation for elastic tensor calculation
//! - Voigt notation conversion
//! - Elastic moduli (bulk, shear, Young's)
//! - Mechanical stability checks
//!
//! # Example
//!
//! ```rust,ignore
//! use ferrox::elastic::{generate_strains, elastic_tensor_from_stresses, bulk_modulus};
//!
//! let strains = generate_strains(0.01, true);
//! let stresses = compute_stresses(&strains); // User provides this
//! let C = elastic_tensor_from_stresses(&strains, &stresses);
//! let K = bulk_modulus(&C);
//! ```

use nalgebra::{Matrix3, Matrix6};

/// Generate strain matrices for elastic tensor calculation.
///
/// Generates 6 strain types: 3 normal (xx, yy, zz) and optionally 3 shear (yz, xz, xy).
/// Each strain is applied in both positive and negative directions for better accuracy.
///
/// # Arguments
///
/// * `magnitude` - Strain magnitude (typical: 0.005 to 0.01)
/// * `shear` - Whether to include shear strains
///
/// # Returns
///
/// Vector of strain matrices. If `shear` is true, returns 12 matrices (6 types × 2 signs),
/// otherwise returns 6 matrices (3 types × 2 signs).
pub fn generate_strains(magnitude: f64, shear: bool) -> Vec<Matrix3<f64>> {
    let mut strains = Vec::new();

    // Normal strains: xx, yy, zz
    for axis in 0..3 {
        for sign in &[-1.0, 1.0] {
            let mut strain = Matrix3::zeros();
            strain[(axis, axis)] = sign * magnitude;
            strains.push(strain);
        }
    }

    // Shear strains: yz, xz, xy (symmetric: strain_ij = strain_ji)
    if shear {
        let shear_pairs = [(1, 2), (0, 2), (0, 1)]; // yz, xz, xy
        for (idx, jdx) in &shear_pairs {
            for sign in &[-1.0, 1.0] {
                let mut strain = Matrix3::zeros();
                // Engineering shear strain: gamma = 2 * epsilon_ij
                // So epsilon_ij = magnitude / 2 for each off-diagonal
                strain[(*idx, *jdx)] = sign * magnitude / 2.0;
                strain[(*jdx, *idx)] = sign * magnitude / 2.0;
                strains.push(strain);
            }
        }
    }

    strains
}

/// Apply strain to a cell matrix.
///
/// Returns the deformed cell: cell_new = cell * (I + strain)
///
/// Uses right-multiplication because rows are lattice vectors (row-vector convention).
///
/// # Arguments
///
/// * `cell` - Original cell matrix (rows are lattice vectors)
/// * `strain` - Strain tensor
pub fn apply_strain(cell: &Matrix3<f64>, strain: &Matrix3<f64>) -> Matrix3<f64> {
    cell * (Matrix3::identity() + strain)
}

/// Convert symmetric 3x3 stress/strain tensor to Voigt notation.
///
/// Voigt ordering: [xx, yy, zz, yz, xz, xy]
///
/// For stress: sigma_voigt = [sigma_xx, sigma_yy, sigma_zz, sigma_yz, sigma_xz, sigma_xy]
/// For strain: epsilon_voigt = [e_xx, e_yy, e_zz, 2*e_yz, 2*e_xz, 2*e_xy]
///
/// # Arguments
///
/// * `tensor` - 3x3 symmetric tensor
/// * `is_strain` - If true, multiply off-diagonal by 2 (engineering strain convention)
pub fn tensor_to_voigt(tensor: &Matrix3<f64>, is_strain: bool) -> [f64; 6] {
    let factor = if is_strain { 2.0 } else { 1.0 };
    [
        tensor[(0, 0)],          // xx
        tensor[(1, 1)],          // yy
        tensor[(2, 2)],          // zz
        factor * tensor[(1, 2)], // yz
        factor * tensor[(0, 2)], // xz
        factor * tensor[(0, 1)], // xy
    ]
}

/// Convert stress tensor to Voigt notation.
pub fn stress_to_voigt(stress: &Matrix3<f64>) -> [f64; 6] {
    tensor_to_voigt(stress, false)
}

/// Convert strain tensor to Voigt notation (engineering strain convention).
pub fn strain_to_voigt(strain: &Matrix3<f64>) -> [f64; 6] {
    tensor_to_voigt(strain, true)
}

/// Convert Voigt notation back to 3x3 tensor.
///
/// # Arguments
///
/// * `voigt` - 6-element Voigt vector
/// * `is_strain` - If true, divide off-diagonal by 2 (reverse engineering strain convention)
pub fn voigt_to_tensor(voigt: &[f64; 6], is_strain: bool) -> Matrix3<f64> {
    let factor = if is_strain { 0.5 } else { 1.0 };
    Matrix3::new(
        voigt[0],
        factor * voigt[5],
        factor * voigt[4],
        factor * voigt[5],
        voigt[1],
        factor * voigt[3],
        factor * voigt[4],
        factor * voigt[3],
        voigt[2],
    )
}

/// Compute elastic tensor from stress-strain data.
///
/// Uses linear regression to fit C_ij from the relationship:
/// stress_i = sum_j C_ij * strain_j
///
/// # Arguments
///
/// * `strains` - Vector of applied strain matrices
/// * `stresses` - Vector of resulting stress matrices (same length as strains)
///
/// # Returns
///
/// 6x6 elastic tensor in Voigt notation (GPa if stresses are in GPa).
///
/// # Note
///
/// If the strain data is insufficient or singular (e.g., only normal strains
/// without shear), some rows of the elastic tensor may be zeros. Use
/// `try_elastic_tensor_from_stresses` to detect this condition.
pub fn elastic_tensor_from_stresses(
    strains: &[Matrix3<f64>],
    stresses: &[Matrix3<f64>],
) -> [[f64; 6]; 6] {
    try_elastic_tensor_from_stresses(strains, stresses).0
}

/// Compute elastic tensor from stress-strain data, reporting fit quality.
///
/// Like `elastic_tensor_from_stresses`, but returns additional information
/// about the fit quality.
///
/// # Returns
///
/// A tuple of (elastic_tensor, n_singular) where:
/// - `elastic_tensor`: 6x6 elastic tensor in Voigt notation
/// - `n_singular`: Number of stress components that could not be fit due to
///   singular or under-determined strain data. If > 0, some rows of the tensor
///   will be zeros.
pub fn try_elastic_tensor_from_stresses(
    strains: &[Matrix3<f64>],
    stresses: &[Matrix3<f64>],
) -> ([[f64; 6]; 6], usize) {
    assert_eq!(
        strains.len(),
        stresses.len(),
        "Strains and stresses must have same length"
    );

    let n_samples = strains.len();
    if n_samples == 0 {
        return ([[0.0; 6]; 6], 6);
    }

    // Convert to Voigt notation
    let strain_voigt: Vec<[f64; 6]> = strains.iter().map(strain_to_voigt).collect();
    let stress_voigt: Vec<[f64; 6]> = stresses.iter().map(stress_to_voigt).collect();

    // Build design matrix X (n_samples x 6)
    // Solve: stress = X * C^T, via SVD pseudoinverse
    use nalgebra::{DMatrix, SVD};

    let x_mat = DMatrix::from_fn(n_samples, 6, |row, col| strain_voigt[row][col]);

    // Compute SVD of X and solve via pseudoinverse
    // Use eps = 1e-10 to filter out near-zero singular values
    let svd = SVD::new(x_mat, true, true);
    let eps = 1e-10;

    // Count rank deficiency from singular values
    let singular_values = &svd.singular_values;
    let max_sv = singular_values.iter().cloned().fold(0.0_f64, f64::max);
    let threshold = eps * max_sv;
    let rank = singular_values.iter().filter(|&&sv| sv > threshold).count();
    let n_singular = 6 - rank.min(6);

    let mut c_matrix = [[0.0; 6]; 6];

    // Solve X * C_T = B for each stress component column
    // C_T has shape 6 x 6, we solve column by column
    for stress_idx in 0..6 {
        let b_col = DMatrix::from_fn(n_samples, 1, |row, _| stress_voigt[row][stress_idx]);

        if let Ok(solution) = svd.solve(&b_col, eps) {
            for strain_idx in 0..6 {
                c_matrix[stress_idx][strain_idx] = solution[(strain_idx, 0)];
            }
        }
        // If solve returns Err, row remains zeros (handled by init)
    }

    (c_matrix, n_singular)
}

/// Compute Voigt bulk modulus from elastic tensor.
///
/// K_V = (C11 + C22 + C33 + 2*(C12 + C13 + C23)) / 9
pub fn voigt_bulk_modulus(c: &[[f64; 6]; 6]) -> f64 {
    (c[0][0] + c[1][1] + c[2][2] + 2.0 * (c[0][1] + c[0][2] + c[1][2])) / 9.0
}

/// Compute Reuss bulk modulus from elastic tensor.
///
/// K_R = 1 / (S11 + S22 + S33 + 2*(S12 + S13 + S23))
/// where S = C^{-1} is the compliance tensor
pub fn reuss_bulk_modulus(c: &[[f64; 6]; 6]) -> f64 {
    let c_mat = Matrix6::from_fn(|idx, jdx| c[idx][jdx]);
    if let Some(s_mat) = c_mat.try_inverse() {
        let s: [[f64; 6]; 6] =
            std::array::from_fn(|idx| std::array::from_fn(|jdx| s_mat[(idx, jdx)]));
        let denom = s[0][0] + s[1][1] + s[2][2] + 2.0 * (s[0][1] + s[0][2] + s[1][2]);
        if denom.abs() > 1e-10 {
            return 1.0 / denom;
        }
    }
    0.0
}

/// Compute Voigt-Reuss-Hill bulk modulus (average of Voigt and Reuss bounds).
pub fn bulk_modulus(c: &[[f64; 6]; 6]) -> f64 {
    0.5 * (voigt_bulk_modulus(c) + reuss_bulk_modulus(c))
}

/// Compute Voigt shear modulus from elastic tensor.
///
/// G_V = (C11 + C22 + C33 - C12 - C13 - C23 + 3*(C44 + C55 + C66)) / 15
pub fn voigt_shear_modulus(c: &[[f64; 6]; 6]) -> f64 {
    let normal_contrib = c[0][0] + c[1][1] + c[2][2] - c[0][1] - c[0][2] - c[1][2];
    let shear_contrib = c[3][3] + c[4][4] + c[5][5];
    (normal_contrib + 3.0 * shear_contrib) / 15.0
}

/// Compute Reuss shear modulus from elastic tensor.
///
/// G_R = 15 / (4*(S11 + S22 + S33) - 4*(S12 + S13 + S23) + 3*(S44 + S55 + S66))
pub fn reuss_shear_modulus(c: &[[f64; 6]; 6]) -> f64 {
    let c_mat = Matrix6::from_fn(|idx, jdx| c[idx][jdx]);
    if let Some(s_mat) = c_mat.try_inverse() {
        let s: [[f64; 6]; 6] =
            std::array::from_fn(|idx| std::array::from_fn(|jdx| s_mat[(idx, jdx)]));
        let normal_contrib = s[0][0] + s[1][1] + s[2][2] - s[0][1] - s[0][2] - s[1][2];
        let shear_contrib = s[3][3] + s[4][4] + s[5][5];
        let denom = 4.0 * normal_contrib + 3.0 * shear_contrib;
        if denom.abs() > 1e-10 {
            return 15.0 / denom;
        }
    }
    0.0
}

/// Compute Voigt-Reuss-Hill shear modulus (average of Voigt and Reuss bounds).
pub fn shear_modulus(c: &[[f64; 6]; 6]) -> f64 {
    0.5 * (voigt_shear_modulus(c) + reuss_shear_modulus(c))
}

/// Compute Young's modulus from bulk and shear moduli.
///
/// E = 9KG / (3K + G)
pub fn youngs_modulus(k: f64, g: f64) -> f64 {
    let denom = 3.0 * k + g;
    if denom.abs() > 1e-10 {
        9.0 * k * g / denom
    } else {
        0.0
    }
}

/// Compute Poisson's ratio from bulk and shear moduli.
///
/// nu = (3K - 2G) / (6K + 2G)
pub fn poisson_ratio(k: f64, g: f64) -> f64 {
    let denom = 6.0 * k + 2.0 * g;
    if denom.abs() > 1e-10 {
        (3.0 * k - 2.0 * g) / denom
    } else {
        0.0
    }
}

/// Check if elastic tensor satisfies mechanical stability (Born stability criteria).
///
/// For a general crystal, the elastic tensor must be positive definite.
/// This function checks if all eigenvalues of C are positive.
pub fn is_mechanically_stable(c: &[[f64; 6]; 6]) -> bool {
    let c_mat = Matrix6::from_fn(|idx, jdx| c[idx][jdx]);

    // Check positive definiteness via Cholesky decomposition
    // If Cholesky succeeds, matrix is positive definite
    c_mat.cholesky().is_some()
}

/// Check mechanical stability for cubic crystals (simplified criteria).
///
/// For cubic symmetry:
/// - C11 > |C12|
/// - C11 + 2*C12 > 0
/// - C44 > 0
pub fn is_cubic_stable(c11: f64, c12: f64, c44: f64) -> bool {
    c11 > c12.abs() && (c11 + 2.0 * c12) > 0.0 && c44 > 0.0
}

/// Compute elastic anisotropy (Zener ratio) for cubic crystals.
///
/// A = 2 * C44 / (C11 - C12)
/// A = 1 for isotropic materials
pub fn zener_ratio(c11: f64, c12: f64, c44: f64) -> f64 {
    let denom = c11 - c12;
    if denom.abs() > 1e-10 {
        2.0 * c44 / denom
    } else {
        f64::INFINITY
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper to build cubic elastic tensor from C11, C12, C44
    fn make_cubic_tensor(c11: f64, c12: f64, c44: f64) -> [[f64; 6]; 6] {
        let mut tensor = [[0.0; 6]; 6];
        tensor[0][0] = c11;
        tensor[1][1] = c11;
        tensor[2][2] = c11;
        tensor[0][1] = c12;
        tensor[0][2] = c12;
        tensor[1][2] = c12;
        tensor[1][0] = c12;
        tensor[2][0] = c12;
        tensor[2][1] = c12;
        tensor[3][3] = c44;
        tensor[4][4] = c44;
        tensor[5][5] = c44;
        tensor
    }

    #[test]
    fn test_generate_strains_normal_only() {
        let strains = generate_strains(0.01, false);
        assert_eq!(strains.len(), 6); // 3 normal strains × 2 signs

        // Check first strain is xx compression
        assert!((strains[0][(0, 0)] - (-0.01)).abs() < 1e-10);
        assert!(strains[0][(1, 1)].abs() < 1e-10);
    }

    #[test]
    fn test_generate_strains_with_shear() {
        let strains = generate_strains(0.01, true);
        assert_eq!(strains.len(), 12); // 6 strain types × 2 signs
    }

    #[test]
    fn test_voigt_conversion() {
        let stress = Matrix3::new(100.0, 10.0, 20.0, 10.0, 200.0, 30.0, 20.0, 30.0, 300.0);

        let voigt = stress_to_voigt(&stress);
        assert!((voigt[0] - 100.0).abs() < 1e-10); // xx
        assert!((voigt[1] - 200.0).abs() < 1e-10); // yy
        assert!((voigt[2] - 300.0).abs() < 1e-10); // zz
        assert!((voigt[3] - 30.0).abs() < 1e-10); // yz
        assert!((voigt[4] - 20.0).abs() < 1e-10); // xz
        assert!((voigt[5] - 10.0).abs() < 1e-10); // xy
    }

    #[test]
    fn test_isotropic_material() {
        // For isotropic material: C44 = (C11 - C12) / 2
        let c11 = 200.0;
        let c12 = 100.0;
        let c44 = 50.0;

        let tensor = make_cubic_tensor(c11, c12, c44);
        let bulk = bulk_modulus(&tensor);
        let shear = shear_modulus(&tensor);

        // For isotropic: K = (C11 + 2*C12) / 3 = (200 + 200) / 3 = 133.33, G = C44 = 50
        assert!(
            (bulk - 133.333).abs() < 1.0,
            "Bulk modulus {bulk} should be ~133.33"
        );
        assert!(
            (shear - 50.0).abs() < 1.0,
            "Shear modulus {shear} should be ~50"
        );
        assert!(
            (zener_ratio(c11, c12, c44) - 1.0).abs() < 0.01,
            "Zener ratio should be 1.0"
        );
    }

    #[test]
    fn test_youngs_modulus() {
        let bulk = 100.0;
        let shear = 50.0;
        let youngs = youngs_modulus(bulk, shear);

        // E = 9KG / (3K + G) = 9 * 100 * 50 / (300 + 50) = 45000 / 350 ≈ 128.57
        assert!((youngs - 128.57).abs() < 0.1);
    }

    #[test]
    fn test_poisson_ratio() {
        let bulk = 100.0;
        let shear = 50.0;
        let nu = poisson_ratio(bulk, shear);

        // nu = (3K - 2G) / (6K + 2G) = (300 - 100) / (600 + 100) = 200 / 700 ≈ 0.286
        assert!((nu - 0.286).abs() < 0.01);
    }

    #[test]
    fn test_mechanical_stability() {
        let tensor = make_cubic_tensor(200.0, 80.0, 60.0);
        assert!(is_mechanically_stable(&tensor), "Should be stable");
    }

    #[test]
    fn test_cubic_stability() {
        // Stable cubic crystal
        assert!(is_cubic_stable(200.0, 80.0, 60.0));

        // Unstable: C12 > C11
        assert!(!is_cubic_stable(80.0, 200.0, 60.0));

        // Unstable: negative C44
        assert!(!is_cubic_stable(200.0, 80.0, -10.0));
    }

    #[test]
    fn test_apply_strain() {
        let cell = Matrix3::identity() * 5.0;
        let strain = Matrix3::new(0.01, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);

        let deformed = apply_strain(&cell, &strain);

        // x direction should be 5 * 1.01 = 5.05
        assert!((deformed[(0, 0)] - 5.05).abs() < 1e-10);
        assert!((deformed[(1, 1)] - 5.0).abs() < 1e-10);
        assert!((deformed[(2, 2)] - 5.0).abs() < 1e-10);
    }

    // === Voigt notation roundtrip tests ===

    #[test]
    fn test_voigt_roundtrip() {
        // Test roundtrip for multiple symmetric tensors (stress convention)
        let stress_cases = [
            Matrix3::new(1.0, 2.0, 3.0, 2.0, 4.0, 5.0, 3.0, 5.0, 6.0),
            Matrix3::new(150.0, 25.0, 35.0, 25.0, 180.0, 45.0, 35.0, 45.0, 200.0),
            Matrix3::new(100.0, -10.0, 20.0, -10.0, 200.0, -30.0, 20.0, -30.0, 150.0),
            Matrix3::zeros(),
        ];
        for original in &stress_cases {
            let voigt = stress_to_voigt(original);
            let recovered = voigt_to_tensor(&voigt, false);
            for idx in 0..3 {
                for jdx in 0..3 {
                    assert!(
                        (original[(idx, jdx)] - recovered[(idx, jdx)]).abs() < 1e-10,
                        "Stress roundtrip mismatch"
                    );
                }
            }
        }

        // Test strain roundtrip (off-diagonal x2 convention)
        let strain = Matrix3::new(0.01, 0.002, 0.003, 0.002, 0.015, 0.004, 0.003, 0.004, 0.02);
        let voigt = strain_to_voigt(&strain);
        let recovered = voigt_to_tensor(&voigt, true);
        for idx in 0..3 {
            for jdx in 0..3 {
                assert!(
                    (strain[(idx, jdx)] - recovered[(idx, jdx)]).abs() < 1e-10,
                    "Strain roundtrip mismatch"
                );
            }
        }
    }

    // === Known materials tests (literature values) ===

    #[test]
    fn test_copper_elastic_constants() {
        // Cu elastic constants from literature (GPa), source: Simmons & Wang
        let (c11, c12, c44) = (168.4, 121.4, 75.4);
        let tensor = make_cubic_tensor(c11, c12, c44);

        let bulk = bulk_modulus(&tensor);
        let shear = shear_modulus(&tensor);
        let youngs = youngs_modulus(bulk, shear);

        assert!(
            (bulk - 137.0).abs() < 2.0,
            "Cu bulk ~137 GPa, got {bulk:.2}"
        );
        assert!(
            (shear - 48.0).abs() < 3.0,
            "Cu shear ~48 GPa, got {shear:.2}"
        );
        assert!(
            (youngs - 130.0).abs() < 5.0,
            "Cu Young's ~130 GPa, got {youngs:.2}"
        );
        assert!(
            is_mechanically_stable(&tensor),
            "Cu should be mechanically stable"
        );
        assert!(
            is_cubic_stable(c11, c12, c44),
            "Cu should satisfy cubic stability"
        );
    }

    #[test]
    fn test_iron_elastic_constants() {
        // Fe (BCC) elastic constants from literature (GPa)
        let (c11, c12, c44) = (230.0, 134.0, 117.0);
        let tensor = make_cubic_tensor(c11, c12, c44);

        let bulk = bulk_modulus(&tensor);
        let shear = shear_modulus(&tensor);

        assert!(
            (bulk - 166.0).abs() < 3.0,
            "Fe bulk ~166 GPa, got {bulk:.2}"
        );
        assert!(
            (shear - 82.0).abs() < 5.0,
            "Fe shear ~82 GPa, got {shear:.2}"
        );
        assert!(
            is_mechanically_stable(&tensor),
            "Fe should be mechanically stable"
        );
        assert!(
            is_cubic_stable(c11, c12, c44),
            "Fe should satisfy cubic stability"
        );

        // Zener ratio (anisotropy)
        let a_fe = zener_ratio(c11, c12, c44);
        assert!(
            (a_fe - 2.44).abs() < 0.1,
            "Fe Zener ratio {a_fe:.2} should be ~2.44"
        );
    }

    #[test]
    fn test_silicon_elastic_constants() {
        // Si elastic constants from literature (GPa)
        let (c11, c12, c44) = (166.0, 64.0, 80.0);
        let tensor = make_cubic_tensor(c11, c12, c44);

        let bulk = bulk_modulus(&tensor);
        let shear = shear_modulus(&tensor);

        assert!((bulk - 98.0).abs() < 2.0, "Si bulk ~98 GPa, got {bulk:.2}");
        assert!(
            (shear - 66.0).abs() < 3.0,
            "Si shear ~66 GPa, got {shear:.2}"
        );
        assert!(
            is_mechanically_stable(&tensor),
            "Si should be mechanically stable"
        );
    }

    #[test]
    fn test_isotropy_condition() {
        // For isotropic material: C44 = (C11 - C12) / 2
        let test_cases = [(200.0, 100.0), (300.0, 150.0), (150.0, 50.0)];

        for (c11, c12) in test_cases {
            let c44 = (c11 - c12) / 2.0;
            let tensor = make_cubic_tensor(c11, c12, c44);

            // Zener ratio should be exactly 1.0 for isotropic materials
            assert!(
                (zener_ratio(c11, c12, c44) - 1.0).abs() < 1e-10,
                "Isotropic material should have Zener ratio = 1.0"
            );

            // Voigt and Reuss bounds should be equal for isotropic
            let bulk_voigt = voigt_bulk_modulus(&tensor);
            let bulk_reuss = reuss_bulk_modulus(&tensor);
            let shear_voigt = voigt_shear_modulus(&tensor);
            let shear_reuss = reuss_shear_modulus(&tensor);

            assert!(
                (bulk_voigt - bulk_reuss).abs() < 0.01,
                "Bulk Voigt {bulk_voigt:.4} should equal Reuss {bulk_reuss:.4}"
            );
            assert!(
                (shear_voigt - shear_reuss).abs() < 0.01,
                "Shear Voigt {shear_voigt:.4} should equal Reuss {shear_reuss:.4}"
            );
        }
    }

    #[test]
    fn test_non_isotropic_zener_ratio() {
        // Anisotropic material should have Zener ratio != 1
        let c11 = 200.0;
        let c12 = 100.0;
        let c44 = 80.0; // Not equal to (C11-C12)/2 = 50

        let zener = zener_ratio(c11, c12, c44);
        assert!(
            (zener - 1.6).abs() < 0.01,
            "Anisotropic material should have Zener ratio = 1.6, got {zener}"
        );
    }

    // === Singular tensor handling tests ===

    #[test]
    fn test_singular_tensor_reuss_moduli() {
        // Zero tensor (singular, non-invertible)
        let c_zero = [[0.0; 6]; 6];

        // Should return 0 gracefully, not panic
        let k_r = reuss_bulk_modulus(&c_zero);
        let g_r = reuss_shear_modulus(&c_zero);

        assert!(
            (k_r - 0.0).abs() < 1e-10,
            "Reuss K should be 0 for singular tensor"
        );
        assert!(
            (g_r - 0.0).abs() < 1e-10,
            "Reuss G should be 0 for singular tensor"
        );
    }

    #[test]
    fn test_near_singular_tensor() {
        // Nearly singular tensor (very small values)
        let mut c = [[0.0; 6]; 6];
        c[0][0] = 1e-15;
        c[1][1] = 1e-15;
        c[2][2] = 1e-15;
        c[3][3] = 1e-15;
        c[4][4] = 1e-15;
        c[5][5] = 1e-15;

        // Should handle gracefully
        let k_v = voigt_bulk_modulus(&c);
        let k_r = reuss_bulk_modulus(&c);
        let k = bulk_modulus(&c);

        // Just check it doesn't panic and returns finite values
        assert!(k_v.is_finite(), "Voigt K should be finite");
        assert!(k_r.is_finite(), "Reuss K should be finite");
        assert!(k.is_finite(), "VRH K should be finite");
    }

    #[test]
    fn test_non_positive_definite_stability() {
        // Create non-positive definite tensor (should be unstable)
        let mut c = [[0.0; 6]; 6];
        c[0][0] = 100.0;
        c[1][1] = 100.0;
        c[2][2] = 100.0;
        // Large off-diagonal makes it non-positive definite
        c[0][1] = 150.0;
        c[1][0] = 150.0;
        c[0][2] = 150.0;
        c[2][0] = 150.0;
        c[1][2] = 150.0;
        c[2][1] = 150.0;
        c[3][3] = 10.0;
        c[4][4] = 10.0;
        c[5][5] = 10.0;

        assert!(
            !is_mechanically_stable(&c),
            "Non-positive definite tensor should be unstable"
        );
    }

    #[test]
    fn test_elastic_tensor_from_empty_data() {
        // Empty strain/stress vectors should return zero tensor
        let strains: Vec<Matrix3<f64>> = Vec::new();
        let stresses: Vec<Matrix3<f64>> = Vec::new();

        let c = elastic_tensor_from_stresses(&strains, &stresses);

        for row in &c {
            for &val in row {
                assert!(
                    val.abs() < 1e-10,
                    "Empty data should give zero elastic tensor"
                );
            }
        }
    }

    #[test]
    fn test_try_elastic_tensor_reports_singular() {
        // Empty data should report all 6 components as singular
        let (c, n_singular) = try_elastic_tensor_from_stresses(&[], &[]);
        assert_eq!(
            n_singular, 6,
            "Empty data should have 6 singular components"
        );
        for row in &c {
            for &val in row {
                assert!(val.abs() < 1e-10);
            }
        }

        // Normal strains only (no shear) - use isotropic response: σ = λ*tr(ε)*I + 2μ*ε
        let strains = generate_strains(0.01, false); // Only normal strains
        let lambda = 100.0;
        let mu = 50.0;
        let stresses: Vec<Matrix3<f64>> = strains
            .iter()
            .map(|strain| {
                let trace = strain[(0, 0)] + strain[(1, 1)] + strain[(2, 2)];
                Matrix3::identity() * lambda * trace + strain * 2.0 * mu
            })
            .collect();
        let (_, n_singular) = try_elastic_tensor_from_stresses(&strains, &stresses);
        // With only normal strains, rank is 3 (xx, yy, zz), so n_singular = 3 (shear)
        assert_eq!(
            n_singular, 3,
            "Normal strains only should have 3 singular components (shear directions)"
        );
    }

    // === Strain generation verification tests ===

    #[test]
    fn test_strain_symmetry() {
        // All generated strain matrices should be symmetric
        let strains = generate_strains(0.01, true);

        for (idx, strain) in strains.iter().enumerate() {
            for i in 0..3 {
                for j in 0..3 {
                    assert!(
                        (strain[(i, j)] - strain[(j, i)]).abs() < 1e-15,
                        "Strain {idx} not symmetric: [{i},{j}]={}, [{j},{i}]={}",
                        strain[(i, j)],
                        strain[(j, i)]
                    );
                }
            }
        }
    }

    #[test]
    fn test_strain_magnitudes() {
        let magnitude = 0.01;
        let strains = generate_strains(magnitude, true);

        // Normal strains (first 6): diagonal elements should be ±magnitude
        for strain in &strains[..6] {
            let diag_sum: f64 = (0..3).map(|i| strain[(i, i)].abs()).sum();
            assert!(
                (diag_sum - magnitude).abs() < 1e-15,
                "Normal strain magnitude incorrect"
            );
        }

        // Shear strains (last 6): off-diagonal elements should be ±magnitude/2
        for strain in &strains[6..] {
            let mut off_diag_sum = 0.0;
            for i in 0..3 {
                for j in 0..3 {
                    if i != j {
                        off_diag_sum += strain[(i, j)].abs();
                    }
                }
            }
            // Two off-diagonal pairs, each magnitude/2
            assert!(
                (off_diag_sum - magnitude).abs() < 1e-15,
                "Shear strain magnitude incorrect: {off_diag_sum}"
            );
        }
    }

    #[test]
    fn test_strain_paired_signs() {
        // Each strain type should have both positive and negative versions
        let strains = generate_strains(0.01, true);

        // Check pairs: [0,1], [2,3], [4,5], [6,7], [8,9], [10,11]
        for pair_idx in 0..6 {
            let s1 = &strains[pair_idx * 2];
            let s2 = &strains[pair_idx * 2 + 1];

            // s1 + s2 should be zero (opposite signs)
            for i in 0..3 {
                for j in 0..3 {
                    assert!(
                        (s1[(i, j)] + s2[(i, j)]).abs() < 1e-15,
                        "Strain pair {pair_idx} not opposite: {} + {} != 0",
                        s1[(i, j)],
                        s2[(i, j)]
                    );
                }
            }
        }
    }

    // === Moduli relationship verification tests ===

    #[test]
    fn test_moduli_relationship_youngs() {
        // Explicitly verify E = 9KG / (3K + G) for various K, G combinations
        let test_cases = [
            (100.0, 50.0), // K, G
            (150.0, 75.0),
            (200.0, 100.0),
            (80.0, 40.0),
            (137.0, 48.0), // Cu-like values
        ];

        for (k, g) in test_cases {
            let e_computed = youngs_modulus(k, g);
            let e_expected = 9.0 * k * g / (3.0 * k + g);

            assert!(
                (e_computed - e_expected).abs() < 1e-10,
                "E = 9KG/(3K+G) not satisfied: computed={e_computed:.6}, expected={e_expected:.6}"
            );
        }
    }

    #[test]
    fn test_moduli_relationship_poisson() {
        // Explicitly verify ν = (3K - 2G) / (6K + 2G) for various K, G combinations
        let test_cases = [
            (100.0, 50.0),
            (150.0, 75.0),
            (200.0, 100.0),
            (166.0, 82.0), // Fe-like values
        ];

        for (k, g) in test_cases {
            let nu_computed = poisson_ratio(k, g);
            let nu_expected = (3.0 * k - 2.0 * g) / (6.0 * k + 2.0 * g);

            assert!(
                (nu_computed - nu_expected).abs() < 1e-10,
                "ν = (3K-2G)/(6K+2G) not satisfied: computed={nu_computed:.6}, expected={nu_expected:.6}"
            );
        }
    }

    #[test]
    fn test_moduli_relationships_physical_bounds() {
        // For stable materials:
        // - Bulk modulus K > 0
        // - Shear modulus G > 0
        // - Young's modulus E > 0
        // - Poisson's ratio -1 < ν < 0.5 (for most materials 0 < ν < 0.5)
        let test_materials = [
            (168.4, 121.4, 75.4, "Cu"), // C11, C12, C44
            (230.0, 135.0, 117.0, "Fe"),
            (166.0, 64.0, 80.0, "Si"),
        ];

        for (c11, c12, c44, name) in test_materials {
            let tensor = make_cubic_tensor(c11, c12, c44);
            let bulk = bulk_modulus(&tensor);
            let shear = shear_modulus(&tensor);
            let youngs = youngs_modulus(bulk, shear);
            let poisson = poisson_ratio(bulk, shear);

            assert!(bulk > 0.0, "{name}: K should be positive, got {bulk}");
            assert!(shear > 0.0, "{name}: G should be positive, got {shear}");
            assert!(youngs > 0.0, "{name}: E should be positive, got {youngs}");
            assert!(
                poisson > -1.0 && poisson < 0.5,
                "{name}: ν should be in (-1, 0.5), got {poisson}"
            );
        }
    }

    #[test]
    fn test_voigt_reuss_ordering() {
        // Voigt bound >= VRH >= Reuss bound (mathematical property of the averaging)
        let tensor = make_cubic_tensor(168.4, 121.4, 75.4);

        let bulk_voigt = voigt_bulk_modulus(&tensor);
        let bulk_reuss = reuss_bulk_modulus(&tensor);
        let bulk_vrh = bulk_modulus(&tensor);

        let shear_voigt = voigt_shear_modulus(&tensor);
        let shear_reuss = reuss_shear_modulus(&tensor);
        let shear_vrh = shear_modulus(&tensor);

        assert!(
            bulk_voigt >= bulk_vrh - 1e-10,
            "K_Voigt ({bulk_voigt}) should >= K_VRH ({bulk_vrh})"
        );
        assert!(
            bulk_vrh >= bulk_reuss - 1e-10,
            "K_VRH ({bulk_vrh}) should >= K_Reuss ({bulk_reuss})"
        );
        assert!(
            shear_voigt >= shear_vrh - 1e-10,
            "G_Voigt ({shear_voigt}) should >= G_VRH ({shear_vrh})"
        );
        assert!(
            shear_vrh >= shear_reuss - 1e-10,
            "G_VRH ({shear_vrh}) should >= G_Reuss ({shear_reuss})"
        );

        // VRH should be the average
        assert!(
            ((bulk_voigt + bulk_reuss) / 2.0 - bulk_vrh).abs() < 1e-10,
            "K_VRH should be average of Voigt and Reuss"
        );
        assert!(
            ((shear_voigt + shear_reuss) / 2.0 - shear_vrh).abs() < 1e-10,
            "G_VRH should be average of Voigt and Reuss"
        );
    }
}
