//! Standard structure transformations.
//!
//! This module contains common one-to-one transformations:
//!
//! - `SupercellTransform`: Create supercells via scaling matrix
//! - `RotateTransform`: Rotate structure around an axis
//! - `SubstituteTransform`: Replace one species with another
//! - `RemoveSpeciesTransform`: Remove all atoms of certain species
//! - `DeformTransform`: Apply deformation gradient to lattice
//! - `PrimitiveTransform`: Find primitive cell
//! - `ConventionalTransform`: Find conventional cell
//! - `PerturbTransform`: Random perturbation of atomic positions

use crate::error::{FerroxError, Result};
use crate::species::Species;
use crate::structure::Structure;
use crate::transformations::Transform;
use nalgebra::{Matrix3, Vector3};
use std::collections::{HashMap, HashSet};

/// Create a supercell via a 3x3 integer scaling matrix.
///
/// The scaling matrix M transforms the lattice vectors as:
/// `new_lattice = M * old_lattice`
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::SupercellTransform;
///
/// // Create a 2x2x2 supercell
/// let transform = SupercellTransform::new([[2, 0, 0], [0, 2, 0], [0, 0, 2]]);
/// transform.apply(&mut structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct SupercellTransform {
    /// 3x3 integer scaling matrix
    pub matrix: [[i32; 3]; 3],
}

impl SupercellTransform {
    /// Create a new supercell transform with the given scaling matrix.
    pub fn new(matrix: [[i32; 3]; 3]) -> Self {
        Self { matrix }
    }

    /// Create a diagonal supercell (nx × ny × nz).
    pub fn diagonal(nx: i32, ny: i32, nz: i32) -> Self {
        Self::new([[nx, 0, 0], [0, ny, 0], [0, 0, nz]])
    }
}

impl Transform for SupercellTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        let supercell = structure.make_supercell(self.matrix)?;
        *structure = supercell;
        Ok(())
    }
}

/// Rotate structure around an arbitrary axis.
///
/// The rotation is applied to both the lattice and atomic positions.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::RotateTransform;
/// use nalgebra::Vector3;
/// use std::f64::consts::PI;
///
/// // Rotate 90 degrees around z-axis
/// let transform = RotateTransform::new(Vector3::z(), PI / 2.0);
/// transform.apply(&mut structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct RotateTransform {
    /// Rotation axis (will be normalized)
    pub axis: Vector3<f64>,
    /// Rotation angle in radians
    pub angle: f64,
}

impl RotateTransform {
    /// Create a new rotation transform.
    ///
    /// # Arguments
    ///
    /// * `axis` - Rotation axis (will be normalized)
    /// * `angle` - Rotation angle in radians
    pub fn new(axis: Vector3<f64>, angle: f64) -> Self {
        Self { axis, angle }
    }

    /// Create a rotation around the x-axis.
    pub fn around_x(angle: f64) -> Self {
        Self::new(Vector3::x(), angle)
    }

    /// Create a rotation around the y-axis.
    pub fn around_y(angle: f64) -> Self {
        Self::new(Vector3::y(), angle)
    }

    /// Create a rotation around the z-axis.
    pub fn around_z(angle: f64) -> Self {
        Self::new(Vector3::z(), angle)
    }

    /// Compute the rotation matrix using Rodrigues' formula.
    ///
    /// Returns an error if the rotation axis has zero length.
    fn rotation_matrix(&self) -> Result<Matrix3<f64>> {
        let axis =
            self.axis
                .try_normalize(f64::EPSILON)
                .ok_or_else(|| FerroxError::TransformError {
                    reason: "rotation axis has zero length".to_string(),
                })?;
        let cos_a = self.angle.cos();
        let sin_a = self.angle.sin();
        let one_minus_cos = 1.0 - cos_a;

        let (ax, ay, az) = (axis.x, axis.y, axis.z);

        Ok(Matrix3::new(
            one_minus_cos * ax * ax + cos_a,
            one_minus_cos * ax * ay - sin_a * az,
            one_minus_cos * ax * az + sin_a * ay,
            one_minus_cos * ax * ay + sin_a * az,
            one_minus_cos * ay * ay + cos_a,
            one_minus_cos * ay * az - sin_a * ax,
            one_minus_cos * ax * az - sin_a * ay,
            one_minus_cos * ay * az + sin_a * ax,
            one_minus_cos * az * az + cos_a,
        ))
    }
}

impl Transform for RotateTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        let rot = self.rotation_matrix()?;

        // Rotate lattice vectors: for columns-as-vectors convention, L_new = R * L
        // This ensures that for a rigid rotation, fractional coordinates are preserved
        let old_matrix = *structure.lattice.matrix();
        let new_matrix = rot * old_matrix;
        structure.lattice =
            crate::lattice::Lattice::from_matrix_with_pbc(new_matrix, structure.lattice.pbc);

        // For a rigid rotation, fractional coordinates remain unchanged since:
        // cart_new = R * cart_old = R * L_old * frac_old
        // L_new = R * L_old
        // frac_new = L_new^-1 * cart_new = (R*L)^-1 * R*L * frac_old = frac_old
        // So we don't need to modify frac_coords at all!

        Ok(())
    }
}

/// Substitute one species for another throughout the structure.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::SubstituteTransform;
/// use ferrox::species::Species;
/// use ferrox::element::Element;
///
/// // Replace all Fe with Co
/// let mut map = HashMap::new();
/// map.insert(Species::neutral(Element::Fe), Species::neutral(Element::Co));
/// let transform = SubstituteTransform::new(map);
/// transform.apply(&mut structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct SubstituteTransform {
    /// Mapping from old species to new species
    pub species_map: HashMap<Species, Species>,
}

impl SubstituteTransform {
    /// Create a new substitution transform.
    pub fn new(species_map: HashMap<Species, Species>) -> Self {
        Self { species_map }
    }

    /// Create a single-species substitution.
    pub fn single(from: Species, to: Species) -> Self {
        let mut map = HashMap::new();
        map.insert(from, to);
        Self::new(map)
    }
}

impl Transform for SubstituteTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        for site_occ in &mut structure.site_occupancies {
            for (species, _) in &mut site_occ.species {
                if let Some(replacement) = self.species_map.get(species) {
                    *species = *replacement;
                }
            }
        }
        Ok(())
    }
}

/// Remove all sites containing certain species.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::RemoveSpeciesTransform;
/// use ferrox::species::Species;
/// use ferrox::element::Element;
///
/// // Remove all lithium atoms
/// let transform = RemoveSpeciesTransform::new(vec![Species::neutral(Element::Li)]);
/// transform.apply(&mut structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct RemoveSpeciesTransform {
    /// Species to remove
    pub species: Vec<Species>,
}

impl RemoveSpeciesTransform {
    /// Create a new remove species transform.
    pub fn new(species: Vec<Species>) -> Self {
        Self { species }
    }

    /// Create a transform to remove a single species.
    pub fn single(species: Species) -> Self {
        Self::new(vec![species])
    }
}

impl Transform for RemoveSpeciesTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        // Use HashSet for O(1) lookup instead of Vec::contains which is O(n)
        let species_to_remove: HashSet<&Species> = self.species.iter().collect();

        // Find indices of sites to keep
        let indices_to_keep: Vec<usize> = structure
            .site_occupancies
            .iter()
            .enumerate()
            .filter(|(_, site_occ)| {
                // Keep site if no species matches the removal list
                !site_occ
                    .species
                    .iter()
                    .any(|(sp, _)| species_to_remove.contains(sp))
            })
            .map(|(idx, _)| idx)
            .collect();

        // Keep only the selected sites
        structure.site_occupancies = indices_to_keep
            .iter()
            .map(|&idx| structure.site_occupancies[idx].clone())
            .collect();
        structure.frac_coords = indices_to_keep
            .iter()
            .map(|&idx| structure.frac_coords[idx])
            .collect();

        Ok(())
    }
}

/// Apply a deformation gradient to the lattice.
///
/// The deformation gradient F transforms the lattice as:
/// `new_lattice = F * old_lattice`
///
/// For small strains, F ≈ I + ε where ε is the strain tensor.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::DeformTransform;
/// use nalgebra::Matrix3;
///
/// // Apply 1% tensile strain along x
/// let f = Matrix3::new(
///     1.01, 0.0, 0.0,
///     0.0, 1.0, 0.0,
///     0.0, 0.0, 1.0,
/// );
/// let transform = DeformTransform::new(f);
/// transform.apply(&mut structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct DeformTransform {
    /// Deformation gradient tensor (3x3 matrix)
    pub gradient: Matrix3<f64>,
}

impl DeformTransform {
    /// Create a new deformation transform.
    pub fn new(gradient: Matrix3<f64>) -> Self {
        Self { gradient }
    }

    /// Create a deformation from a strain tensor (F = I + strain).
    pub fn from_strain(strain: Matrix3<f64>) -> Self {
        Self::new(Matrix3::identity() + strain)
    }

    /// Create a volumetric strain (isotropic expansion/contraction).
    ///
    /// # Arguments
    ///
    /// * `ratio` - Volume ratio (1.0 = no change, 1.1 = 10% expansion)
    pub fn volumetric(ratio: f64) -> Self {
        let linear = ratio.cbrt();
        Self::new(Matrix3::from_diagonal(&Vector3::new(
            linear, linear, linear,
        )))
    }

    /// Create a uniaxial strain along a given axis.
    ///
    /// # Arguments
    ///
    /// * `axis` - 0 for x, 1 for y, 2 for z
    /// * `strain` - Engineering strain (0.01 = 1% elongation)
    pub fn uniaxial(axis: usize, strain: f64) -> Self {
        let mut diag = Vector3::new(1.0, 1.0, 1.0);
        diag[axis] = 1.0 + strain;
        Self::new(Matrix3::from_diagonal(&diag))
    }
}

impl Transform for DeformTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        // Apply deformation to lattice
        let new_matrix = self.gradient * structure.lattice.matrix();
        structure.lattice =
            crate::lattice::Lattice::from_matrix_with_pbc(new_matrix, structure.lattice.pbc);
        // Fractional coordinates remain unchanged (they're relative to the lattice)
        Ok(())
    }
}

/// Find the primitive cell of a structure.
///
/// Uses symmetry analysis to find the smallest unit cell that, when repeated
/// with translational symmetry, generates the original structure.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::PrimitiveTransform;
///
/// let transform = PrimitiveTransform::new(0.01);
/// let primitive = transform.applied(&structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct PrimitiveTransform {
    /// Symmetry precision for spacegroup detection
    pub symprec: f64,
}

impl PrimitiveTransform {
    /// Create a new primitive cell transform.
    pub fn new(symprec: f64) -> Self {
        Self { symprec }
    }
}

impl Default for PrimitiveTransform {
    fn default() -> Self {
        Self { symprec: 0.01 }
    }
}

impl Transform for PrimitiveTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        let primitive = structure.get_primitive(self.symprec)?;
        *structure = primitive;
        Ok(())
    }
}

/// Find the conventional cell of a structure.
///
/// Uses symmetry analysis to find the conventional unit cell based on the
/// spacegroup's standard setting.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::ConventionalTransform;
///
/// let transform = ConventionalTransform::new(0.01);
/// let conventional = transform.applied(&structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct ConventionalTransform {
    /// Symmetry precision for spacegroup detection
    pub symprec: f64,
}

impl ConventionalTransform {
    /// Create a new conventional cell transform.
    pub fn new(symprec: f64) -> Self {
        Self { symprec }
    }
}

impl Default for ConventionalTransform {
    fn default() -> Self {
        Self { symprec: 0.01 }
    }
}

impl Transform for ConventionalTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        let conventional = structure.get_conventional_structure(self.symprec)?;
        *structure = conventional;
        Ok(())
    }
}

/// Randomly perturb atomic positions.
///
/// Each site is translated by a random vector with magnitude uniformly
/// distributed in [min_distance, distance].
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::PerturbTransform;
///
/// // Perturb all atoms by up to 0.1 Å
/// let transform = PerturbTransform::new(0.1).with_seed(42);
/// transform.apply(&mut structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct PerturbTransform {
    /// Maximum perturbation distance in Angstroms
    pub distance: f64,
    /// Minimum perturbation distance (default: 0)
    pub min_distance: Option<f64>,
    /// Random seed for reproducibility
    pub seed: Option<u64>,
}

impl PerturbTransform {
    /// Create a new perturbation transform.
    pub fn new(distance: f64) -> Self {
        Self {
            distance,
            min_distance: None,
            seed: None,
        }
    }

    /// Set the minimum perturbation distance.
    pub fn with_min_distance(mut self, min_distance: f64) -> Self {
        self.min_distance = Some(min_distance);
        self
    }

    /// Set the random seed for reproducibility.
    pub fn with_seed(mut self, seed: u64) -> Self {
        self.seed = Some(seed);
        self
    }
}

impl Transform for PerturbTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        structure.perturb(self.distance, self.min_distance, self.seed);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;
    use crate::lattice::Lattice;
    use approx::assert_relative_eq;
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

    // ========== SupercellTransform Tests ==========

    #[test]
    fn test_supercell_diagonal() {
        let mut structure = nacl_structure();
        let transform = SupercellTransform::diagonal(2, 2, 2);
        transform.apply(&mut structure).unwrap();

        // 2x2x2 supercell should have 8x more atoms
        assert_eq!(structure.num_sites(), 16);

        // Volume should be 8x larger
        let expected_volume = 5.64_f64.powi(3) * 8.0;
        assert_relative_eq!(structure.volume(), expected_volume, epsilon = 1e-10);
    }

    #[test]
    fn test_supercell_matrix() {
        let mut structure = nacl_structure();
        let transform = SupercellTransform::new([[2, 0, 0], [0, 1, 0], [0, 0, 1]]);
        transform.apply(&mut structure).unwrap();

        // 2x1x1 supercell should have 2x more atoms
        assert_eq!(structure.num_sites(), 4);
    }

    #[test]
    fn test_supercell_asymmetric() {
        let mut structure = nacl_structure();
        let original_sites = structure.num_sites();
        let transform = SupercellTransform::diagonal(3, 2, 1);
        transform.apply(&mut structure).unwrap();

        assert_eq!(structure.num_sites(), original_sites * 6);
        let expected_volume = 5.64_f64.powi(3) * 6.0;
        assert_relative_eq!(structure.volume(), expected_volume, epsilon = 1e-10);
    }

    #[test]
    fn test_supercell_off_diagonal() {
        let mut structure = nacl_structure();
        // Non-diagonal transformation matrix
        let transform = SupercellTransform::new([[1, 1, 0], [0, 1, 1], [1, 0, 1]]);
        transform.apply(&mut structure).unwrap();

        // Determinant is 2, so 2x more atoms
        assert_eq!(structure.num_sites(), 4);
    }

    #[test]
    fn test_supercell_identity() {
        let original = nacl_structure();
        let mut structure = original.clone();
        let transform = SupercellTransform::diagonal(1, 1, 1);
        transform.apply(&mut structure).unwrap();

        assert_eq!(structure.num_sites(), original.num_sites());
        assert_relative_eq!(structure.volume(), original.volume(), epsilon = 1e-10);
    }

    #[test]
    fn test_supercell_single_atom() {
        let mut structure = single_fe();
        let transform = SupercellTransform::diagonal(3, 3, 3);
        transform.apply(&mut structure).unwrap();

        assert_eq!(structure.num_sites(), 27);
    }

    #[test]
    fn test_supercell_preserves_composition_ratio() {
        let mut structure = nacl_structure();
        let transform = SupercellTransform::diagonal(4, 3, 2);
        transform.apply(&mut structure).unwrap();

        let na_count = structure
            .site_occupancies
            .iter()
            .filter(|s| s.dominant_species().element == Element::Na)
            .count();
        let cl_count = structure
            .site_occupancies
            .iter()
            .filter(|s| s.dominant_species().element == Element::Cl)
            .count();

        // 1:1 ratio should be preserved
        assert_eq!(na_count, cl_count);
        assert_eq!(na_count, 24); // 2 * 4 * 3 * 2 / 2 = 24 Na atoms
    }

    // ========== RotateTransform Tests ==========

    #[test]
    fn test_rotate_preserves_volume() {
        // Test various rotation axes and angles all preserve volume
        let rotations = [
            RotateTransform::around_x(FRAC_PI_4),
            RotateTransform::around_y(FRAC_PI_4),
            RotateTransform::around_z(FRAC_PI_2),
            RotateTransform::new(Vector3::new(1.0, 1.0, 1.0), FRAC_PI_2), // arbitrary axis
        ];
        let expected_volume = 5.64_f64.powi(3);

        for transform in rotations {
            let mut structure = nacl_structure();
            transform.apply(&mut structure).unwrap();
            assert_relative_eq!(structure.volume(), expected_volume, epsilon = 1e-8);
        }
    }

    #[test]
    fn test_rotate_360_is_identity() {
        let original = nacl_structure();
        let mut structure = original.clone();
        RotateTransform::around_z(2.0 * PI)
            .apply(&mut structure)
            .unwrap();

        assert_relative_eq!(structure.volume(), original.volume(), epsilon = 1e-10);
        for (orig, rotated) in original
            .frac_coords
            .iter()
            .zip(structure.frac_coords.iter())
        {
            assert_relative_eq!(orig.x, rotated.x, epsilon = 1e-10);
            assert_relative_eq!(orig.y, rotated.y, epsilon = 1e-10);
            assert_relative_eq!(orig.z, rotated.z, epsilon = 1e-10);
        }
    }

    #[test]
    fn test_rotate_inverse() {
        let original = nacl_structure();
        let mut structure = original.clone();

        RotateTransform::around_z(FRAC_PI_4)
            .apply(&mut structure)
            .unwrap();
        RotateTransform::around_z(-FRAC_PI_4)
            .apply(&mut structure)
            .unwrap();

        for (orig, final_fc) in original
            .frac_coords
            .iter()
            .zip(structure.frac_coords.iter())
        {
            assert_relative_eq!(orig.x, final_fc.x, epsilon = 1e-10);
            assert_relative_eq!(orig.y, final_fc.y, epsilon = 1e-10);
            assert_relative_eq!(orig.z, final_fc.z, epsilon = 1e-10);
        }
    }

    #[test]
    fn test_rotate_zero_axis_error() {
        let mut structure = nacl_structure();
        let transform = RotateTransform::new(Vector3::zeros(), FRAC_PI_4);
        let result = transform.apply(&mut structure);

        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("zero length"),
            "Error should mention zero length axis: {err_msg}"
        );
    }

    #[test]
    fn test_rotate_preserves_frac_coords() {
        // For a rigid rotation where both lattice and atoms rotate together,
        // the fractional coordinates should remain unchanged
        let structure = nacl_structure();
        let original_frac = structure.frac_coords.clone();

        // Apply various rotations
        for transform in [
            RotateTransform::around_x(FRAC_PI_4),
            RotateTransform::around_y(FRAC_PI_3),
            RotateTransform::around_z(FRAC_PI_2),
            RotateTransform::new(Vector3::new(1.0, 1.0, 1.0), 0.7),
        ] {
            let mut s = structure.clone();
            transform.apply(&mut s).unwrap();

            // Fractional coordinates should be preserved (or very close due to numerical precision)
            for (orig, rotated) in original_frac.iter().zip(s.frac_coords.iter()) {
                assert_relative_eq!(orig.x, rotated.x, epsilon = 1e-10);
                assert_relative_eq!(orig.y, rotated.y, epsilon = 1e-10);
                assert_relative_eq!(orig.z, rotated.z, epsilon = 1e-10);
            }
        }
    }

    #[test]
    fn test_rotate_cartesian_coords_change() {
        // While frac coords stay the same, Cartesian coords SHOULD change after rotation
        let mut structure = nacl_structure();
        let original_cart: Vec<_> = structure
            .frac_coords
            .iter()
            .map(|fc| structure.lattice.matrix() * fc)
            .collect();

        // Apply a 90-degree rotation around z
        RotateTransform::around_z(FRAC_PI_2)
            .apply(&mut structure)
            .unwrap();

        let new_cart: Vec<_> = structure
            .frac_coords
            .iter()
            .map(|fc| structure.lattice.matrix() * fc)
            .collect();

        // Cartesian coords should differ (unless the atom is at origin)
        // The second atom at (0.5, 0.5, 0.5) in frac should have different cart coords
        let orig_second = &original_cart[1];
        let new_second = &new_cart[1];

        // After 90° rotation around z: (x, y, z) -> (-y, x, z)
        // Check that coordinates changed appropriately
        assert!(
            (orig_second - new_second).norm() > 1e-10 || orig_second.norm() < 1e-10,
            "Cartesian coords should change after rotation (unless at origin)"
        );
    }

    // ========== SubstituteTransform Tests ==========

    #[test]
    fn test_substitute() {
        let mut structure = nacl_structure();
        let transform = SubstituteTransform::single(
            Species::new(Element::Na, Some(1)),
            Species::new(Element::K, Some(1)),
        );
        transform.apply(&mut structure).unwrap();

        // Check that Na was replaced with K
        let first_site = &structure.site_occupancies[0];
        assert_eq!(first_site.dominant_species().element, Element::K);
    }

    #[test]
    fn test_substitute_multiple() {
        let mut structure = nacl_structure();
        let mut subs = HashMap::new();
        subs.insert(
            Species::new(Element::Na, Some(1)),
            Species::new(Element::K, Some(1)),
        );
        subs.insert(
            Species::new(Element::Cl, Some(-1)),
            Species::new(Element::Br, Some(-1)),
        );

        let transform = SubstituteTransform::new(subs);
        transform.apply(&mut structure).unwrap();

        // Check both substitutions occurred
        let site_elements: Vec<Element> = structure
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
        let mut structure = nacl_structure();
        let transform = SubstituteTransform::single(
            Species::neutral(Element::Fe), // Fe not in structure
            Species::neutral(Element::Co),
        );
        transform.apply(&mut structure).unwrap();

        // Structure should be unchanged
        assert_eq!(
            structure.site_occupancies[0].dominant_species().element,
            Element::Na
        );
    }

    #[test]
    fn test_substitute_preserves_oxidation_state() {
        let mut structure = nacl_structure();
        let transform = SubstituteTransform::single(
            Species::new(Element::Na, Some(1)),
            Species::new(Element::K, Some(1)),
        );
        transform.apply(&mut structure).unwrap();

        assert_eq!(
            structure.site_occupancies[0]
                .dominant_species()
                .oxidation_state,
            Some(1)
        );
    }

    // ========== RemoveSpeciesTransform Tests ==========

    #[test]
    fn test_remove_species() {
        let mut structure = nacl_structure();
        let transform = RemoveSpeciesTransform::single(Species::new(Element::Na, Some(1)));
        transform.apply(&mut structure).unwrap();

        // Should only have Cl left
        assert_eq!(structure.num_sites(), 1);
        assert_eq!(
            structure.site_occupancies[0].dominant_species().element,
            Element::Cl
        );
    }

    #[test]
    fn test_remove_multiple_species() {
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(4.0, 4.0, 4.0)));
        let li = Species::new(Element::Li, Some(1));
        let fe = Species::new(Element::Fe, Some(2));
        let o = Species::new(Element::O, Some(-2));

        let mut structure = Structure::new(
            lattice,
            vec![li, fe, o, o],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.5, 0.5),
                Vector3::new(0.25, 0.25, 0.25),
                Vector3::new(0.75, 0.75, 0.75),
            ],
        );

        let transform = RemoveSpeciesTransform::new(vec![li, fe]);
        transform.apply(&mut structure).unwrap();

        assert_eq!(structure.num_sites(), 2);
        assert!(
            structure
                .site_occupancies
                .iter()
                .all(|s| s.dominant_species().element == Element::O)
        );
    }

    #[test]
    fn test_remove_nonexistent_species() {
        let mut structure = nacl_structure();
        let original_sites = structure.num_sites();
        let transform = RemoveSpeciesTransform::single(Species::neutral(Element::Fe));
        transform.apply(&mut structure).unwrap();

        // Should be unchanged
        assert_eq!(structure.num_sites(), original_sites);
    }

    // ========== DeformTransform Tests ==========

    #[test]
    fn test_deform_volumetric() {
        // Test expansion and compression
        for ratio in [0.9, 1.0, 1.1, 1.5] {
            let mut structure = nacl_structure();
            let original_volume = structure.volume();
            DeformTransform::volumetric(ratio)
                .apply(&mut structure)
                .unwrap();
            assert_relative_eq!(structure.volume(), original_volume * ratio, epsilon = 1e-10);
        }
    }

    #[test]
    fn test_deform_uniaxial_all_axes() {
        for axis in 0..3 {
            let mut structure = nacl_structure();
            let original_lengths = structure.lattice.lengths();
            DeformTransform::uniaxial(axis, 0.05)
                .apply(&mut structure)
                .unwrap();

            let new_lengths = structure.lattice.lengths();
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
        let mut structure = nacl_structure();
        let original_volume = structure.volume();
        let shear = Matrix3::new(1.0, 0.1, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
        DeformTransform::new(shear).apply(&mut structure).unwrap();
        assert_relative_eq!(structure.volume(), original_volume, epsilon = 1e-10);
    }

    // ========== PerturbTransform Tests ==========

    #[test]
    fn test_perturb() {
        let original = nacl_structure();
        let mut perturbed = original.clone();

        let transform = PerturbTransform::new(0.1).with_seed(42);
        transform.apply(&mut perturbed).unwrap();

        // Sites should have moved
        for (orig_fc, pert_fc) in original
            .frac_coords
            .iter()
            .zip(perturbed.frac_coords.iter())
        {
            assert_ne!(orig_fc, pert_fc);
        }

        // Same seed should give same result
        let mut perturbed2 = original.clone();
        let transform2 = PerturbTransform::new(0.1).with_seed(42);
        transform2.apply(&mut perturbed2).unwrap();

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
        let original = nacl_structure();
        let mut perturbed = original.clone();
        let max_displacement = 0.05;

        let transform = PerturbTransform::new(max_displacement).with_seed(123);
        transform.apply(&mut perturbed).unwrap();

        // Calculate Cartesian displacement for each site
        for (orig_fc, pert_fc) in original
            .frac_coords
            .iter()
            .zip(perturbed.frac_coords.iter())
        {
            let orig_cart = original.lattice.get_cartesian_coord(orig_fc);
            let pert_cart = perturbed.lattice.get_cartesian_coord(pert_fc);
            let displacement = (orig_cart - pert_cart).norm();

            // Displacement should be within bounds (with small tolerance)
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
        let original = nacl_structure();

        let mut perturbed1 = original.clone();
        let transform1 = PerturbTransform::new(0.1).with_seed(1);
        transform1.apply(&mut perturbed1).unwrap();

        let mut perturbed2 = original.clone();
        let transform2 = PerturbTransform::new(0.1).with_seed(2);
        transform2.apply(&mut perturbed2).unwrap();

        // Different seeds should give different results
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
        let original = nacl_structure();
        let mut perturbed = original.clone();

        let transform = PerturbTransform::new(0.0);
        transform.apply(&mut perturbed).unwrap();

        // With zero distance, structure should be unchanged
        for (orig_fc, pert_fc) in original
            .frac_coords
            .iter()
            .zip(perturbed.frac_coords.iter())
        {
            assert_relative_eq!(orig_fc.x, pert_fc.x, epsilon = 1e-10);
            assert_relative_eq!(orig_fc.y, pert_fc.y, epsilon = 1e-10);
            assert_relative_eq!(orig_fc.z, pert_fc.z, epsilon = 1e-10);
        }
    }

    // ========== PrimitiveTransform Tests ==========

    #[test]
    fn test_primitive_fcc() {
        let mut structure = fcc_copper();
        let original_sites = structure.num_sites();

        let transform = PrimitiveTransform::new(0.01);
        transform.apply(&mut structure).unwrap();

        // FCC conventional cell with 4 atoms should reduce to primitive with 1 atom
        assert!(
            structure.num_sites() < original_sites,
            "Primitive cell should have fewer atoms"
        );
    }

    #[test]
    fn test_primitive_already_primitive() {
        let mut structure = single_fe();
        let original_sites = structure.num_sites();

        let transform = PrimitiveTransform::new(0.01);
        transform.apply(&mut structure).unwrap();

        // Single atom structure should stay single atom
        assert_eq!(structure.num_sites(), original_sites);
    }

    // ========== ConventionalTransform Tests ==========

    #[test]
    fn test_conventional_from_primitive() {
        // Start with BCC Fe
        let a = 2.87;
        let lattice = Lattice::new(Matrix3::from_diagonal(&Vector3::new(a, a, a)));
        let fe = Species::neutral(Element::Fe);
        let mut structure = Structure::new(lattice, vec![fe], vec![Vector3::new(0.0, 0.0, 0.0)]);

        let transform = ConventionalTransform::new(0.01);
        transform.apply(&mut structure).unwrap();

        // BCC conventional cell should exist
        assert!(structure.num_sites() >= 1);
    }

    // ========== Transform Trait Tests (applied method) ==========

    #[test]
    fn test_applied_creates_new_structure() {
        let original = nacl_structure();
        let transform = SupercellTransform::diagonal(2, 2, 2);

        let new_struct = transform.applied(&original).unwrap();

        // Original unchanged
        assert_eq!(original.num_sites(), 2);
        // New structure modified
        assert_eq!(new_struct.num_sites(), 16);
    }

    #[test]
    fn test_applied_vs_apply_equivalence() {
        let original = nacl_structure();
        let transform = DeformTransform::volumetric(1.2);

        let new_struct = transform.applied(&original).unwrap();

        let mut in_place = original.clone();
        transform.apply(&mut in_place).unwrap();

        assert_relative_eq!(new_struct.volume(), in_place.volume(), epsilon = 1e-10);
        assert_eq!(new_struct.num_sites(), in_place.num_sites());
    }

    // ========== Triclinic Structure Tests ==========

    #[test]
    fn test_supercell_triclinic() {
        let mut structure = triclinic_li2o();
        let original_sites = structure.num_sites();
        let original_volume = structure.volume();

        let transform = SupercellTransform::diagonal(2, 2, 2);
        transform.apply(&mut structure).unwrap();

        assert_eq!(structure.num_sites(), original_sites * 8);
        assert_relative_eq!(structure.volume(), original_volume * 8.0, epsilon = 1e-8);
    }

    #[test]
    fn test_deform_triclinic() {
        let mut structure = triclinic_li2o();
        let original_volume = structure.volume();

        let transform = DeformTransform::volumetric(1.5);
        transform.apply(&mut structure).unwrap();

        assert_relative_eq!(structure.volume(), original_volume * 1.5, epsilon = 1e-8);
    }

    // ========== Chained Transform Tests ==========

    #[test]
    fn test_supercell_then_deform() {
        let original = nacl_structure();
        let mut structure = original.clone();

        let supercell = SupercellTransform::diagonal(2, 2, 2);
        supercell.apply(&mut structure).unwrap();

        let deform = DeformTransform::volumetric(1.1);
        deform.apply(&mut structure).unwrap();

        let expected_volume = original.volume() * 8.0 * 1.1;
        assert_relative_eq!(structure.volume(), expected_volume, epsilon = 1e-8);
    }

    #[test]
    fn test_substitute_then_remove() {
        let mut structure = nacl_structure();

        // Substitute Na -> K
        let sub = SubstituteTransform::single(
            Species::new(Element::Na, Some(1)),
            Species::new(Element::K, Some(1)),
        );
        sub.apply(&mut structure).unwrap();

        // Remove K
        let remove = RemoveSpeciesTransform::single(Species::new(Element::K, Some(1)));
        remove.apply(&mut structure).unwrap();

        // Should only have Cl left
        assert_eq!(structure.num_sites(), 1);
        assert_eq!(
            structure.site_occupancies[0].dominant_species().element,
            Element::Cl
        );
    }
}
