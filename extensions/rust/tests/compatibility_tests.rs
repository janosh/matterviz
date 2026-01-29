//! Rust-specific tests for ferrox StructureMatcher.
//!
//! These tests verify Rust-specific functionality: JSON I/O, batch operations,
//! spacegroup detection, primitive cell reduction, and RMS distance calculation.
//!
//! For comprehensive pymatgen compatibility verification (lattice tolerance
//! boundaries, site order invariance, volume scaling, origin shifts, oxidation
//! states), see the Python test suite:
//!   `tests/determine_expected_behavior.py`
//!
//! The Python tests compare ferrox against pymatgen directly and are the
//! authoritative source for compatibility verification.

use ferrox::element::Element;
use ferrox::io::{parse_structure_json, structure_to_json};
use ferrox::lattice::Lattice;
use ferrox::matcher::StructureMatcher;
use ferrox::species::Species;
use ferrox::structure::Structure;
use nalgebra::Vector3;

/// Create a simple cubic structure
fn make_cubic(element: Element, a: f64) -> Structure {
    let lattice = Lattice::cubic(a);
    let species = vec![Species::neutral(element)];
    let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0)];
    Structure::new(lattice, species, frac_coords)
}

/// Create a BCC structure
fn make_bcc(element: Element, a: f64) -> Structure {
    let lattice = Lattice::cubic(a);
    let species = vec![Species::neutral(element), Species::neutral(element)];
    let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
    Structure::new(lattice, species, frac_coords)
}

/// Create an FCC structure
fn make_fcc(element: Element, a: f64) -> Structure {
    let lattice = Lattice::cubic(a);
    let species = vec![
        Species::neutral(element),
        Species::neutral(element),
        Species::neutral(element),
        Species::neutral(element),
    ];
    let frac_coords = vec![
        Vector3::new(0.0, 0.0, 0.0),
        Vector3::new(0.5, 0.5, 0.0),
        Vector3::new(0.5, 0.0, 0.5),
        Vector3::new(0.0, 0.5, 0.5),
    ];
    Structure::new(lattice, species, frac_coords)
}

/// Create a rock salt (NaCl type) structure
fn make_rocksalt(cation: Element, anion: Element, a: f64) -> Structure {
    let lattice = Lattice::cubic(a);
    let species = vec![Species::neutral(cation), Species::neutral(anion)];
    let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
    Structure::new(lattice, species, frac_coords)
}

/// Create a slightly perturbed copy of a structure
/// Each site gets a different perturbation to create actual distortion
fn perturb_structure(s: &Structure, max_displacement: f64) -> Structure {
    let mut result = s.clone();
    for (idx, coord) in result.frac_coords.iter_mut().enumerate() {
        // Different perturbation for each site based on index
        let factor = (idx + 1) as f64;
        coord[0] += max_displacement * 0.5 * factor * 0.3;
        coord[1] += max_displacement * 0.3 * factor * 0.5;
        coord[2] += max_displacement * 0.1 * factor * 0.7;
    }
    result
}

// =============================================================================
// Basic Sanity Tests
// =============================================================================

#[test]
fn test_identical_structures_match() {
    let s = make_cubic(Element::Fe, 4.0);
    let matcher = StructureMatcher::new();
    assert!(matcher.fit(&s, &s), "Identical structures should match");
}

#[test]
fn test_slightly_perturbed_matches() {
    let s1 = make_cubic(Element::Fe, 4.0);
    let s2 = perturb_structure(&s1, 0.01);
    let matcher = StructureMatcher::new();
    assert!(
        matcher.fit(&s1, &s2),
        "Slightly perturbed structures should match"
    );
}

#[test]
fn test_different_elements_no_match() {
    let s1 = make_cubic(Element::Fe, 4.0);
    let s2 = make_cubic(Element::Cu, 4.0);
    let matcher = StructureMatcher::new();
    assert!(
        !matcher.fit(&s1, &s2),
        "Different elements should not match"
    );
}

#[test]
fn test_different_compositions_no_match() {
    let s1 = make_bcc(Element::Fe, 2.87);
    let s2 = make_rocksalt(Element::Fe, Element::O, 4.3);
    let matcher = StructureMatcher::new();
    assert!(
        !matcher.fit(&s1, &s2),
        "Different compositions should not match"
    );
}

#[test]
fn test_scaled_volume_matches() {
    let s1 = make_cubic(Element::Fe, 4.0);
    let s2 = Structure::new(
        Lattice::cubic(4.2), // 5% larger
        s1.species().into_iter().cloned().collect(),
        s1.frac_coords.clone(),
    );
    let matcher = StructureMatcher::new().with_scale(true);
    assert!(
        matcher.fit(&s1, &s2),
        "Scaled structures should match with scale=true"
    );
}

#[test]
fn test_different_site_counts_no_match() {
    let s1 = make_cubic(Element::Fe, 4.0);
    let s2 = make_bcc(Element::Fe, 4.0);
    let matcher = StructureMatcher::new().with_attempt_supercell(false);
    assert!(
        !matcher.fit(&s1, &s2),
        "Different site counts should not match without supercell"
    );
}

#[test]
fn test_bcc_structures() {
    let s1 = make_bcc(Element::Fe, 2.87);
    let s2 = make_bcc(Element::Fe, 2.87);
    let matcher = StructureMatcher::new();
    assert!(
        matcher.fit(&s1, &s2),
        "Identical BCC structures should match"
    );
}

#[test]
fn test_fcc_structures() {
    let s1 = make_fcc(Element::Cu, 3.6);
    let s2 = make_fcc(Element::Cu, 3.6);
    let matcher = StructureMatcher::new();
    assert!(
        matcher.fit(&s1, &s2),
        "Identical FCC structures should match"
    );
}

#[test]
fn test_rocksalt_structures() {
    let s1 = make_rocksalt(Element::Na, Element::Cl, 5.64);
    let s2 = make_rocksalt(Element::Na, Element::Cl, 5.64);
    let matcher = StructureMatcher::new();
    assert!(
        matcher.fit(&s1, &s2),
        "Identical rocksalt structures should match"
    );
}

#[test]
fn test_different_rocksalt_no_match() {
    let s1 = make_rocksalt(Element::Na, Element::Cl, 5.64);
    let s2 = make_rocksalt(Element::Mg, Element::O, 4.21);
    let matcher = StructureMatcher::new();
    assert!(
        !matcher.fit(&s1, &s2),
        "Different rocksalt structures should not match"
    );
}

// =============================================================================
// RMS Distance Tests (Rust-specific API)
// =============================================================================

#[test]
fn test_get_rms_dist_identical() {
    let s = make_cubic(Element::Fe, 4.0);
    let matcher = StructureMatcher::new();
    let result = matcher.get_rms_dist(&s, &s);
    assert!(result.is_some(), "Should get RMS for identical structures");
    let (rms, max_dist) = result.unwrap();
    assert!(rms < 1e-10, "RMS should be ~0 for identical structures");
    assert!(
        max_dist < 1e-10,
        "Max dist should be ~0 for identical structures"
    );
}

#[test]
fn test_get_rms_dist_perturbed() {
    let s1 = make_bcc(Element::Fe, 2.87);
    let s2 = perturb_structure(&s1, 0.02);
    // Use primitive_cell=false because perturbation breaks symmetry,
    // causing different primitive cell reductions
    let matcher = StructureMatcher::new().with_primitive_cell(false);
    let result = matcher.get_rms_dist(&s1, &s2);
    assert!(result.is_some(), "Should get RMS for perturbed structures");
    let (rms, _max_dist) = result.unwrap();
    // With max_displacement=0.02, RMS should be well under 0.1
    assert!(
        rms < 0.1,
        "RMS should be small for slightly perturbed (max_disp=0.02)"
    );
}

// =============================================================================
// Lattice Type Tests
// =============================================================================

#[test]
fn test_hexagonal_lattice() {
    let lattice = Lattice::hexagonal(3.2, 5.2);
    let species = vec![Species::neutral(Element::Ti), Species::neutral(Element::Ti)];
    let frac_coords = vec![
        Vector3::new(1.0 / 3.0, 2.0 / 3.0, 0.25),
        Vector3::new(2.0 / 3.0, 1.0 / 3.0, 0.75),
    ];
    let s1 = Structure::new(lattice.clone(), species.clone(), frac_coords.clone());
    let s2 = Structure::new(lattice, species, frac_coords);

    let matcher = StructureMatcher::new();
    assert!(
        matcher.fit(&s1, &s2),
        "Identical hexagonal structures should match"
    );
}

#[test]
fn test_orthorhombic_lattice() {
    let lattice = Lattice::orthorhombic(3.0, 4.0, 5.0);
    let species = vec![Species::neutral(Element::Si)];
    let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0)];
    let s1 = Structure::new(lattice.clone(), species.clone(), frac_coords.clone());
    let s2 = Structure::new(lattice, species, frac_coords);

    let matcher = StructureMatcher::new();
    assert!(
        matcher.fit(&s1, &s2),
        "Identical orthorhombic structures should match"
    );
}

#[test]
fn test_triclinic_lattice() {
    let lattice = Lattice::from_parameters(3.0, 4.0, 5.0, 80.0, 85.0, 95.0);
    let species = vec![Species::neutral(Element::Ca)];
    let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0)];
    let s1 = Structure::new(lattice.clone(), species.clone(), frac_coords.clone());
    let s2 = Structure::new(lattice, species, frac_coords);

    let matcher = StructureMatcher::new();
    assert!(
        matcher.fit(&s1, &s2),
        "Identical triclinic structures should match"
    );
}

// =============================================================================
// JSON I/O Tests (Rust-specific)
// =============================================================================

#[test]
fn test_json_roundtrip() {
    let s1 = make_rocksalt(Element::Na, Element::Cl, 5.64);
    let s2 = make_rocksalt(Element::Na, Element::Cl, 5.64);

    let matcher = StructureMatcher::new();
    let direct_result = matcher.fit(&s1, &s2);

    // Serialize and deserialize
    let json1 = structure_to_json(&s1);
    let json2 = structure_to_json(&s2);
    let s1_parsed = parse_structure_json(&json1).unwrap();
    let s2_parsed = parse_structure_json(&json2).unwrap();

    let parsed_result = matcher.fit(&s1_parsed, &s2_parsed);
    assert_eq!(
        direct_result, parsed_result,
        "JSON roundtrip should preserve matching"
    );
}

#[test]
fn test_json_parse_various_elements() {
    let elements = ["H", "C", "N", "O", "Si", "Fe", "Cu", "Ag", "Au", "U"];

    for elem in elements {
        let json = format!(
            r#"{{"lattice":{{"matrix":[[4,0,0],[0,4,0],[0,0,4]]}},"sites":[{{"species":[{{"element":"{elem}"}}],"abc":[0,0,0]}}]}}"#
        );

        let result = parse_structure_json(&json);
        assert!(result.is_ok(), "Should parse structure with element {elem}");

        let s = result.unwrap();
        assert_eq!(s.num_sites(), 1);
    }
}

// =============================================================================
// Batch Operations Tests (Rust-specific)
// =============================================================================

#[test]
fn test_batch_composition_groups() {
    let structures = vec![
        make_rocksalt(Element::Na, Element::Cl, 5.64),
        make_bcc(Element::Fe, 2.87),
        make_rocksalt(Element::Na, Element::Cl, 5.64), // Same as 0
        make_fcc(Element::Cu, 3.6),
        make_bcc(Element::Fe, 2.87), // Same as 1
    ];

    let matcher = StructureMatcher::new();
    let groups = matcher.group(&structures).unwrap();

    // Should have 3 groups: NaCl, Fe-BCC, Cu-FCC
    assert_eq!(groups.len(), 3, "Should have 3 distinct groups");
}

#[test]
fn test_deduplicate_many() {
    let mut structures = Vec::new();

    // Add 5 NaCl structures (should all group together)
    for _ in 0..5 {
        structures.push(make_rocksalt(Element::Na, Element::Cl, 5.64));
    }

    // Add 3 BCC Fe structures
    for _ in 0..3 {
        structures.push(make_bcc(Element::Fe, 2.87));
    }

    // Add 2 FCC Cu structures
    for _ in 0..2 {
        structures.push(make_fcc(Element::Cu, 3.6));
    }

    let matcher = StructureMatcher::new();
    let result = matcher.deduplicate(&structures).unwrap();

    // First 5 should map to 0 (NaCl structures)
    assert!(
        result[..5].iter().all(|&v| v == 0),
        "NaCl structures should map to index 0"
    );

    // Next 3 should map to 5 (BCC Fe structures)
    assert!(
        result[5..8].iter().all(|&v| v == 5),
        "BCC Fe structures should map to index 5"
    );

    // Last 2 should map to 8 (FCC Cu structures)
    assert!(
        result[8..10].iter().all(|&v| v == 8),
        "FCC Cu structures should map to index 8"
    );
}

// =============================================================================
// Spglib Integration Tests (Rust-specific)
// =============================================================================

#[test]
fn test_primitive_cell_fcc() {
    let fcc_conv = make_fcc(Element::Cu, 3.6);
    assert_eq!(fcc_conv.num_sites(), 4);

    let prim = fcc_conv.get_primitive(1e-4).unwrap();
    assert_eq!(prim.num_sites(), 1, "FCC primitive should have 1 atom");
}

#[test]
fn test_spacegroup_fcc() {
    let fcc = make_fcc(Element::Cu, 3.6);
    let sg = fcc.get_spacegroup_number(1e-4).unwrap();
    assert_eq!(sg, 225, "FCC should be spacegroup 225 (Fm-3m)");
}

#[test]
fn test_spacegroup_bcc() {
    let bcc = make_bcc(Element::Fe, 2.87);
    let sg = bcc.get_spacegroup_number(1e-4).unwrap();
    assert_eq!(sg, 229, "BCC should be spacegroup 229 (Im-3m)");
}

// =============================================================================
// fit_anonymous Integration Tests (complements unit tests in matcher.rs)
// =============================================================================

#[test]
fn test_fit_anonymous_bcc_vs_bcc() {
    // Two BCC structures with different elements and lattice parameters
    let fe_bcc = make_bcc(Element::Fe, 2.87);
    let w_bcc = make_bcc(Element::W, 3.16);
    assert!(
        StructureMatcher::new().fit_anonymous(&fe_bcc, &w_bcc),
        "BCC Fe and BCC W should match anonymously"
    );
}

#[test]
fn test_fit_anonymous_fcc_vs_fcc() {
    // Two FCC structures with different elements and lattice parameters
    let cu_fcc = make_fcc(Element::Cu, 3.6);
    let al_fcc = make_fcc(Element::Al, 4.05);
    assert!(
        StructureMatcher::new().fit_anonymous(&cu_fcc, &al_fcc),
        "FCC Cu and FCC Al should match anonymously"
    );
}

#[test]
fn test_fit_anonymous_bcc_vs_fcc_no_match() {
    // BCC vs FCC should NOT match (different structures)
    // Note: with primitive_cell=true (default), both reduce to 1 atom
    // so they would match. Use primitive_cell=false for this test.
    let fe_bcc = make_bcc(Element::Fe, 2.87);
    let cu_fcc = make_fcc(Element::Cu, 3.6);
    let matcher = StructureMatcher::new().with_primitive_cell(false);
    assert!(
        !matcher.fit_anonymous(&fe_bcc, &cu_fcc),
        "BCC vs FCC should not match (without primitive reduction)"
    );
}
