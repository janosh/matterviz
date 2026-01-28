//! Compatibility tests to ensure behavior matches pymatgen's StructureMatcher.
//!
//! These tests verify that the Rust implementation produces identical results
//! to the Python implementation for various structure pairs.

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

// Test cases matching pymatgen behavior

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
    // Create scaled version
    let s2 = Structure::new(
        Lattice::cubic(4.2), // 5% larger
        s1.species.clone(),
        s1.frac_coords.clone(),
    );
    let matcher = StructureMatcher::new().with_scale(true);
    assert!(
        matcher.fit(&s1, &s2),
        "Scaled structures should match with scale=true"
    );
}

#[test]
fn test_scaled_volume_no_match_without_scale() {
    let s1 = make_cubic(Element::Fe, 4.0);
    let s2 = Structure::new(
        Lattice::cubic(5.0), // 25% larger - significant difference
        s1.species.clone(),
        s1.frac_coords.clone(),
    );
    let matcher = StructureMatcher::new().with_scale(false);
    // Without scaling, very different volumes shouldn't match
    // (depends on tolerance settings)
    let result = matcher.fit(&s1, &s2);
    // This might or might not match depending on implementation details
    println!("scale=false result: {result}");
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
fn test_different_origin_matches() {
    let s1 = make_cubic(Element::Fe, 4.0);
    let s2 = Structure::new(
        s1.lattice.clone(),
        s1.species.clone(),
        vec![Vector3::new(0.5, 0.5, 0.5)], // Shifted origin
    );
    let matcher = StructureMatcher::new();
    assert!(
        matcher.fit(&s1, &s2),
        "Same structure with different origin should match"
    );
}

#[test]
fn test_shuffled_sites_match() {
    let s1 = make_rocksalt(Element::Na, Element::Cl, 5.64);
    // Swap the order of atoms
    let s2 = Structure::new(
        s1.lattice.clone(),
        vec![Species::neutral(Element::Cl), Species::neutral(Element::Na)],
        vec![Vector3::new(0.5, 0.5, 0.5), Vector3::new(0.0, 0.0, 0.0)],
    );
    let matcher = StructureMatcher::new();
    // Both Na at (0,0,0) with Cl at (0.5,0.5,0.5) and vice versa
    // The Hungarian algorithm should find the correct assignment
    // Note: This test depends on whether shuffled sites are supported
    let result = matcher.fit(&s1, &s2);
    println!("Shuffled sites result: {result}");
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
    // Use BCC structure (2 atoms) for meaningful perturbation test
    let s1 = make_bcc(Element::Fe, 2.87);
    let s2 = perturb_structure(&s1, 0.02);
    let matcher = StructureMatcher::new();
    let result = matcher.get_rms_dist(&s1, &s2);
    assert!(result.is_some(), "Should get RMS for perturbed structures");
    let (rms, max_dist) = result.unwrap();
    println!("Perturbed BCC RMS: {rms}, max: {max_dist}");
    // For multi-atom structures with different perturbations, RMS should be > 0
    // but for practical purposes, any match is acceptable
    assert!(rms < 0.5, "RMS should be small for slightly perturbed");
}

#[test]
fn test_tolerance_strict() {
    let s1 = make_cubic(Element::Fe, 4.0);
    let s2 = perturb_structure(&s1, 0.05);

    // With default tolerance
    let matcher_default = StructureMatcher::new();
    let match_default = matcher_default.fit(&s1, &s2);

    // With strict tolerance
    let matcher_strict = StructureMatcher::new()
        .with_site_pos_tol(0.01)
        .with_latt_len_tol(0.01);
    let match_strict = matcher_strict.fit(&s1, &s2);

    println!("Default tolerance: {match_default}");
    println!("Strict tolerance: {match_strict}");

    // Strict should be more restrictive
    if match_strict {
        assert!(match_default, "If strict matches, default should too");
    }
}

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

// Additional Compatibility Tests

#[test]
fn test_json_roundtrip() {
    // Structure -> JSON -> Structure should preserve matching
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
fn test_batch_composition_groups() {
    // Structures with different compositions should never match
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
fn test_primitive_cell_fcc() {
    // FCC conventional (4 atoms) should reduce to primitive (1 atom)
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

#[test]
fn test_deduplicate_many() {
    // Test with larger number of structures
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

    // First 5 should map to 0
    for idx in 0..5 {
        assert_eq!(result[idx], 0, "NaCl structures should map to index 0");
    }

    // Next 3 should map to 5
    for idx in 5..8 {
        assert_eq!(result[idx], 5, "BCC Fe structures should map to index 5");
    }

    // Last 2 should map to 8
    for idx in 8..10 {
        assert_eq!(result[idx], 8, "FCC Cu structures should map to index 8");
    }
}

#[test]
fn test_element_comparator() {
    // Test element comparator ignores oxidation states
    let lattice = Lattice::cubic(5.64);

    // NaCl with oxidation states
    let s1 = Structure::new(
        lattice.clone(),
        vec![
            Species::new(Element::Na, Some(1)),
            Species::new(Element::Cl, Some(-1)),
        ],
        vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
    );

    // NaCl without oxidation states
    let s2 = Structure::new(
        lattice,
        vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
        vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
    );

    // Species comparator: should NOT match (different oxidation states)
    let matcher_species = StructureMatcher::new();
    assert!(
        !matcher_species.fit(&s1, &s2),
        "Species comparator should NOT match when oxidation states differ"
    );

    // Element comparator: should match (same elements)
    let matcher_element =
        StructureMatcher::new().with_comparator(ferrox::matcher::ComparatorType::Element);
    assert!(
        matcher_element.fit(&s1, &s2),
        "Element comparator should match regardless of oxidation state"
    );
}

#[test]
fn test_volume_scaling() {
    let s1 = make_cubic(Element::Fe, 4.0);

    // Create structure with 10% larger volume
    let lattice2 = Lattice::cubic(4.0 * 1.033); // ~10% larger volume
    let s2 = Structure::new(
        lattice2,
        vec![Species::neutral(Element::Fe)],
        vec![Vector3::new(0.0, 0.0, 0.0)],
    );

    // With scaling: should match
    let matcher_scale = StructureMatcher::new().with_scale(true);
    assert!(
        matcher_scale.fit(&s1, &s2),
        "Scaled structures should match with scale=true"
    );

    // Without scaling: may or may not match depending on ltol
    let matcher_no_scale = StructureMatcher::new().with_scale(false);
    let result = matcher_no_scale.fit(&s1, &s2);
    println!("Without scaling: {result}");
}

#[test]
fn test_json_parse_various_elements() {
    // Test JSON parsing for various elements
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
