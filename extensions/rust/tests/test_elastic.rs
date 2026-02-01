//! Integration tests for elastic tensor analysis.
//!
//! Tests strain generation correctness and singular tensor handling.

#![allow(clippy::needless_range_loop)]

use nalgebra::Matrix3;

// Import from ferrox crate
use ferrox::elastic::{
    apply_strain, bulk_modulus, elastic_tensor_from_stresses, generate_strains, is_cubic_stable,
    is_mechanically_stable, poisson_ratio, reuss_bulk_modulus, reuss_shear_modulus, shear_modulus,
    stress_to_voigt, voigt_bulk_modulus, voigt_shear_modulus, voigt_to_tensor, youngs_modulus,
    zener_ratio,
};

// =============================================================================
// Strain generation correctness tests
// =============================================================================

#[test]
fn test_strain_generation_coverage() {
    // Verify all 6 strain types are generated
    let strains = generate_strains(0.01, true);
    assert_eq!(
        strains.len(),
        12,
        "Should generate 12 strains (6 types × 2 signs)"
    );

    // Check each strain type
    // Normal strains: xx (0,1), yy (2,3), zz (4,5)
    // Shear strains: yz (6,7), xz (8,9), xy (10,11)

    // xx strains
    assert!(
        strains[0][(0, 0)].abs() > 1e-15,
        "xx strain should be non-zero"
    );
    assert!(
        strains[0][(1, 1)].abs() < 1e-15,
        "xx strain should have zero yy"
    );
    assert!(
        strains[0][(2, 2)].abs() < 1e-15,
        "xx strain should have zero zz"
    );

    // yy strains
    assert!(
        strains[2][(1, 1)].abs() > 1e-15,
        "yy strain should be non-zero"
    );
    assert!(
        strains[2][(0, 0)].abs() < 1e-15,
        "yy strain should have zero xx"
    );

    // zz strains
    assert!(
        strains[4][(2, 2)].abs() > 1e-15,
        "zz strain should be non-zero"
    );

    // yz shear strain
    assert!(
        strains[6][(1, 2)].abs() > 1e-15,
        "yz shear should be non-zero"
    );
    assert!(
        strains[6][(2, 1)].abs() > 1e-15,
        "yz shear should be symmetric"
    );

    // xz shear strain
    assert!(
        strains[8][(0, 2)].abs() > 1e-15,
        "xz shear should be non-zero"
    );

    // xy shear strain
    assert!(
        strains[10][(0, 1)].abs() > 1e-15,
        "xy shear should be non-zero"
    );
}

#[test]
fn test_strain_generation_normal_only() {
    let strains = generate_strains(0.005, false);
    assert_eq!(
        strains.len(),
        6,
        "Should generate 6 strains (3 normal × 2 signs)"
    );

    // All strains should be diagonal
    for strain in &strains {
        for idx in 0..3 {
            for jdx in 0..3 {
                if idx != jdx {
                    assert!(
                        strain[(idx, jdx)].abs() < 1e-15,
                        "Normal-only strains should have no off-diagonal elements"
                    );
                }
            }
        }
    }
}

#[test]
fn test_strain_volume_preserving() {
    // Shear strains should be approximately volume-preserving (trace = 0)
    let strains = generate_strains(0.01, true);

    // Shear strains are indices 6-11
    for (idx, strain) in strains.iter().enumerate().skip(6) {
        let trace = strain[(0, 0)] + strain[(1, 1)] + strain[(2, 2)];
        assert!(
            trace.abs() < 1e-15,
            "Shear strain {idx} should be traceless, got trace={trace}"
        );
    }
}

#[test]
fn test_apply_strain_identity() {
    // Applying zero strain should return original cell
    let cell = Matrix3::new(5.0, 0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 5.0);
    let zero_strain = Matrix3::zeros();

    let deformed = apply_strain(&cell, &zero_strain);

    for idx in 0..3 {
        for jdx in 0..3 {
            assert!(
                (cell[(idx, jdx)] - deformed[(idx, jdx)]).abs() < 1e-15,
                "Zero strain should not deform cell"
            );
        }
    }
}

#[test]
fn test_apply_strain_uniaxial() {
    // Uniaxial strain should only change one direction
    let cell = Matrix3::new(10.0, 0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 10.0);
    let strain = Matrix3::new(0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0); // 10% x-strain

    let deformed = apply_strain(&cell, &strain);

    assert!((deformed[(0, 0)] - 11.0).abs() < 1e-10, "x should be 11");
    assert!((deformed[(1, 1)] - 10.0).abs() < 1e-10, "y should be 10");
    assert!((deformed[(2, 2)] - 10.0).abs() < 1e-10, "z should be 10");
}

#[test]
fn test_strain_to_deformed_cell_consistency() {
    // Test that strain application is consistent with Voigt conversion
    let cell = Matrix3::identity() * 5.0;
    let strains = generate_strains(0.01, true);

    for strain in &strains {
        let deformed = apply_strain(&cell, strain);
        // Deformation gradient: F = I + strain
        // For small strains: det(F) ≈ 1 + trace(strain)
        let expected_volume_ratio = 1.0 + strain[(0, 0)] + strain[(1, 1)] + strain[(2, 2)];
        let actual_volume_ratio = deformed.determinant() / cell.determinant();

        // For small strains, the approximation det(I+e) ≈ 1 + tr(e) has O(e^2) error
        // With strain magnitude 0.01, error can be up to ~1e-4
        assert!(
            (actual_volume_ratio - expected_volume_ratio).abs() < 1e-4,
            "Volume ratio mismatch: expected {expected_volume_ratio}, got {actual_volume_ratio}"
        );
    }
}

#[test]
fn test_apply_strain_non_orthogonal_lattice() {
    // Test apply_strain with a non-orthogonal (triclinic) cell
    // This verifies the row-vector convention: rows are lattice vectors
    // Deformed cell = cell * (I + strain) [right multiplication]
    //
    // A triclinic cell with non-zero off-diagonal elements:
    // a = [5, 0, 0], b = [1, 4, 0], c = [0.5, 0.3, 6]
    let cell = Matrix3::new(
        5.0, 0.0, 0.0, // a vector (row 0)
        1.0, 4.0, 0.0, // b vector (row 1)
        0.5, 0.3, 6.0, // c vector (row 2)
    );

    // Apply a pure shear strain in xy (off-diagonal)
    let strain = Matrix3::new(0.0, 0.05, 0.0, 0.05, 0.0, 0.0, 0.0, 0.0, 0.0);

    let deformed = apply_strain(&cell, &strain);

    // With right multiplication: new_cell = cell * (I + strain)
    // Row 0 (a): [5, 0, 0] * [[1.0, 0.05, 0], [0.05, 1, 0], [0, 0, 1]] = [5, 0.25, 0]
    // Row 1 (b): [1, 4, 0] * ... = [1 + 0.2, 0.05 + 4, 0] = [1.2, 4.05, 0]
    // Row 2 (c): [0.5, 0.3, 6] * ... = [0.5 + 0.015, 0.025 + 0.3, 6] = [0.515, 0.325, 6]
    let expected = Matrix3::new(5.0, 0.25, 0.0, 1.2, 4.05, 0.0, 0.515, 0.325, 6.0);

    for idx in 0..3 {
        for jdx in 0..3 {
            assert!(
                (deformed[(idx, jdx)] - expected[(idx, jdx)]).abs() < 1e-10,
                "Non-orthogonal cell shear: element ({idx},{jdx}) expected {}, got {}",
                expected[(idx, jdx)],
                deformed[(idx, jdx)]
            );
        }
    }

    // Also test uniaxial strain on non-orthogonal cell
    let uniaxial = Matrix3::new(0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    let deformed_uni = apply_strain(&cell, &uniaxial);

    // Row 0: [5, 0, 0] stretched by 1.1 in x -> [5.5, 0, 0]
    // Row 1: [1, 4, 0] -> x component stretched -> [1.1, 4, 0]
    // Row 2: [0.5, 0.3, 6] -> x component stretched -> [0.55, 0.3, 6]
    assert!(
        (deformed_uni[(0, 0)] - 5.5).abs() < 1e-10,
        "a_x should be 5.5 after 10% x-strain"
    );
    assert!(
        (deformed_uni[(1, 0)] - 1.1).abs() < 1e-10,
        "b_x should be 1.1 after 10% x-strain (tilted b vector)"
    );
    assert!(
        (deformed_uni[(2, 0)] - 0.55).abs() < 1e-10,
        "c_x should be 0.55 after 10% x-strain"
    );
    // y and z components should be unchanged
    assert!(
        (deformed_uni[(1, 1)] - 4.0).abs() < 1e-10,
        "b_y should remain 4.0"
    );
}

// =============================================================================
// Singular tensor handling tests
// =============================================================================

#[test]
fn test_singular_zero_tensor() {
    // Zero elastic tensor (completely singular)
    let c = [[0.0; 6]; 6];

    // All functions should handle gracefully
    let k_v = voigt_bulk_modulus(&c);
    let k_r = reuss_bulk_modulus(&c);
    let k = bulk_modulus(&c);
    let g_v = voigt_shear_modulus(&c);
    let g_r = reuss_shear_modulus(&c);
    let g = shear_modulus(&c);

    assert!(k_v.is_finite(), "Voigt K should be finite for zero tensor");
    assert!(k_r.is_finite(), "Reuss K should be finite for zero tensor");
    assert!(k.is_finite(), "VRH K should be finite for zero tensor");
    assert!(g_v.is_finite(), "Voigt G should be finite for zero tensor");
    assert!(g_r.is_finite(), "Reuss G should be finite for zero tensor");
    assert!(g.is_finite(), "VRH G should be finite for zero tensor");

    // Zero tensor should be unstable
    assert!(
        !is_mechanically_stable(&c),
        "Zero tensor should be unstable"
    );
}

#[test]
fn test_singular_rank_deficient_tensor() {
    // Rank-deficient tensor (some rows/cols are zero)
    let mut c = [[0.0; 6]; 6];
    c[0][0] = 100.0;
    c[1][1] = 100.0;
    // Leave other elements zero - makes matrix singular

    let k_r = reuss_bulk_modulus(&c);
    let g_r = reuss_shear_modulus(&c);

    // Should return 0 or finite, not NaN/Inf
    assert!(
        k_r.is_finite(),
        "Reuss K should handle rank-deficient tensor"
    );
    assert!(
        g_r.is_finite(),
        "Reuss G should handle rank-deficient tensor"
    );
    assert!(
        !is_mechanically_stable(&c),
        "Rank-deficient tensor should be unstable"
    );
}

#[test]
fn test_singular_negative_eigenvalue() {
    // Tensor with negative eigenvalue (physically unstable)
    let mut c = [[0.0; 6]; 6];
    c[0][0] = 100.0;
    c[1][1] = 100.0;
    c[2][2] = 100.0;
    c[0][1] = 200.0; // Large off-diagonal makes negative eigenvalue
    c[1][0] = 200.0;
    c[3][3] = 50.0;
    c[4][4] = 50.0;
    c[5][5] = 50.0;

    // Should not panic
    let _k = bulk_modulus(&c);
    let _g = shear_modulus(&c);

    // Should be detected as unstable
    assert!(
        !is_mechanically_stable(&c),
        "Negative eigenvalue tensor should be unstable"
    );
}

#[test]
fn test_singular_elastic_tensor_fit() {
    // Fitting elastic tensor from insufficient data should handle gracefully
    let strains = generate_strains(0.01, false); // Only normal strains (6 samples)

    // Create synthetic stresses (not enough to fully determine 6x6 tensor)
    let stresses: Vec<Matrix3<f64>> = strains
        .iter()
        .map(|s| {
            // Simple isotropic response: sigma = lambda * tr(epsilon) * I + 2 * mu * epsilon
            let lambda = 100.0;
            let mu = 50.0;
            let trace = s[(0, 0)] + s[(1, 1)] + s[(2, 2)];
            Matrix3::identity() * (lambda * trace) + s * (2.0 * mu)
        })
        .collect();

    let c = elastic_tensor_from_stresses(&strains, &stresses);

    // Should produce finite values
    for idx in 0..6 {
        for jdx in 0..6 {
            assert!(
                c[idx][jdx].is_finite(),
                "Elastic tensor element [{idx}][{jdx}] should be finite"
            );
        }
    }
}

#[test]
fn test_very_small_moduli() {
    // Very small (but valid) moduli near numerical precision limits
    let k = 1e-12;
    let g = 1e-12;

    let e = youngs_modulus(k, g);
    let nu = poisson_ratio(k, g);

    assert!(e.is_finite(), "E should be finite for very small K, G");
    assert!(nu.is_finite(), "ν should be finite for very small K, G");
}

#[test]
fn test_very_large_moduli() {
    // Very large moduli (diamond-like)
    let mut c = [[0.0; 6]; 6];
    c[0][0] = 1079.0; // Diamond C11
    c[1][1] = 1079.0;
    c[2][2] = 1079.0;
    c[0][1] = 124.0; // Diamond C12
    c[0][2] = 124.0;
    c[1][2] = 124.0;
    c[1][0] = 124.0;
    c[2][0] = 124.0;
    c[2][1] = 124.0;
    c[3][3] = 578.0; // Diamond C44
    c[4][4] = 578.0;
    c[5][5] = 578.0;

    let k = bulk_modulus(&c);
    let g = shear_modulus(&c);
    let e = youngs_modulus(k, g);

    assert!(k > 400.0, "Diamond K should be > 400 GPa, got {k}");
    assert!(g > 500.0, "Diamond G should be > 500 GPa, got {g}");
    assert!(e > 1000.0, "Diamond E should be > 1000 GPa, got {e}");
    assert!(is_mechanically_stable(&c), "Diamond should be stable");
}

// =============================================================================
// Voigt notation edge cases
// =============================================================================

#[test]
fn test_voigt_asymmetric_handling() {
    // The tensor should be treated as symmetric even if not perfectly symmetric
    // (uses upper triangle for Voigt conversion)
    let asymmetric = Matrix3::new(100.0, 10.0, 20.0, 15.0, 200.0, 30.0, 25.0, 35.0, 300.0);

    let voigt = stress_to_voigt(&asymmetric);

    // Should use the upper triangle values
    assert!(
        (voigt[5] - 10.0).abs() < 1e-10,
        "Should use upper triangle for xy"
    );
    assert!(
        (voigt[4] - 20.0).abs() < 1e-10,
        "Should use upper triangle for xz"
    );
    assert!(
        (voigt[3] - 30.0).abs() < 1e-10,
        "Should use upper triangle for yz"
    );
}

#[test]
fn test_voigt_extreme_values() {
    // Test with extreme values
    let extreme = Matrix3::new(1e15, 1e10, 1e10, 1e10, 1e15, 1e10, 1e10, 1e10, 1e15);

    let voigt = stress_to_voigt(&extreme);
    let recovered = voigt_to_tensor(&voigt, false);

    // Should preserve values
    assert!(
        (extreme[(0, 0)] - recovered[(0, 0)]).abs() < 1e5,
        "Should handle large values"
    );
}

// =============================================================================
// Physical consistency tests
// =============================================================================

#[test]
fn test_cubic_stability_edge_cases() {
    // Test boundary conditions of cubic stability criteria
    // C11 > |C12| and C11 + 2*C12 > 0 and C44 > 0

    // Just stable
    assert!(
        is_cubic_stable(101.0, 100.0, 0.1),
        "Should be barely stable"
    );

    // Just unstable: C12 = C11
    assert!(
        !is_cubic_stable(100.0, 100.0, 50.0),
        "Should be unstable when C12 = C11"
    );

    // Just unstable: C11 + 2*C12 = 0
    assert!(
        !is_cubic_stable(100.0, -50.0, 50.0),
        "Should be unstable when C11 + 2*C12 = 0"
    );

    // Just unstable: C44 = 0
    assert!(
        !is_cubic_stable(200.0, 100.0, 0.0),
        "Should be unstable when C44 = 0"
    );

    // Negative C12 but still stable
    assert!(
        is_cubic_stable(200.0, -50.0, 50.0),
        "Can be stable with negative C12"
    );
}

#[test]
fn test_zener_ratio_special_cases() {
    // Isotropic: A = 1
    let c11 = 200.0;
    let c12 = 100.0;
    let c44 = 50.0; // = (C11 - C12) / 2

    let a = zener_ratio(c11, c12, c44);
    assert!((a - 1.0).abs() < 1e-10, "Isotropic Zener ratio should be 1");

    // Very anisotropic
    let c44_aniso = 200.0; // Much larger than isotropic value
    let a_aniso = zener_ratio(c11, c12, c44_aniso);
    assert!(
        a_aniso > 1.0,
        "Anisotropic should have A != 1, got {a_aniso}"
    );

    // Degenerate case: C11 = C12
    let a_degen = zener_ratio(100.0, 100.0, 50.0);
    assert!(
        a_degen.is_infinite(),
        "Degenerate case should return infinity"
    );
}

#[test]
fn test_moduli_consistency_with_known_materials() {
    // Test that computed moduli are consistent with literature values
    // Using Cu as reference: K ≈ 137 GPa, G ≈ 48 GPa

    let mut c_cu = [[0.0; 6]; 6];
    c_cu[0][0] = 168.4;
    c_cu[1][1] = 168.4;
    c_cu[2][2] = 168.4;
    c_cu[0][1] = 121.4;
    c_cu[0][2] = 121.4;
    c_cu[1][2] = 121.4;
    c_cu[1][0] = 121.4;
    c_cu[2][0] = 121.4;
    c_cu[2][1] = 121.4;
    c_cu[3][3] = 75.4;
    c_cu[4][4] = 75.4;
    c_cu[5][5] = 75.4;

    let k = bulk_modulus(&c_cu);
    let g = shear_modulus(&c_cu);
    let e = youngs_modulus(k, g);
    let nu = poisson_ratio(k, g);

    // Literature values for Cu (with tolerance for VRH averaging)
    assert!((k - 137.0).abs() < 3.0, "Cu K = {k} should be ~137 GPa");
    assert!((g - 48.0).abs() < 3.0, "Cu G = {g} should be ~48 GPa");
    assert!((e - 130.0).abs() < 5.0, "Cu E = {e} should be ~130 GPa");
    assert!((nu - 0.34).abs() < 0.02, "Cu ν = {nu} should be ~0.34");
}
