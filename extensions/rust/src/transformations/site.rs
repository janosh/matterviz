//! Site-level structure transformation tests.
//!
//! Tests for `Structure` methods: `insert_sites`, `remove_sites`,
//! `replace_site_species`, `translate_sites_copy`, and `radial_distort`.

#[cfg(test)]
mod tests {
    use crate::element::Element;
    use crate::lattice::Lattice;
    use crate::species::Species;
    use crate::structure::Structure;
    use approx::assert_relative_eq;
    use nalgebra::{Matrix3, Vector3};

    /// Create a simple cubic NaCl structure for testing.
    fn nacl_structure() -> Structure {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(5.64, 5.64, 5.64)));
        let na = Species::new(Element::Na, Some(1));
        let cl = Species::new(Element::Cl, Some(-1));

        Structure::new(
            lattice,
            vec![na, cl],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        )
    }

    // ========== insert_sites tests ==========

    #[test]
    fn test_insert_sites() {
        let structure = nacl_structure();
        let original_n = structure.num_sites();

        let result = structure
            .insert_sites(
                &[Species::neutral(Element::Li)],
                &[Vector3::new(0.25, 0.25, 0.25)],
                true,
            )
            .unwrap();

        assert_eq!(result.num_sites(), original_n + 1);
        assert_eq!(
            result
                .site_occupancies
                .last()
                .unwrap()
                .dominant_species()
                .element,
            Element::Li
        );
    }

    #[test]
    fn test_insert_sites_cartesian() {
        let structure = nacl_structure();
        let a = structure.lattice.lengths()[0];

        // Insert at Cartesian (a/4, a/4, a/4)
        let result = structure
            .insert_sites(
                &[Species::neutral(Element::Li)],
                &[Vector3::new(a / 4.0, a / 4.0, a / 4.0)],
                false,
            )
            .unwrap();

        // Should be at fractional (0.25, 0.25, 0.25)
        let fc = result.frac_coords.last().unwrap();
        assert_relative_eq!(fc.x, 0.25, epsilon = 1e-10);
        assert_relative_eq!(fc.y, 0.25, epsilon = 1e-10);
        assert_relative_eq!(fc.z, 0.25, epsilon = 1e-10);
    }

    #[test]
    fn test_insert_sites_bulk() {
        let structure = nacl_structure();
        let original_sites = structure.num_sites();

        let result = structure
            .insert_sites(
                &[Species::neutral(Element::Li), Species::neutral(Element::Li)],
                &[
                    Vector3::new(0.25, 0.25, 0.25),
                    Vector3::new(0.75, 0.75, 0.75),
                ],
                true,
            )
            .unwrap();

        assert_eq!(result.num_sites(), original_sites + 2);
    }

    #[test]
    fn test_insert_sites_mismatched_lengths() {
        let structure = nacl_structure();

        let result = structure.insert_sites(
            &[Species::neutral(Element::Li), Species::neutral(Element::Na)],
            &[Vector3::new(0.25, 0.25, 0.25)], // Only one coord
            true,
        );

        assert!(result.is_err());
    }

    // ========== remove_sites tests ==========

    #[test]
    fn test_remove_sites() {
        let structure = nacl_structure();
        let result = structure.remove_sites(&[0]).unwrap();

        assert_eq!(result.num_sites(), 1);
        assert_eq!(
            result.site_occupancies[0].dominant_species().element,
            Element::Cl
        );
    }

    #[test]
    fn test_remove_sites_multiple() {
        let structure = nacl_structure()
            .insert_sites(
                &[Species::neutral(Element::Li), Species::neutral(Element::K)],
                &[
                    Vector3::new(0.25, 0.25, 0.25),
                    Vector3::new(0.75, 0.75, 0.75),
                ],
                true,
            )
            .unwrap();
        assert_eq!(structure.num_sites(), 4);

        // Remove first and third
        let result = structure.remove_sites(&[0, 2]).unwrap();
        assert_eq!(result.num_sites(), 2);
    }

    #[test]
    fn test_remove_sites_invalid_index() {
        let structure = nacl_structure();
        let result = structure.remove_sites(&[10]);
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_all_sites() {
        let structure = nacl_structure();
        let result = structure.remove_sites(&[0, 1]).unwrap();
        assert_eq!(result.num_sites(), 0);
    }

    #[test]
    fn test_remove_sites_order_independent() {
        let original = nacl_structure();

        let s1 = original.remove_sites(&[0, 1]).unwrap();
        let s2 = original.remove_sites(&[1, 0]).unwrap();

        assert_eq!(s1.num_sites(), s2.num_sites());
    }

    // ========== replace_site_species tests ==========

    #[test]
    fn test_replace_site_species() {
        let structure = nacl_structure();
        let result = structure
            .replace_site_species(&[(0, Species::neutral(Element::Li))])
            .unwrap();

        assert_eq!(
            result.site_occupancies[0].dominant_species().element,
            Element::Li
        );
        // Cl should be unchanged
        assert_eq!(
            result.site_occupancies[1].dominant_species().element,
            Element::Cl
        );
    }

    #[test]
    fn test_replace_site_species_multiple() {
        let structure = nacl_structure();
        let result = structure
            .replace_site_species(&[
                (0, Species::neutral(Element::K)),
                (1, Species::neutral(Element::Br)),
            ])
            .unwrap();

        assert_eq!(
            result.site_occupancies[0].dominant_species().element,
            Element::K
        );
        assert_eq!(
            result.site_occupancies[1].dominant_species().element,
            Element::Br
        );
    }

    #[test]
    fn test_replace_site_species_invalid_index() {
        let structure = nacl_structure();
        let result = structure.replace_site_species(&[(999, Species::neutral(Element::Li))]);
        assert!(result.is_err());
    }

    // ========== translate_sites_copy tests ==========

    #[test]
    fn test_translate_sites_copy() {
        let structure = nacl_structure();
        let original_fc = structure.frac_coords[0];

        let result = structure
            .translate_sites_copy(&[0], Vector3::new(0.1, 0.2, 0.3), true)
            .unwrap();

        let new_fc = result.frac_coords[0];
        assert_relative_eq!(new_fc.x, original_fc.x + 0.1, epsilon = 1e-10);
        assert_relative_eq!(new_fc.y, original_fc.y + 0.2, epsilon = 1e-10);
        assert_relative_eq!(new_fc.z, original_fc.z + 0.3, epsilon = 1e-10);
    }

    #[test]
    fn test_translate_sites_copy_cartesian() {
        let structure = nacl_structure();
        let original_cart = structure
            .lattice
            .get_cartesian_coord(&structure.frac_coords[0]);

        // Translate by 1 Angstrom in each direction
        let result = structure
            .translate_sites_copy(&[0], Vector3::new(1.0, 1.0, 1.0), false)
            .unwrap();

        let new_cart = result.lattice.get_cartesian_coord(&result.frac_coords[0]);
        assert_relative_eq!(new_cart.x, original_cart.x + 1.0, epsilon = 1e-10);
        assert_relative_eq!(new_cart.y, original_cart.y + 1.0, epsilon = 1e-10);
        assert_relative_eq!(new_cart.z, original_cart.z + 1.0, epsilon = 1e-10);
    }

    #[test]
    fn test_translate_sites_copy_multiple() {
        let structure = nacl_structure();
        let original_fc0 = structure.frac_coords[0];
        let original_fc1 = structure.frac_coords[1];

        let result = structure
            .translate_sites_copy(&[0, 1], Vector3::new(0.1, 0.0, 0.0), true)
            .unwrap();

        // Both sites should have moved
        assert_relative_eq!(
            result.frac_coords[0].x,
            original_fc0.x + 0.1,
            epsilon = 1e-10
        );
        assert_relative_eq!(
            result.frac_coords[1].x,
            original_fc1.x + 0.1,
            epsilon = 1e-10
        );
    }

    #[test]
    fn test_translate_sites_copy_large_translation() {
        let structure = nacl_structure();

        // Translate by a large vector
        let result = structure
            .translate_sites_copy(&[1], Vector3::new(0.6, 0.6, 0.6), true)
            .unwrap();

        // Site was at (0.5, 0.5, 0.5), now at (1.1, 1.1, 1.1)
        let fc = result.frac_coords[1];
        assert_relative_eq!(fc.x, 1.1, epsilon = 1e-10);
        assert_relative_eq!(fc.y, 1.1, epsilon = 1e-10);
        assert_relative_eq!(fc.z, 1.1, epsilon = 1e-10);
    }

    #[test]
    fn test_translate_sites_copy_with_wrap() {
        let structure = nacl_structure();

        // Translate beyond unit cell boundary then wrap
        let mut result = structure
            .translate_sites_copy(&[1], Vector3::new(0.6, 0.6, 0.6), true)
            .unwrap();
        result.wrap_to_unit_cell();

        // After wrapping, should be at (0.1, 0.1, 0.1)
        let fc = result.frac_coords[1];
        assert_relative_eq!(fc.x, 0.1, epsilon = 1e-10);
        assert_relative_eq!(fc.y, 0.1, epsilon = 1e-10);
        assert_relative_eq!(fc.z, 0.1, epsilon = 1e-10);
    }

    #[test]
    fn test_translate_sites_copy_empty_list() {
        let structure = nacl_structure();

        // Translating no sites should return unchanged structure
        let result = structure
            .translate_sites_copy(&[], Vector3::new(0.5, 0.5, 0.5), true)
            .unwrap();

        for (orig, new) in structure.frac_coords.iter().zip(result.frac_coords.iter()) {
            assert_relative_eq!(orig.x, new.x, epsilon = 1e-10);
            assert_relative_eq!(orig.y, new.y, epsilon = 1e-10);
            assert_relative_eq!(orig.z, new.z, epsilon = 1e-10);
        }
    }

    #[test]
    fn test_translate_sites_copy_deduplicates_indices() {
        let structure = nacl_structure();
        let original_fc = structure.frac_coords[0];

        // Pass duplicate indices - should only translate once
        let result = structure
            .translate_sites_copy(&[0, 0, 0], Vector3::new(0.1, 0.0, 0.0), true)
            .unwrap();

        // Should only move by 0.1, not 0.3
        assert_relative_eq!(
            result.frac_coords[0].x,
            original_fc.x + 0.1,
            epsilon = 1e-10
        );
    }

    // ========== radial_distort tests ==========

    #[test]
    fn test_radial_distort() {
        let structure = nacl_structure();
        let fc_before = structure.frac_coords[1];

        // Push Cl away from Na by 0.1 Å
        let result = structure.radial_distort(0, 0.1, Some(5.0)).unwrap();
        let fc_after = result.frac_coords[1];

        // The fractional coords should have changed
        assert_ne!(fc_before, fc_after, "Position should have changed");

        // The displacement should be outward (away from origin at (0,0,0))
        let delta = fc_after - fc_before;
        assert!(
            delta.x > 0.0 && delta.y > 0.0 && delta.z > 0.0,
            "Displacement should be outward: delta = {:?}",
            delta
        );
    }

    #[test]
    fn test_radial_distort_inward() {
        let structure = nacl_structure();
        let fc_before = structure.frac_coords[1];

        // Negative displacement = inward
        let result = structure.radial_distort(0, -0.1, Some(5.0)).unwrap();
        let fc_after = result.frac_coords[1];
        let delta = fc_after - fc_before;

        assert!(
            delta.x < 0.0 && delta.y < 0.0 && delta.z < 0.0,
            "Displacement should be inward: delta = {:?}",
            delta
        );
    }

    #[test]
    fn test_radial_distort_cutoff_excludes() {
        let structure = nacl_structure();
        let fc_before = structure.frac_coords[1];

        // Very small cutoff should exclude the Cl atom (distance is ~4.88 Å)
        let result = structure.radial_distort(0, 0.5, Some(1.0)).unwrap();
        let fc_after = result.frac_coords[1];

        // Position should be unchanged
        assert_relative_eq!(fc_before.x, fc_after.x, epsilon = 1e-10);
        assert_relative_eq!(fc_before.y, fc_after.y, epsilon = 1e-10);
        assert_relative_eq!(fc_before.z, fc_after.z, epsilon = 1e-10);
    }

    #[test]
    fn test_radial_distort_invalid_center() {
        let structure = nacl_structure();
        let result = structure.radial_distort(999, 0.1, Some(5.0));
        assert!(result.is_err());
    }

    #[test]
    fn test_radial_distort_auto_cutoff() {
        let structure = nacl_structure();
        let fc_before = structure.frac_coords[1];

        // None cutoff should auto-detect nearest neighbor distance
        let result = structure.radial_distort(0, 0.1, None).unwrap();
        let fc_after = result.frac_coords[1];

        assert_ne!(fc_before, fc_after);
    }

    #[test]
    fn test_radial_distort_zero_displacement() {
        let structure = nacl_structure();

        let result = structure.radial_distort(0, 0.0, Some(5.0)).unwrap();

        // Should be unchanged
        for (orig, new) in structure.frac_coords.iter().zip(result.frac_coords.iter()) {
            assert_relative_eq!(orig.x, new.x, epsilon = 1e-10);
            assert_relative_eq!(orig.y, new.y, epsilon = 1e-10);
            assert_relative_eq!(orig.z, new.z, epsilon = 1e-10);
        }
    }

    // ========== Integration tests ==========

    #[test]
    fn test_insert_then_remove() {
        let original = nacl_structure();

        // Insert a Li atom
        let with_li = original
            .insert_sites(
                &[Species::neutral(Element::Li)],
                &[Vector3::new(0.25, 0.25, 0.25)],
                true,
            )
            .unwrap();
        assert_eq!(with_li.num_sites(), 3);

        // Remove it (Li is at index 2)
        let result = with_li.remove_sites(&[2]).unwrap();
        assert_eq!(result.num_sites(), 2);
    }
}
