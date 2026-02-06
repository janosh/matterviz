//! Parser robustness tests.
//!
//! Uses proptest with arbitrary byte strings to verify parsers never panic
//! on invalid input. Also tests edge cases with valid-but-tricky inputs.

use ferrox::cif::parse_cif_str;
use ferrox::io::{parse_poscar_str, parse_structure_json, parse_xyz_str};
use proptest::prelude::*;
use std::path::Path;

// === Fuzz Tests: Random Bytes Should Never Panic ===

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // CIF parser should return Err, never panic on random bytes
    #[test]
    fn cif_no_panic_on_random(data in prop::string::string_regex(".*").unwrap()) {
        let _ = parse_cif_str(&data, Path::new("fuzz.cif"));
    }

    // POSCAR parser should return Err, never panic on random bytes
    #[test]
    fn poscar_no_panic_on_random(data in prop::string::string_regex(".*").unwrap()) {
        let _ = parse_poscar_str(&data);
    }

    // XYZ parser should return Err, never panic on random bytes
    #[test]
    fn xyz_no_panic_on_random(data in prop::string::string_regex(".*").unwrap()) {
        let _ = parse_xyz_str(&data);
    }

    // JSON structure parser should return Err, never panic on random bytes
    #[test]
    fn json_no_panic_on_random(data in prop::string::string_regex(".*").unwrap()) {
        let _ = parse_structure_json(&data);
    }

}

// === Edge Case Tests: Valid-But-Tricky Inputs ===

#[test]
fn cif_no_symmetry_ops() {
    // CIF with no symmetry operations - should parse with identity only
    let cif = "\
data_test
_cell_length_a 5.0
_cell_length_b 5.0
_cell_length_c 5.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Fe 0.0 0.0 0.0
";
    let result = parse_cif_str(cif, Path::new("no_symops.cif"));
    assert!(
        result.is_ok(),
        "CIF without symmetry ops should parse: {:?}",
        result.err()
    );
    let structure = result.unwrap();
    assert!(structure.num_sites() >= 1, "should have at least 1 site");
}

#[test]
fn cif_label_only_no_element() {
    // CIF with only _atom_site_label (no _atom_site_type_symbol)
    // Parser should extract element from label prefix (Fe1→Fe, O2→O)
    let cif = "\
data_test
_cell_length_a 5.0
_cell_length_b 5.0
_cell_length_c 5.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Fe1 0.0 0.0 0.0
O2 0.5 0.5 0.5
";
    let structure = parse_cif_str(cif, Path::new("label_only.cif"))
        .expect("CIF with label-only should parse successfully");
    assert_eq!(structure.num_sites(), 2);
    assert_eq!(structure.species()[0].element.symbol(), "Fe");
    assert_eq!(structure.species()[1].element.symbol(), "O");
}

#[test]
fn poscar_zero_volume_cell() {
    // POSCAR with zero-volume cell (two identical lattice vectors → degenerate)
    // Parser accepts it (volume=0); downstream code is responsible for validation
    let poscar = "\
zero volume test
1.0
1.0 0.0 0.0
1.0 0.0 0.0
0.0 0.0 1.0
Si
1
Direct
0.0 0.0 0.0
";
    let structure = parse_poscar_str(poscar).expect("zero-volume POSCAR should parse");
    assert_eq!(structure.num_sites(), 1);
    assert!(
        structure.lattice.volume().abs() < 1e-10,
        "volume should be ~0"
    );
}

#[test]
fn poscar_negative_scale_factor() {
    // POSCAR with negative scale factor: VASP convention means "set volume to abs(scale)"
    let poscar = "\
negative scale test
-10.0
3.0 0.0 0.0
0.0 3.0 0.0
0.0 0.0 3.0
Si
1
Direct
0.0 0.0 0.0
";
    let structure = parse_poscar_str(poscar).expect("negative scale POSCAR should parse");
    assert_eq!(structure.num_sites(), 1);
    assert!(
        (structure.lattice.volume() - 10.0).abs() < 1e-6,
        "volume should be 10.0, got {}",
        structure.lattice.volume()
    );
}

#[test]
fn xyz_missing_lattice_line() {
    // XYZ without lattice line (molecule format)
    let xyz = "\
2
Simple molecule
Si 0.0 0.0 0.0
Si 2.35 0.0 0.0
";
    let result = parse_xyz_str(xyz);
    assert!(
        result.is_ok(),
        "simple XYZ should parse: {:?}",
        result.err()
    );
    assert_eq!(result.unwrap().num_sites(), 2);
}

// All parsers reject empty strings
#[test]
fn all_parsers_reject_empty_string() {
    assert!(
        parse_cif_str("", Path::new("empty.cif")).is_err(),
        "empty CIF"
    );
    assert!(parse_poscar_str("").is_err(), "empty POSCAR");
    assert!(parse_xyz_str("").is_err(), "empty XYZ");
    assert!(parse_structure_json("").is_err(), "empty JSON");
}

#[test]
fn json_rejects_invalid_structures() {
    assert!(parse_structure_json("{}").is_err(), "empty JSON object");
    assert!(
        parse_structure_json("{\"lattice\": null}").is_err(),
        "null lattice"
    );
}

#[test]
fn poscar_only_comment() {
    assert!(
        parse_poscar_str("just a comment\n").is_err(),
        "POSCAR with only comment should fail"
    );
}

#[test]
fn xyz_zero_atoms() {
    // XYZ with atom count 0 is rejected (comment line fails to parse as atom data)
    assert!(
        parse_xyz_str("0\nno atoms\n").is_err(),
        "zero-atom XYZ should error"
    );
}

#[test]
fn cif_very_long_line() {
    // CIF with 10k-char comment line should parse fine (comments are skipped)
    let long_comment = "# ".to_string() + &"x".repeat(10000);
    let cif = format!(
        "data_test\n{}\n_cell_length_a 5.0\n_cell_length_b 5.0\n_cell_length_c 5.0\n\
         _cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n\
         loop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n\
         _atom_site_fract_z\nFe 0 0 0\n",
        long_comment
    );
    let structure = parse_cif_str(&cif, Path::new("long_line.cif"))
        .expect("CIF with long comment should parse");
    assert_eq!(structure.num_sites(), 1);
    assert_eq!(structure.species()[0].element.symbol(), "Fe");
}

// POSCAR rejects non-finite values (NaN, Inf) in coordinates, scale factor, and lattice vectors
#[test]
fn poscar_rejects_non_finite_values() {
    let make_poscar = |scale: &str, lattice_row1: &str, coords: &str| -> String {
        format!(
            "test\n{scale}\n{lattice_row1}\n0.0 3.0 0.0\n0.0 0.0 3.0\nSi\n1\nDirect\n{coords}\n"
        )
    };

    let cases: Vec<(&str, String)> = vec![
        (
            "NaN coordinates",
            make_poscar("1.0", "3.0 0.0 0.0", "NaN NaN NaN"),
        ),
        (
            "Inf coordinates",
            make_poscar("1.0", "3.0 0.0 0.0", "inf 0.0 0.0"),
        ),
        (
            "NaN scale factor",
            make_poscar("NaN", "3.0 0.0 0.0", "0.0 0.0 0.0"),
        ),
        (
            "NaN lattice vector",
            make_poscar("1.0", "NaN 0.0 0.0", "0.0 0.0 0.0"),
        ),
    ];

    for (label, poscar) in &cases {
        let result = parse_poscar_str(poscar);
        assert!(result.is_err(), "POSCAR with {label} should be rejected");
    }
}
