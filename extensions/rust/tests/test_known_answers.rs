//! Known-answer and literature value tests.
//!
//! Hardcoded values from textbooks/databases for validation against
//! analytical or well-established computational results.

mod common;

use common::{make_fcc, make_hcp, make_nacl};
use ferrox::algorithms::ewald::Ewald;
use ferrox::element::Element;
use ferrox::lattice::Lattice;
use ferrox::order_params::compute_global_steinhardt_q;
use ferrox::species::Species;
use ferrox::structure::Structure;
use ferrox::surfaces::d_spacing;
use ferrox::xrd::{XrdConfig, compute_xrd};
use nalgebra::Vector3;

// === Madelung Constants ===

// Madelung constant M: E_Madelung = -M * e^2 / (4πε₀ * r_nn)
// With Ewald: E_total = -M * k_e * q² / r_nn * n_formula_units
// where k_e = 14.3996 eV·Å/e²

#[test]
fn madelung_constants() {
    let k_coulomb = 14.3996;

    struct MadelungCase {
        name: &'static str,
        structure: Structure,
        n_formula_units: f64,
        r_nn: f64,
        expected: f64,
    }

    // NaCl: M = 1.7476 (conventional cell, 4 formula units)
    let a_nacl = 5.64;
    let nacl = Structure::new(
        Lattice::cubic(a_nacl),
        vec![
            Species::new(Element::Na, Some(1)),
            Species::new(Element::Na, Some(1)),
            Species::new(Element::Na, Some(1)),
            Species::new(Element::Na, Some(1)),
            Species::new(Element::Cl, Some(-1)),
            Species::new(Element::Cl, Some(-1)),
            Species::new(Element::Cl, Some(-1)),
            Species::new(Element::Cl, Some(-1)),
        ],
        vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.0),
            Vector3::new(0.5, 0.0, 0.5),
            Vector3::new(0.0, 0.5, 0.5),
            Vector3::new(0.5, 0.0, 0.0),
            Vector3::new(0.0, 0.5, 0.0),
            Vector3::new(0.0, 0.0, 0.5),
            Vector3::new(0.5, 0.5, 0.5),
        ],
    );

    // CsCl: M = 1.7627 (primitive cell, 1 formula unit)
    let a_cscl = 4.119;
    let cscl = Structure::new(
        Lattice::cubic(a_cscl),
        vec![
            Species::new(Element::Cs, Some(1)),
            Species::new(Element::Cl, Some(-1)),
        ],
        vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
    );

    let cases = vec![
        MadelungCase {
            name: "NaCl",
            structure: nacl,
            n_formula_units: 4.0,
            r_nn: a_nacl / 2.0,
            expected: 1.7476,
        },
        MadelungCase {
            name: "CsCl",
            structure: cscl,
            n_formula_units: 1.0,
            r_nn: a_cscl * (3.0f64).sqrt() / 2.0,
            expected: 1.7627,
        },
    ];

    let ewald = Ewald::default();

    for case in &cases {
        let energy = ewald.energy(&case.structure).unwrap();
        let madelung_computed = -energy / (case.n_formula_units * k_coulomb / case.r_nn);
        let rel_diff = (madelung_computed - case.expected).abs() / case.expected;
        assert!(
            rel_diff < 0.05,
            "[BUG] {} Madelung: computed={madelung_computed:.4}, expected={:.4}, rel_diff={rel_diff:.2e}",
            case.name,
            case.expected
        );
    }
}

// === Steinhardt Order Parameters ===

#[test]
fn steinhardt_ideal_structures() {
    // (structure, cutoff, expected_q4, expected_q6, tolerance)
    let a_fcc = 3.61;
    let nn_dist_fcc = a_fcc / (2.0f64).sqrt();
    let fcc_cutoff = 0.5 * (nn_dist_fcc + a_fcc);

    let a_hcp = 3.21;
    let hcp_cutoff = a_hcp * 1.1;

    let cases: Vec<(&str, Structure, f64, f64, f64, f64)> = vec![
        // FCC ideal: q4 ≈ 0.19094, q6 ≈ 0.57452
        (
            "FCC",
            make_fcc(a_fcc, Element::Cu),
            fcc_cutoff,
            0.19094,
            0.57452,
            0.01,
        ),
        // HCP ideal: q4 ≈ 0.097, q6 ≈ 0.485
        (
            "HCP",
            make_hcp(a_hcp, 5.21, Element::Mg),
            hcp_cutoff,
            0.097,
            0.485,
            0.02,
        ),
    ];

    for (name, structure, cutoff, expected_q4, expected_q6, tol) in &cases {
        let q4 = compute_global_steinhardt_q(structure, 4, *cutoff);
        let q6 = compute_global_steinhardt_q(structure, 6, *cutoff);

        assert!(
            (q4 - expected_q4).abs() < *tol,
            "[BUG] {name} q4={q4:.5} vs expected={expected_q4:.5}"
        );
        assert!(
            (q6 - expected_q6).abs() < *tol,
            "[BUG] {name} q6={q6:.5} vs expected={expected_q6:.5}"
        );
    }
}

// === D-Spacing Formula ===

#[test]
fn d_spacing_cubic() {
    // For cubic: d_hkl = a / sqrt(h^2 + k^2 + l^2)
    let a = 5.64;
    let lattice = Lattice::cubic(a);

    let test_cases: Vec<([i32; 3], f64)> = vec![
        ([1, 0, 0], a / 1.0),
        ([1, 1, 0], a / (2.0f64).sqrt()),
        ([1, 1, 1], a / (3.0f64).sqrt()),
        ([2, 0, 0], a / 2.0),
        ([2, 1, 0], a / (5.0f64).sqrt()),
        ([2, 1, 1], a / (6.0f64).sqrt()),
        ([2, 2, 0], a / (8.0f64).sqrt()),
        ([3, 0, 0], a / 3.0),
        ([3, 1, 0], a / (10.0f64).sqrt()),
        ([2, 2, 2], a / (12.0f64).sqrt()),
    ];

    for (hkl, expected) in test_cases {
        let computed = d_spacing(&lattice, hkl).unwrap();
        assert!(
            (computed - expected).abs() < 1e-6,
            "[BUG] d-spacing {hkl:?}: {computed:.6} vs {expected:.6}"
        );
    }
}

#[test]
fn d_spacing_hexagonal() {
    // For hexagonal pure-l planes: d_{00l} = c / l
    let c = 6.711;
    let lattice = Lattice::hexagonal(2.464, c);

    for l_val in [1, 2] {
        let hkl = [0, 0, l_val];
        let expected = c / l_val as f64;
        let computed = d_spacing(&lattice, hkl).unwrap();
        assert!(
            (computed - expected).abs() < 0.01,
            "[BUG] hex d-spacing {hkl:?}: {computed:.4} vs {expected:.4}"
        );
    }
}

// === XRD Properties ===

#[test]
fn xrd_peak_positions_nacl() {
    let structure = make_nacl(5.64);
    let pattern = compute_xrd(&structure, &XrdConfig::default());

    assert!(
        !pattern.two_theta.is_empty(),
        "XRD should produce peaks for NaCl"
    );

    // First peak should be (111) at ~27.4° with d ≈ 3.26 Å (Cu Kα, a=5.64 Å)
    let first_d = pattern.d_spacings[0];
    let first_peak = pattern.two_theta[0];
    assert!(
        (first_peak - 27.4).abs() < 1.0,
        "First 2θ={first_peak:.2}°, expected ~27.4° for NaCl (111)"
    );
    assert!(
        (first_d - 3.256).abs() < 0.05,
        "First d={first_d:.4} Å, expected ~3.256 for NaCl (111)"
    );
}

#[test]
fn xrd_intensities_normalized() {
    // XRD intensities should be normalized to max=100 when scaled=true (default)
    let structure = make_fcc(3.61, Element::Cu);
    let pattern = compute_xrd(&structure, &XrdConfig::default());

    assert!(
        !pattern.intensities.is_empty(),
        "FCC Cu should produce XRD peaks"
    );
    let max_intensity = pattern
        .intensities
        .iter()
        .cloned()
        .fold(f64::NEG_INFINITY, f64::max);
    assert!(
        (max_intensity - 100.0).abs() < 0.01,
        "[BUG] XRD max intensity: {max_intensity:.4} (expected 100.0)"
    );
}

#[test]
fn xrd_d_spacing_consistent_with_bragg() {
    // XRD d-spacings should satisfy Bragg's law: λ = 2d sin(θ)
    let structure = make_fcc(4.05, Element::Al);
    let pattern = compute_xrd(&structure, &XrdConfig::default());
    let wavelength = 1.54184; // Cu Kα default

    for idx in 0..pattern.two_theta.len().min(5) {
        let two_theta_rad = pattern.two_theta[idx] * std::f64::consts::PI / 180.0;
        let d_from_bragg = wavelength / (2.0 * (two_theta_rad / 2.0).sin());
        let d_reported = pattern.d_spacings[idx];
        assert!(
            (d_from_bragg - d_reported).abs() < 0.01,
            "[BUG] XRD d-spacing {idx}: Bragg={d_from_bragg:.4} vs reported={d_reported:.4}"
        );
    }
}
