//! Standard structure transformation tests.
//!
//! Tests for `Structure` methods: `make_supercell`, `rotate`, `substitute`,
//! `remove_species`, `deform`, `get_primitive`, `get_conventional_structure`, `perturb`.

#[cfg(test)]
mod tests {
    use crate::element::Element;
    use crate::lattice::Lattice;
    use crate::species::Species;
    use crate::structure::Structure;
    use approx::assert_relative_eq;
    use nalgebra::{Matrix3, Vector3};
    use std::collections::HashMap;
    use std::f64::consts::{FRAC_PI_2, FRAC_PI_3, FRAC_PI_4, PI};

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

    /// Create a FCC Cu structure for testing primitive cell operations.
    fn fcc_copper() -> Structure {
        let a = 3.6;
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(a, a, a)));
        let cu = Species::neutral(Element::Cu);

        Structure::new(
            lattice,
            vec![cu, cu, cu, cu],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.5, 0.0),
                Vector3::new(0.5, 0.0, 0.5),
                Vector3::new(0.0, 0.5, 0.5),
            ],
        )
    }

    /// Create a triclinic Li2O structure for testing.
    fn triclinic_li2o() -> Structure {
        let lattice = Lattice::new(Matrix3::new(
            3.84, 0.0, 0.0, 1.92, 3.33, 0.0, 0.0, -2.22, 3.15,
        ));
        let li = Species::new(Element::Li, Some(1));
        let o = Species::new(Element::O, Some(-2));

        Structure::new(
            lattice,
            vec![li, li, o],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.5, 0.5),
                Vector3::new(0.25, 0.25, 0.25),
            ],
        )
    }

    /// Create a single-atom Fe structure for minimal tests.
    fn single_fe() -> Structure {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(2.87, 2.87, 2.87)));
        let fe = Species::neutral(Element::Fe);
        Structure::new(lattice, vec![fe], vec![Vector3::new(0.0, 0.0, 0.0)])
    }

    // ========== make_supercell tests ==========

    #[test]
    fn test_supercell_diagonal() {
        let structure = nacl_structure();
        let result = structure
            .make_supercell([[2, 0, 0], [0, 2, 0], [0, 0, 2]])
            .unwrap();

        // 2x2x2 supercell should have 8x more atoms
        assert_eq!(result.num_sites(), 16);

        // Volume should be 8x larger
        let expected_volume = 5.64_f64.powi(3) * 8.0;
        assert_relative_eq!(result.volume(), expected_volume, epsilon = 1e-10);
    }

    #[test]
    fn test_supercell_2x1x1() {
        let structure = nacl_structure();
        let result = structure
            .make_supercell([[2, 0, 0], [0, 1, 0], [0, 0, 1]])
            .unwrap();

        // 2x1x1 supercell should have 2x more atoms
        assert_eq!(result.num_sites(), 4);
    }

    #[test]
    fn test_supercell_asymmetric() {
        let structure = nacl_structure();
        let result = structure
            .make_supercell([[3, 0, 0], [0, 2, 0], [0, 0, 1]])
            .unwrap();

        assert_eq!(result.num_sites(), structure.num_sites() * 6);
        let expected_volume = 5.64_f64.powi(3) * 6.0;
        assert_relative_eq!(result.volume(), expected_volume, epsilon = 1e-10);
    }

    #[test]
    fn test_supercell_off_diagonal() {
        let structure = nacl_structure();
        // Non-diagonal transformation matrix with det=2
        let result = structure
            .make_supercell([[1, 1, 0], [0, 1, 1], [1, 0, 1]])
            .unwrap();

        assert_eq!(result.num_sites(), 4);
    }

    #[test]
    fn test_supercell_identity() {
        let structure = nacl_structure();
        let result = structure
            .make_supercell([[1, 0, 0], [0, 1, 0], [0, 0, 1]])
            .unwrap();

        assert_eq!(result.num_sites(), structure.num_sites());
        assert_relative_eq!(result.volume(), structure.volume(), epsilon = 1e-10);
    }

    #[test]
    fn test_supercell_single_atom() {
        let structure = single_fe();
        let result = structure
            .make_supercell([[3, 0, 0], [0, 3, 0], [0, 0, 3]])
            .unwrap();

        assert_eq!(result.num_sites(), 27);
    }

    #[test]
    fn test_supercell_preserves_composition_ratio() {
        let structure = nacl_structure();
        let result = structure
            .make_supercell([[4, 0, 0], [0, 3, 0], [0, 0, 2]])
            .unwrap();

        let na_count = result
            .site_occupancies
            .iter()
            .filter(|s| s.dominant_species().element == Element::Na)
            .count();
        let cl_count = result
            .site_occupancies
            .iter()
            .filter(|s| s.dominant_species().element == Element::Cl)
            .count();

        // 1:1 ratio should be preserved
        assert_eq!(na_count, cl_count);
        assert_eq!(na_count, 24); // 2 * 4 * 3 * 2 / 2 = 24 Na atoms
    }

    #[test]
    fn test_supercell_triclinic() {
        let structure = triclinic_li2o();
        let original_volume = structure.volume();
        let result = structure
            .make_supercell([[2, 0, 0], [0, 2, 0], [0, 0, 2]])
            .unwrap();

        assert_eq!(result.num_sites(), structure.num_sites() * 8);
        assert_relative_eq!(result.volume(), original_volume * 8.0, epsilon = 1e-8);
    }

    // ========== rotate tests ==========

    #[test]
    fn test_rotate_preserves_volume() {
        let expected_volume = 5.64_f64.powi(3);

        for (axis, angle) in [
            (Vector3::x(), FRAC_PI_4),
            (Vector3::y(), FRAC_PI_4),
            (Vector3::z(), FRAC_PI_2),
            (Vector3::new(1.0, 1.0, 1.0), FRAC_PI_2),
        ] {
            let structure = nacl_structure();
            let rotated = structure.rotate(axis, angle).unwrap();
            assert_relative_eq!(rotated.volume(), expected_volume, epsilon = 1e-8);
        }
    }

    #[test]
    fn test_rotate_360_is_identity() {
        let structure = nacl_structure();
        let rotated = structure.rotate(Vector3::z(), 2.0 * PI).unwrap();

        assert_relative_eq!(rotated.volume(), structure.volume(), epsilon = 1e-10);
        for (orig, rot) in structure.frac_coords.iter().zip(rotated.frac_coords.iter()) {
            assert_relative_eq!(orig.x, rot.x, epsilon = 1e-10);
            assert_relative_eq!(orig.y, rot.y, epsilon = 1e-10);
            assert_relative_eq!(orig.z, rot.z, epsilon = 1e-10);
        }
    }

    #[test]
    fn test_rotate_inverse() {
        let structure = nacl_structure();
        let rotated = structure.rotate(Vector3::z(), FRAC_PI_4).unwrap();
        let back = rotated.rotate(Vector3::z(), -FRAC_PI_4).unwrap();

        for (orig, final_fc) in structure.frac_coords.iter().zip(back.frac_coords.iter()) {
            assert_relative_eq!(orig.x, final_fc.x, epsilon = 1e-10);
            assert_relative_eq!(orig.y, final_fc.y, epsilon = 1e-10);
            assert_relative_eq!(orig.z, final_fc.z, epsilon = 1e-10);
        }
    }

    #[test]
    fn test_rotate_zero_axis_error() {
        let structure = nacl_structure();
        let result = structure.rotate(Vector3::zeros(), FRAC_PI_4);

        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("zero length"),
            "Error should mention zero length axis: {err_msg}"
        );
    }

    #[test]
    fn test_rotate_preserves_frac_coords() {
        let structure = nacl_structure();

        for (axis, angle) in [
            (Vector3::x(), FRAC_PI_4),
            (Vector3::y(), FRAC_PI_3),
            (Vector3::z(), FRAC_PI_2),
            (Vector3::new(1.0, 1.0, 1.0), 0.7),
        ] {
            let rotated = structure.rotate(axis, angle).unwrap();

            for (orig, rot) in structure.frac_coords.iter().zip(rotated.frac_coords.iter()) {
                assert_relative_eq!(orig.x, rot.x, epsilon = 1e-10);
                assert_relative_eq!(orig.y, rot.y, epsilon = 1e-10);
                assert_relative_eq!(orig.z, rot.z, epsilon = 1e-10);
            }
        }
    }

    #[test]
    fn test_rotate_cartesian_coords_change() {
        let structure = nacl_structure();
        let original_cart: Vec<_> = structure
            .frac_coords
            .iter()
            .map(|fc| structure.lattice.matrix() * fc)
            .collect();

        let rotated = structure.rotate(Vector3::z(), FRAC_PI_2).unwrap();

        let new_cart: Vec<_> = rotated
            .frac_coords
            .iter()
            .map(|fc| rotated.lattice.matrix() * fc)
            .collect();

        let orig_second = &original_cart[1];
        let new_second = &new_cart[1];

        // Cartesian coords should differ (unless the atom is at origin)
        assert!(
            (orig_second - new_second).norm() > 1e-10 || orig_second.norm() < 1e-10,
            "Cartesian coords should change after rotation (unless at origin)"
        );
    }

    #[test]
    fn test_rotate_matrix_is_orthogonal() {
        // Helper to compute Rodrigues' rotation matrix for verification
        fn rotation_matrix(axis: Vector3<f64>, angle: f64) -> Matrix3<f64> {
            let axis = axis.normalize();
            let cos_a = angle.cos();
            let sin_a = angle.sin();
            let one_minus_cos = 1.0 - cos_a;
            let (ax, ay, az) = (axis.x, axis.y, axis.z);

            Matrix3::new(
                one_minus_cos * ax * ax + cos_a,
                one_minus_cos * ax * ay - sin_a * az,
                one_minus_cos * ax * az + sin_a * ay,
                one_minus_cos * ax * ay + sin_a * az,
                one_minus_cos * ay * ay + cos_a,
                one_minus_cos * ay * az - sin_a * ax,
                one_minus_cos * ax * az - sin_a * ay,
                one_minus_cos * ay * az + sin_a * ax,
                one_minus_cos * az * az + cos_a,
            )
        }

        for (axis, angle) in [
            (Vector3::x(), FRAC_PI_4),
            (Vector3::y(), FRAC_PI_3),
            (Vector3::z(), FRAC_PI_2),
            (Vector3::new(1.0, 1.0, 1.0), 0.7),
            (Vector3::new(1.0, 2.0, 3.0), 1.5),
        ] {
            let rot = rotation_matrix(axis, angle);

            // R^T * R should equal identity matrix
            let product = rot.transpose() * rot;
            let identity = Matrix3::identity();

            for row in 0..3 {
                for col in 0..3 {
                    assert_relative_eq!(product[(row, col)], identity[(row, col)], epsilon = 1e-10);
                }
            }

            // Also verify det(R) = 1 (proper rotation, not reflection)
            assert_relative_eq!(rot.determinant(), 1.0, epsilon = 1e-10);
        }
    }

    // ========== substitute tests ==========

    #[test]
    fn test_substitute() {
        let structure = nacl_structure();
        let result = structure
            .substitute(
                Species::new(Element::Na, Some(1)),
                Species::new(Element::K, Some(1)),
            )
            .unwrap();

        assert_eq!(
            result.site_occupancies[0].dominant_species().element,
            Element::K
        );
    }

    #[test]
    fn test_substitute_map() {
        let structure = nacl_structure();
        let mut subs = HashMap::new();
        subs.insert(
            Species::new(Element::Na, Some(1)),
            Species::new(Element::K, Some(1)),
        );
        subs.insert(
            Species::new(Element::Cl, Some(-1)),
            Species::new(Element::Br, Some(-1)),
        );

        let result = structure.substitute_map(subs).unwrap();

        let site_elements: Vec<Element> = result
            .site_occupancies
            .iter()
            .map(|s| s.dominant_species().element)
            .collect();
        assert!(site_elements.contains(&Element::K));
        assert!(site_elements.contains(&Element::Br));
        assert!(!site_elements.contains(&Element::Na));
        assert!(!site_elements.contains(&Element::Cl));
    }

    #[test]
    fn test_substitute_no_match() {
        let structure = nacl_structure();
        let result = structure
            .substitute(Species::neutral(Element::Fe), Species::neutral(Element::Co))
            .unwrap();

        // Structure should be unchanged
        assert_eq!(
            result.site_occupancies[0].dominant_species().element,
            Element::Na
        );
    }

    #[test]
    fn test_substitute_preserves_oxidation_state() {
        let structure = nacl_structure();
        let result = structure
            .substitute(
                Species::new(Element::Na, Some(1)),
                Species::new(Element::K, Some(1)),
            )
            .unwrap();

        assert_eq!(
            result.site_occupancies[0]
                .dominant_species()
                .oxidation_state,
            Some(1)
        );
    }

    // ========== remove_species tests ==========

    #[test]
    fn test_remove_species() {
        let structure = nacl_structure();
        let result = structure
            .remove_species(&[Species::new(Element::Na, Some(1))])
            .unwrap();

        assert_eq!(result.num_sites(), 1);
        assert_eq!(
            result.site_occupancies[0].dominant_species().element,
            Element::Cl
        );
    }

    #[test]
    fn test_remove_multiple_species() {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(4.0, 4.0, 4.0)));
        let li = Species::new(Element::Li, Some(1));
        let fe = Species::new(Element::Fe, Some(2));
        let o = Species::new(Element::O, Some(-2));

        let structure = Structure::new(
            lattice,
            vec![li, fe, o, o],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.5, 0.5),
                Vector3::new(0.25, 0.25, 0.25),
                Vector3::new(0.75, 0.75, 0.75),
            ],
        );

        let result = structure.remove_species(&[li, fe]).unwrap();

        assert_eq!(result.num_sites(), 2);
        assert!(
            result
                .site_occupancies
                .iter()
                .all(|s| s.dominant_species().element == Element::O)
        );
    }

    #[test]
    fn test_remove_nonexistent_species() {
        let structure = nacl_structure();
        let result = structure
            .remove_species(&[Species::neutral(Element::Fe)])
            .unwrap();

        assert_eq!(result.num_sites(), structure.num_sites());
    }

    // ========== deform tests ==========

    #[test]
    fn test_deform_volumetric() {
        for ratio in [0.9_f64, 1.0, 1.1, 1.5] {
            let structure = nacl_structure();
            let original_volume = structure.volume();
            let linear = ratio.cbrt();
            let gradient = Matrix3::from_diagonal(&Vector3::new(linear, linear, linear));
            let deformed = structure.deform(gradient).unwrap();
            assert_relative_eq!(deformed.volume(), original_volume * ratio, epsilon = 1e-10);
        }
    }

    #[test]
    fn test_deform_uniaxial_all_axes() {
        for axis in 0..3 {
            let structure = nacl_structure();
            let original_lengths = structure.lattice.lengths();

            let mut diag = Vector3::new(1.0, 1.0, 1.0);
            diag[axis] = 1.05;
            let gradient = Matrix3::from_diagonal(&diag);
            let deformed = structure.deform(gradient).unwrap();

            let new_lengths = deformed.lattice.lengths();
            assert_relative_eq!(
                new_lengths[axis],
                original_lengths[axis] * 1.05,
                epsilon = 1e-10
            );
            // Other lengths unchanged
            for other in 0..3 {
                if other != axis {
                    assert_relative_eq!(
                        new_lengths[other],
                        original_lengths[other],
                        epsilon = 1e-10
                    );
                }
            }
        }
    }

    #[test]
    fn test_deform_shear_preserves_volume() {
        let structure = nacl_structure();
        let original_volume = structure.volume();
        let shear = Matrix3::new(1.0, 0.1, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
        let deformed = structure.deform(shear).unwrap();
        assert_relative_eq!(deformed.volume(), original_volume, epsilon = 1e-10);
    }

    #[test]
    fn test_deform_triclinic() {
        let structure = triclinic_li2o();
        let original_volume = structure.volume();
        let linear = 1.5_f64.cbrt();
        let gradient = Matrix3::from_diagonal(&Vector3::new(linear, linear, linear));
        let deformed = structure.deform(gradient).unwrap();
        assert_relative_eq!(deformed.volume(), original_volume * 1.5, epsilon = 1e-8);
    }

    // ========== perturb tests ==========

    #[test]
    fn test_perturb() {
        let structure = nacl_structure();
        let perturbed = structure.perturb_copy(0.1, Some(42)).unwrap();

        // Sites should have moved
        for (orig_fc, pert_fc) in structure
            .frac_coords
            .iter()
            .zip(perturbed.frac_coords.iter())
        {
            assert_ne!(orig_fc, pert_fc);
        }

        // Same seed should give same result
        let perturbed2 = structure.perturb_copy(0.1, Some(42)).unwrap();
        for (fc1, fc2) in perturbed
            .frac_coords
            .iter()
            .zip(perturbed2.frac_coords.iter())
        {
            assert_eq!(fc1, fc2);
        }
    }

    #[test]
    fn test_perturb_respects_distance() {
        let structure = nacl_structure();
        let max_displacement = 0.05;
        let perturbed = structure.perturb_copy(max_displacement, Some(123)).unwrap();

        for (orig_fc, pert_fc) in structure
            .frac_coords
            .iter()
            .zip(perturbed.frac_coords.iter())
        {
            let orig_cart = structure.lattice.get_cartesian_coord(orig_fc);
            let pert_cart = perturbed.lattice.get_cartesian_coord(pert_fc);
            let displacement = (orig_cart - pert_cart).norm();

            assert!(
                displacement <= max_displacement + 1e-6,
                "Displacement {} exceeds max {}",
                displacement,
                max_displacement
            );
        }
    }

    #[test]
    fn test_perturb_different_seeds() {
        let structure = nacl_structure();
        let perturbed1 = structure.perturb_copy(0.1, Some(1)).unwrap();
        let perturbed2 = structure.perturb_copy(0.1, Some(2)).unwrap();

        let mut all_same = true;
        for (fc1, fc2) in perturbed1
            .frac_coords
            .iter()
            .zip(perturbed2.frac_coords.iter())
        {
            if fc1 != fc2 {
                all_same = false;
                break;
            }
        }
        assert!(
            !all_same,
            "Different seeds should produce different results"
        );
    }

    #[test]
    fn test_perturb_zero_distance() {
        let structure = nacl_structure();
        let perturbed = structure.perturb_copy(0.0, None).unwrap();

        for (orig_fc, pert_fc) in structure
            .frac_coords
            .iter()
            .zip(perturbed.frac_coords.iter())
        {
            assert_relative_eq!(orig_fc.x, pert_fc.x, epsilon = 1e-10);
            assert_relative_eq!(orig_fc.y, pert_fc.y, epsilon = 1e-10);
            assert_relative_eq!(orig_fc.z, pert_fc.z, epsilon = 1e-10);
        }
    }

    // ========== get_primitive tests ==========

    #[test]
    fn test_primitive_fcc() {
        let structure = fcc_copper();
        let primitive = structure.get_primitive(0.01).unwrap();

        // FCC conventional cell with 4 atoms should reduce to primitive with 1 atom
        assert!(
            primitive.num_sites() < structure.num_sites(),
            "Primitive cell should have fewer atoms"
        );
    }

    #[test]
    fn test_primitive_already_primitive() {
        let structure = single_fe();
        let primitive = structure.get_primitive(0.01).unwrap();

        // Single atom structure should stay single atom
        assert_eq!(primitive.num_sites(), structure.num_sites());
    }

    // ========== get_conventional_structure tests ==========

    #[test]
    fn test_conventional_from_primitive() {
        // Start with BCC Fe
        let a = 2.87;
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(a, a, a)));
        let fe = Species::neutral(Element::Fe);
        let structure = Structure::new(lattice, vec![fe], vec![Vector3::new(0.0, 0.0, 0.0)]);

        let conventional = structure.get_conventional_structure(0.01).unwrap();

        // BCC conventional cell should exist
        assert!(conventional.num_sites() >= 1);
    }

    // ========== Chained transform tests ==========

    #[test]
    fn test_supercell_then_deform() {
        let structure = nacl_structure();
        let supercell = structure
            .make_supercell([[2, 0, 0], [0, 2, 0], [0, 0, 2]])
            .unwrap();
        let ratio = 1.1_f64.cbrt();
        let gradient = Matrix3::from_diagonal(&Vector3::new(ratio, ratio, ratio));
        let deformed = supercell.deform(gradient).unwrap();

        let expected_volume = structure.volume() * 8.0 * 1.1;
        assert_relative_eq!(deformed.volume(), expected_volume, epsilon = 1e-8);
    }

    #[test]
    fn test_substitute_then_remove() {
        let structure = nacl_structure();

        // Substitute Na -> K
        let substituted = structure
            .substitute(
                Species::new(Element::Na, Some(1)),
                Species::new(Element::K, Some(1)),
            )
            .unwrap();

        // Remove K
        let result = substituted
            .remove_species(&[Species::new(Element::K, Some(1))])
            .unwrap();

        // Should only have Cl left
        assert_eq!(result.num_sites(), 1);
        assert_eq!(
            result.site_occupancies[0].dominant_species().element,
            Element::Cl
        );
    }
}
