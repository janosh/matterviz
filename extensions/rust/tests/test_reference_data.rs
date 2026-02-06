//! Cross-reference tests against pymatgen-generated reference data.
//!
//! Reads pymatgen_reference_data.json and asserts ferrox values match within tolerance.

mod common;

use common::{make_bcc, make_fcc, make_hcp, make_nacl};
use ferrox::algorithms::ewald::Ewald;
use ferrox::coordination::get_coordination_numbers;
use ferrox::element::Element;
use ferrox::lattice::Lattice;
use ferrox::order_params::compute_global_steinhardt_q;
use ferrox::species::Species;
use ferrox::structure::Structure;
use ferrox::xrd::{XrdConfig, compute_xrd};
use nalgebra::Vector3;
use serde_json::Value;
use std::path::Path;

// Load the pymatgen reference data JSON.
fn load_reference_data() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("pymatgen_reference_data.json");
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("Could not read reference data at {}", path.display()));
    serde_json::from_str(&content).expect("Invalid JSON in reference data")
}

// === Ewald Summation ===

#[test]
fn ewald_nacl_matches_pymatgen() {
    let data = load_reference_data();
    let expected_energy = data["ewald"]["nacl"]["total_energy_eV"].as_f64().unwrap();

    // Construct NaCl with oxidation states matching pymatgen reference
    let lattice = Lattice::cubic(5.64);
    let species = vec![
        Species::new(Element::Na, Some(1)),
        Species::new(Element::Cl, Some(-1)),
    ];
    let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
    let structure = Structure::new(lattice, species, frac_coords);

    let energy = Ewald::default().energy(&structure).unwrap();
    let rel_diff = (energy - expected_energy).abs() / expected_energy.abs();
    assert!(
        rel_diff < 0.05,
        "[BUG] Ewald NaCl: ferrox={energy:.6}, pymatgen={expected_energy:.6}, rel_diff={rel_diff:.2e}"
    );
}

// === Steinhardt Order Parameters ===

#[test]
fn steinhardt_matches_pymatgen() {
    let data = load_reference_data();

    let cases: Vec<(&str, Structure)> = vec![
        ("fcc_cu", make_fcc(3.61, Element::Cu)),
        ("bcc_fe", make_bcc(2.87, Element::Fe)),
        ("hcp_mg", make_hcp(3.21, 5.21, Element::Mg)),
    ];

    for (key, structure) in &cases {
        let ref_data = &data["steinhardt"][key];
        let expected_q4 = ref_data["q4"].as_f64().unwrap();
        let expected_q6 = ref_data["q6"].as_f64().unwrap();
        let cutoff = ref_data["cutoff"].as_f64().unwrap();

        let q4 = compute_global_steinhardt_q(structure, 4, cutoff);
        let q6 = compute_global_steinhardt_q(structure, 6, cutoff);

        assert!(
            (q4 - expected_q4).abs() < 0.02,
            "[BUG] Steinhardt {key} q4: ferrox={q4:.5}, pymatgen={expected_q4:.5}"
        );
        assert!(
            (q6 - expected_q6).abs() < 0.02,
            "[BUG] Steinhardt {key} q6: ferrox={q6:.5}, pymatgen={expected_q6:.5}"
        );
    }
}

// === XRD Patterns ===

#[test]
fn xrd_matches_pymatgen() {
    let data = load_reference_data();

    // Graphite
    let graphite = Structure::new(
        Lattice::hexagonal(2.464, 6.711),
        vec![Species::neutral(Element::C); 4],
        vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 0.5),
            Vector3::new(1.0 / 3.0, 2.0 / 3.0, 0.0),
            Vector3::new(2.0 / 3.0, 1.0 / 3.0, 0.5),
        ],
    );
    // CsCl
    let cscl = Structure::new(
        Lattice::cubic(4.209),
        vec![Species::neutral(Element::Cs), Species::neutral(Element::Cl)],
        vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
    );

    let cases: Vec<(&str, &Structure)> = vec![("graphite", &graphite), ("cscl", &cscl)];
    let config = XrdConfig::default();

    for (name, structure) in cases {
        let ref_two_theta: Vec<f64> = data["xrd"][name]["two_theta"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();

        let pattern = compute_xrd(structure, &config);
        assert!(
            !pattern.two_theta.is_empty(),
            "XRD should produce peaks for {name}"
        );

        // Check first few reference peak positions
        for (idx, &ref_theta) in ref_two_theta.iter().take(3).enumerate() {
            let best_match = pattern
                .two_theta
                .iter()
                .map(|&theta| (theta - ref_theta).abs())
                .fold(f64::INFINITY, f64::min);
            assert!(
                best_match < 1.0,
                "[BUG] XRD {name} peak {idx}: no match near {ref_theta:.2}°"
            );
        }
    }
}

// === Coordination Numbers ===

#[test]
fn coordination_numbers_match_expected() {
    // (structure, cutoff, expected_cn)
    let a_nacl = 5.64;
    let a_fcc = 3.61;
    let nn_dist_fcc = a_fcc / (2.0f64).sqrt();
    let a_bcc = 2.87;
    let nn_dist_bcc = a_bcc * (3.0f64).sqrt() / 2.0;

    let cases: Vec<(&str, Structure, f64, usize)> = vec![
        // NaCl: cutoff between 1st shell (a/2 = 2.82 Å) and 2nd shell (a/√2 = 3.99 Å)
        ("NaCl", make_nacl(a_nacl), 3.4, 6),
        // FCC Cu: 12 nearest neighbors, cutoff between 1st and 2nd shell
        (
            "FCC Cu",
            make_fcc(a_fcc, Element::Cu),
            0.5 * (nn_dist_fcc + a_fcc),
            12,
        ),
        // BCC Fe: 8 nearest neighbors, cutoff between 1st shell and 2nd shell (= a)
        (
            "BCC Fe",
            make_bcc(a_bcc, Element::Fe),
            0.5 * (nn_dist_bcc + a_bcc),
            8,
        ),
    ];

    for (name, structure, cutoff, expected_cn) in &cases {
        let cn = get_coordination_numbers(structure, *cutoff);
        for (idx, &coord_num) in cn.iter().enumerate() {
            assert_eq!(
                coord_num, *expected_cn,
                "[BUG] {name} site {idx}: CN={coord_num}, expected {expected_cn}"
            );
        }
    }
}

// === Niggli Reduction ===

#[test]
fn niggli_reduction_various_lattices() {
    let test_cases: Vec<(&str, Lattice)> = vec![
        ("cubic", Lattice::cubic(4.0)),
        ("hexagonal", Lattice::hexagonal(3.0, 5.0)),
        ("tetragonal", Lattice::tetragonal(4.0, 6.0)),
    ];

    for (name, lattice) in &test_cases {
        let niggli = lattice.get_niggli_reduced(1e-5).unwrap();

        // Volume preserved
        let vol_diff = (niggli.volume().abs() - lattice.volume().abs()).abs();
        assert!(
            vol_diff < 1e-3,
            "[BUG] Niggli volume {name}: diff={vol_diff:.2e}"
        );

        // Lengths ordered: a <= b <= c
        let lengths = niggli.lengths();
        assert!(
            lengths[0] <= lengths[1] + 1e-5 && lengths[1] <= lengths[2] + 1e-5,
            "[BUG] Niggli {name}: lengths should be ordered, got {lengths:?}"
        );
    }
}
