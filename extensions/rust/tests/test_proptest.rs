//! Property-based tests using proptest for ferrox invariants.
//!
//! Tests high-value invariants like round-trips, idempotency, and symmetry
//! using randomized inputs to find edge cases.

mod common;

use ferrox::composition::Composition;
use ferrox::lattice::Lattice;
use ferrox::pbc::wrap_frac_coords;
use ferrox::structure::Structure;
use nalgebra::Vector3;
use proptest::prelude::*;

// === Custom Strategies ===

// Strategy for generating a positive-definite 3x3 lattice matrix.
// Constructs via lattice parameters to guarantee valid lattice.
fn arb_lattice() -> impl Strategy<Value = Lattice> {
    (
        3.0..20.0f64,   // a
        3.0..20.0f64,   // b
        3.0..20.0f64,   // c
        60.0..120.0f64, // alpha
        60.0..120.0f64, // beta
        60.0..120.0f64, // gamma
    )
        .prop_map(|(a, b, c, alpha, beta, gamma)| {
            Lattice::from_parameters(a, b, c, alpha, beta, gamma)
        })
        .prop_filter("volume must be positive", |lat| lat.volume().abs() > 1.0)
}

// Strategy for general fractional coordinates (can be outside [0, 1)).
fn arb_general_frac_coord() -> impl Strategy<Value = Vector3<f64>> {
    (-2.0..3.0f64, -2.0..3.0f64, -2.0..3.0f64).prop_map(|(x, y, z)| Vector3::new(x, y, z))
}

// === Property Tests ===

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // Lattice round-trips: frac_to_cart(cart_to_frac(pos)) == pos
    #[test]
    fn lattice_frac_cart_roundtrip(
        lattice in arb_lattice(),
        pos in arb_general_frac_coord(),
    ) {
        let cart = lattice.get_cartesian_coord(&pos);
        let back = lattice.get_fractional_coord(&cart);
        let diff = (back - pos).norm();
        prop_assert!(diff < 1e-10, "frac->cart->frac roundtrip diff={diff:.2e}");
    }

    // Cart->frac->cart roundtrip
    #[test]
    fn lattice_cart_frac_roundtrip(
        lattice in arb_lattice(),
        pos in arb_general_frac_coord(),
    ) {
        let cart = lattice.get_cartesian_coord(&pos);
        let frac = lattice.get_fractional_coord(&cart);
        let back = lattice.get_cartesian_coord(&frac);
        let diff = (back - cart).norm();
        prop_assert!(diff < 1e-10, "cart->frac->cart roundtrip diff={diff:.2e}");
    }

    // Niggli reduction idempotency: niggli(niggli(L)) == niggli(L)
    #[test]
    fn niggli_reduce_idempotent(
        lattice in arb_lattice(),
    ) {
        if let Ok(reduced) = lattice.get_niggli_reduced(1e-5)
            && let Ok(reduced2) = reduced.get_niggli_reduced(1e-5)
        {
            let vol_diff = (reduced2.volume().abs() - reduced.volume().abs()).abs();
            prop_assert!(vol_diff < 1e-3, "niggli volume idempotency diff={vol_diff:.2e}");

            let len1 = reduced.lengths();
            let len2 = reduced2.lengths();
            for idx in 0..3 {
                let diff = (len1[idx] - len2[idx]).abs();
                prop_assert!(diff < 0.01, "niggli length[{idx}] idempotency diff={diff:.2e}");
            }
        }
    }

    // Niggli reduction preserves volume
    #[test]
    fn niggli_preserves_volume(
        lattice in arb_lattice(),
    ) {
        if let Ok(reduced) = lattice.get_niggli_reduced(1e-5) {
            let vol_orig = lattice.volume().abs();
            let rel_diff = (vol_orig - reduced.volume().abs()).abs() / vol_orig;
            prop_assert!(rel_diff < 1e-3, "niggli volume rel_diff={rel_diff:.2e}");
        }
    }

    // LLL reduction preserves volume
    #[test]
    fn lll_preserves_volume(
        lattice in arb_lattice(),
    ) {
        let reduced = lattice.get_lll_reduced(0.75);
        let vol_orig = lattice.volume().abs();
        let rel_diff = (vol_orig - reduced.volume().abs()).abs() / vol_orig;
        prop_assert!(rel_diff < 1e-8, "lll volume rel_diff={rel_diff:.2e}");
    }

    // Wrap idempotency: wrap(wrap(c)) == wrap(c)
    #[test]
    fn wrap_frac_coords_idempotent(
        coord in arb_general_frac_coord(),
    ) {
        let wrapped = wrap_frac_coords(&coord);
        let wrapped2 = wrap_frac_coords(&wrapped);
        let diff = (wrapped - wrapped2).norm();
        prop_assert!(diff < 1e-12, "wrap idempotency diff={diff:.2e}");
    }

    // Wrapped coords are in [0, 1)
    #[test]
    fn wrap_frac_coords_range(
        coord in arb_general_frac_coord(),
    ) {
        let wrapped = wrap_frac_coords(&coord);
        for dim in 0..3 {
            let val = wrapped[dim];
            prop_assert!((-1e-12..1.0 + 1e-12).contains(&val),
                "wrapped[{dim}]={val:.15} out of [0,1)");
        }
    }

    // Composition formula round-trip
    #[test]
    fn composition_formula_roundtrip(
        formula_idx in 0..8usize,
    ) {
        let formulas = [
            "NaCl", "Fe2O3", "CaTiO3", "H2O", "SiO2", "Li3PO4", "Al2O3", "MgO",
        ];
        let formula = formulas[formula_idx];
        let comp = Composition::from_formula(formula).unwrap();
        let formula_str = comp.formula();
        let comp2 = Composition::from_formula(&formula_str).unwrap();
        prop_assert_eq!(formula_str, comp2.formula(), "formula roundtrip failed for '{}'", formula);
    }

    // Neighbor list symmetry: if (i, j) appears, (j, i) must also appear with same distance
    #[test]
    fn neighbor_list_symmetry(
        a in 3.0..6.0f64,
        cutoff_factor in 1.5..3.0f64,
    ) {
        use ferrox::element::Element;
        use ferrox::species::Species;

        let lattice = Lattice::cubic(a);
        let species = vec![Species::neutral(Element::Cu); 4];
        let frac_coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.0),
            Vector3::new(0.5, 0.0, 0.5),
            Vector3::new(0.0, 0.5, 0.5),
        ];
        let structure = Structure::new(lattice, species, frac_coords);
        let cutoff = a * cutoff_factor;

        let (centers, neighbors, _images, distances) =
            structure.get_neighbor_list(cutoff, 1e-8, true);

        for idx in 0..centers.len() {
            let center = centers[idx];
            let neighbor = neighbors[idx];
            let dist = distances[idx];

            let has_reverse = centers.iter().zip(neighbors.iter()).zip(distances.iter())
                .any(|((&c, &n), &d)| c == neighbor && n == center && (d - dist).abs() < 1e-6);
            prop_assert!(has_reverse, "missing reverse ({neighbor}, {center}) d={dist:.4}");
        }
    }

    // CIF round-trip: write then parse preserves structure
    #[test]
    fn cif_roundtrip(
        a in 3.0..8.0f64,
    ) {
        use ferrox::cif::{parse_cif_str, structure_to_cif};
        use ferrox::element::Element;
        use ferrox::species::Species;
        use std::path::Path;

        let lattice = Lattice::cubic(a);
        let species = vec![
            Species::neutral(Element::Na),
            Species::neutral(Element::Cl),
        ];
        let frac_coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.5),
        ];
        let structure = Structure::new(lattice, species, frac_coords);

        let cif_str = structure_to_cif(&structure, Some("test"));
        let parsed = parse_cif_str(&cif_str, Path::new("roundtrip.cif")).unwrap();

        prop_assert_eq!(structure.num_sites(), parsed.num_sites(), "CIF site count mismatch");
        let vol_diff = (structure.lattice.volume() - parsed.lattice.volume()).abs();
        prop_assert!(vol_diff < 1e-3, "CIF volume diff={vol_diff:.2e}");

        for idx in 0..structure.num_sites() {
            prop_assert_eq!(
                structure.species()[idx].element,
                parsed.species()[idx].element,
                "CIF species mismatch at site {}", idx
            );
        }
    }

    // POSCAR round-trip
    #[test]
    fn poscar_roundtrip(
        a in 3.0..8.0f64,
    ) {
        use ferrox::io::{parse_poscar_str, structure_to_poscar};
        use ferrox::element::Element;
        use ferrox::species::Species;

        let lattice = Lattice::cubic(a);
        let species = vec![Species::neutral(Element::Si); 2];
        let frac_coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.25, 0.25, 0.25),
        ];
        let structure = Structure::new(lattice, species, frac_coords);

        let poscar_str = structure_to_poscar(&structure, Some("test"));
        let parsed = parse_poscar_str(&poscar_str).unwrap();

        prop_assert_eq!(structure.num_sites(), parsed.num_sites(), "POSCAR site count mismatch");
        let vol_diff = (structure.lattice.volume() - parsed.lattice.volume()).abs();
        prop_assert!(vol_diff < 1e-3, "POSCAR volume diff={vol_diff:.2e}");
    }
}

// === Deterministic Edge-Case Tests ===

// wrap_frac_coord must return exactly 0.0 for integer inputs,
// and stay in [0, 1) for values near the boundary.
#[test]
fn wrap_frac_coords_boundary_values() {
    use ferrox::pbc::wrap_frac_coord;

    // Exact integers must wrap to 0.0
    for val in [0.0, 1.0, -1.0, 2.0, -5.0, 100.0] {
        let wrapped = wrap_frac_coord(val);
        assert!(
            wrapped.abs() < 1e-15,
            "wrap_frac_coord({val}) = {wrapped}, expected 0.0"
        );
    }

    // Values just below 1.0 must stay near 1.0 (not jump to 0)
    let near_one = 1.0 - 1e-15;
    let wrapped = wrap_frac_coord(near_one);
    assert!(
        wrapped > 0.99,
        "wrap_frac_coord({near_one}) = {wrapped}, expected near 1.0"
    );

    // Negative values wrap correctly
    assert!((wrap_frac_coord(-0.1) - 0.9).abs() < 1e-10);
    assert!((wrap_frac_coord(-0.5) - 0.5).abs() < 1e-10);

    // Result is always in [0, 1) for tricky values
    for val in [
        1.0 - f64::EPSILON,
        1.0 + f64::EPSILON,
        -f64::EPSILON,
        0.9999999999999999,
        -0.0,
        f64::MIN_POSITIVE,
    ] {
        let wrapped = wrap_frac_coord(val);
        assert!(
            (0.0..1.0).contains(&wrapped),
            "wrap_frac_coord({val:.18e}) = {wrapped:.18e} not in [0, 1)"
        );
    }
}
