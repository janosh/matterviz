//! Integration tests for elastic tensor analysis.
//!
//! Tests strain generation correctness and singular tensor handling.

#![allow(clippy::needless_range_loop)]

use nalgebra::Matrix3;

// Import from ferrox crate
use ferrox::elastic::{
    apply_strain, bulk_modulus, elastic_tensor_from_stresses, generate_strains, is_cubic_stable,
    is_mechanically_stable, poisson_ratio, reuss_bulk_modulus, reuss_shear_modulus, shear_modulus,
    stress_to_voigt, youngs_modulus, zener_ratio,
};

// === Strain Generation Correctness Tests ===

/// Test strain generation: count, structure, and normal-only mode
#[test]
fn test_strain_generation() {
    // Full strain set (normal + shear)
    let strains_full = generate_strains(0.01, true);
    assert_eq!(strains_full.len(), 12, "Should generate 6 types × 2 signs");

    // Verify strain types at expected indices:
    // Normal: xx(0,1), yy(2,3), zz(4,5) | Shear: yz(6,7), xz(8,9), xy(10,11)
    assert!(strains_full[0][(0, 0)].abs() > 1e-15, "xx strain");
    assert!(strains_full[2][(1, 1)].abs() > 1e-15, "yy strain");
    assert!(strains_full[4][(2, 2)].abs() > 1e-15, "zz strain");
    assert!(strains_full[6][(1, 2)].abs() > 1e-15, "yz shear");
    assert!(strains_full[8][(0, 2)].abs() > 1e-15, "xz shear");
    assert!(strains_full[10][(0, 1)].abs() > 1e-15, "xy shear");

    // Shear strains should be symmetric
    assert!(
        (strains_full[6][(1, 2)] - strains_full[6][(2, 1)]).abs() < 1e-15,
        "Shear should be symmetric"
    );

    // Normal-only mode
    let strains_normal = generate_strains(0.005, false);
    assert_eq!(strains_normal.len(), 6, "Normal-only: 3 types × 2 signs");

    // Normal-only should be diagonal
    for strain in &strains_normal {
        for idx in 0..3 {
            for jdx in 0..3 {
                if idx != jdx {
                    assert!(
                        strain[(idx, jdx)].abs() < 1e-15,
                        "Normal-only should have no off-diagonal"
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

// === Singular Tensor Handling Tests ===

/// Test that singular/pathological tensors are handled gracefully and detected as unstable
#[test]
fn test_singular_tensors() {
    // Zero tensor
    let c_zero = [[0.0; 6]; 6];

    // Rank-deficient (only 2 diagonal elements)
    let mut c_rank = [[0.0; 6]; 6];
    c_rank[0][0] = 100.0;
    c_rank[1][1] = 100.0;

    // Negative eigenvalue (large off-diagonal)
    let mut c_neg = [[0.0; 6]; 6];
    c_neg[0][0] = 100.0;
    c_neg[1][1] = 100.0;
    c_neg[2][2] = 100.0;
    c_neg[0][1] = 200.0;
    c_neg[1][0] = 200.0;
    c_neg[3][3] = 50.0;
    c_neg[4][4] = 50.0;
    c_neg[5][5] = 50.0;

    for (label, c) in [
        ("zero", c_zero),
        ("rank-deficient", c_rank),
        ("negative-eigenvalue", c_neg),
    ] {
        // All modulus functions should return finite values (not NaN/Inf)
        assert!(bulk_modulus(&c).is_finite(), "{label}: K should be finite");
        assert!(shear_modulus(&c).is_finite(), "{label}: G should be finite");
        assert!(
            reuss_bulk_modulus(&c).is_finite(),
            "{label}: K_R should be finite"
        );
        assert!(
            reuss_shear_modulus(&c).is_finite(),
            "{label}: G_R should be finite"
        );

        // All should be detected as mechanically unstable
        assert!(!is_mechanically_stable(&c), "{label}: should be unstable");
    }
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

/// Test moduli functions at extreme values (very small and diamond-like large)
#[test]
fn test_diamond_elastic_moduli() {
    // Diamond elastic constants from literature: C11=1079, C12=124, C44=578 GPa
    // Expected Voigt-Reuss-Hill averages: K ≈ 442 GPa, G ≈ 536 GPa, E ≈ 1142 GPa
    let mut c_diamond = [[0.0; 6]; 6];
    for idx in 0..3 {
        c_diamond[idx][idx] = 1079.0;
        c_diamond[3 + idx][3 + idx] = 578.0;
    }
    c_diamond[0][1] = 124.0;
    c_diamond[0][2] = 124.0;
    c_diamond[1][2] = 124.0;
    c_diamond[1][0] = 124.0;
    c_diamond[2][0] = 124.0;
    c_diamond[2][1] = 124.0;

    let k = bulk_modulus(&c_diamond);
    let g = shear_modulus(&c_diamond);
    let e = youngs_modulus(k, g);
    let nu = poisson_ratio(k, g);

    // Verify against expected values with 5% tolerance
    assert!((k - 442.0).abs() / 442.0 < 0.05, "K={k}, expected ~442 GPa");
    assert!((g - 536.0).abs() / 536.0 < 0.05, "G={g}, expected ~536 GPa");
    assert!(
        (e - 1142.0).abs() / 1142.0 < 0.05,
        "E={e}, expected ~1142 GPa"
    );
    assert!(nu > 0.0 && nu < 0.5, "Poisson ratio should be 0 < nu < 0.5");
    assert!(
        is_mechanically_stable(&c_diamond),
        "Diamond should be stable"
    );
}

// === Voigt Notation Edge Cases ===

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

// === Physical Consistency Tests ===

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
