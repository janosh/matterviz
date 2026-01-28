//! Crystal structure representation.
//!
//! This module provides the `Structure` type for representing crystal structures
//! with a lattice, species, and fractional coordinates.

use crate::composition::Composition;
use crate::element::Element;
use crate::error::{FerroxError, Result};
use crate::lattice::Lattice;
use crate::species::Species;
use moyo::base::{AngleTolerance, Cell as MoyoCell, Lattice as MoyoLattice};
use moyo::data::Setting;
use moyo::MoyoDataset;
use nalgebra::{Matrix3, Vector3};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A crystal structure with lattice, species, and coordinates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Structure {
    /// The crystal lattice.
    pub lattice: Lattice,
    /// Species at each site.
    pub species: Vec<Species>,
    /// Fractional coordinates for each site.
    pub frac_coords: Vec<Vector3<f64>>,
    /// Optional properties (for caching).
    #[serde(default)]
    pub properties: HashMap<String, serde_json::Value>,
}

impl Structure {
    /// Try to create a new structure, returning an error if inputs are invalid.
    ///
    /// # Errors
    ///
    /// Returns `FerroxError::InvalidStructure` if `species.len() != frac_coords.len()`.
    pub fn try_new(
        lattice: Lattice,
        species: Vec<Species>,
        frac_coords: Vec<Vector3<f64>>,
    ) -> Result<Self> {
        if species.len() != frac_coords.len() {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "species and frac_coords must have same length: {} vs {}",
                    species.len(),
                    frac_coords.len()
                ),
            });
        }
        Ok(Self {
            lattice,
            species,
            frac_coords,
            properties: HashMap::new(),
        })
    }

    /// Create a new structure.
    ///
    /// # Panics
    ///
    /// Panics if `species.len() != frac_coords.len()`.
    /// For fallible construction, use [`Structure::try_new`] instead.
    pub fn new(
        lattice: Lattice,
        species: Vec<Species>,
        frac_coords: Vec<Vector3<f64>>,
    ) -> Self {
        Self::try_new(lattice, species, frac_coords)
            .expect("species and frac_coords must have same length")
    }

    /// Get the number of sites in the structure.
    pub fn num_sites(&self) -> usize {
        self.species.len()
    }

    /// Get the composition of the structure.
    pub fn composition(&self) -> Composition {
        // Use BTreeMap for deterministic iteration order (sorted by element)
        let mut counts: std::collections::BTreeMap<Element, f64> = std::collections::BTreeMap::new();
        for sp in &self.species {
            *counts.entry(sp.element).or_insert(0.0) += 1.0;
        }
        Composition::new(counts)
    }

    /// Get Cartesian coordinates.
    pub fn cart_coords(&self) -> Vec<Vector3<f64>> {
        self.lattice.get_cartesian_coords(&self.frac_coords)
    }

    /// Convert to moyo::base::Cell for symmetry analysis.
    ///
    /// This creates a moyo Cell from the structure's lattice, positions,
    /// and atomic numbers (derived from species).
    pub fn to_moyo_cell(&self) -> MoyoCell {
        let m = self.lattice.matrix();
        let moyo_matrix = Matrix3::new(
            m[(0, 0)],
            m[(0, 1)],
            m[(0, 2)],
            m[(1, 0)],
            m[(1, 1)],
            m[(1, 2)],
            m[(2, 0)],
            m[(2, 1)],
            m[(2, 2)],
        );
        let moyo_lattice = MoyoLattice::new(moyo_matrix);
        let positions: Vec<Vector3<f64>> = self.frac_coords.clone();
        let numbers: Vec<i32> = self
            .species
            .iter()
            .map(|sp| sp.element.atomic_number() as i32)
            .collect();

        MoyoCell::new(moyo_lattice, positions, numbers)
    }

    /// Create Structure from moyo::base::Cell.
    ///
    /// Note: moyo Cell only has atomic numbers, not full species info.
    /// This method creates neutral Species from atomic numbers.
    ///
    /// # Arguments
    ///
    /// * `cell` - The moyo Cell to convert
    ///
    /// # Returns
    ///
    /// A Structure with neutral species matching the atomic numbers.
    pub fn from_moyo_cell(cell: &MoyoCell) -> Result<Self> {
        let lattice = Lattice::new(cell.lattice.basis);
        let species: Vec<Species> = cell
            .numbers
            .iter()
            .enumerate()
            .map(|(idx, &n)| {
                let elem = Element::from_atomic_number(n as u8).ok_or_else(|| {
                    FerroxError::InvalidStructure {
                        index: idx,
                        reason: format!("Invalid atomic number: {n}"),
                    }
                })?;
                Ok(Species::neutral(elem))
            })
            .collect::<Result<Vec<_>>>()?;
        let frac_coords = cell.positions.clone();

        Structure::try_new(lattice, species, frac_coords)
    }

    /// Get the primitive cell using moyo symmetry analysis.
    ///
    /// This finds the symmetry of the structure and returns the
    /// primitive standardized cell.
    ///
    /// # Arguments
    ///
    /// * `symprec` - Symmetry precision (typically 1e-4 to 1e-2)
    ///
    /// # Returns
    ///
    /// Primitive cell Structure, or error if symmetry analysis fails.
    pub fn get_primitive(&self, symprec: f64) -> Result<Self> {
        let moyo_cell = self.to_moyo_cell();

        let dataset = MoyoDataset::new(
            &moyo_cell,
            symprec,
            AngleTolerance::Default,
            Setting::Standard,
        )
        .map_err(|e| FerroxError::MoyoError {
            index: 0,
            reason: format!("{e:?}"),
        })?;

        // prim_std_cell is the primitive standardized cell
        Self::from_moyo_cell(&dataset.prim_std_cell)
    }

    /// Get the spacegroup number using moyo.
    ///
    /// # Arguments
    ///
    /// * `symprec` - Symmetry precision (typically 1e-4 to 1e-2)
    ///
    /// # Returns
    ///
    /// Spacegroup number (1-230), or error if analysis fails.
    pub fn get_spacegroup_number(&self, symprec: f64) -> Result<i32> {
        let moyo_cell = self.to_moyo_cell();

        let dataset = MoyoDataset::new(
            &moyo_cell,
            symprec,
            AngleTolerance::Default,
            Setting::Standard,
        )
        .map_err(|e| FerroxError::MoyoError {
            index: 0,
            reason: format!("{e:?}"),
        })?;

        Ok(dataset.number)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;

    fn make_nacl() -> Structure {
        let lattice = Lattice::cubic(5.64);
        let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        Structure::new(lattice, species, coords)
    }

    fn make_fcc_conventional(element: Element, a: f64) -> Structure {
        let lattice = Lattice::cubic(a);
        let species = vec![
            Species::neutral(element),
            Species::neutral(element),
            Species::neutral(element),
            Species::neutral(element),
        ];
        let coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.0),
            Vector3::new(0.5, 0.0, 0.5),
            Vector3::new(0.0, 0.5, 0.5),
        ];
        Structure::new(lattice, species, coords)
    }

    #[test]
    fn test_new() {
        let lattice = Lattice::cubic(4.0);
        let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];

        let structure = Structure::new(lattice, species, coords);
        assert_eq!(structure.num_sites(), 2);
    }

    #[test]
    fn test_try_new_success() {
        let lattice = Lattice::cubic(4.0);
        let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];

        let result = Structure::try_new(lattice, species, coords);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().num_sites(), 2);
    }

    #[test]
    fn test_try_new_length_mismatch() {
        let lattice = Lattice::cubic(4.0);
        let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0)]; // Only 1 coord for 2 species

        let result = Structure::try_new(lattice, species, coords);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("same length"));
        assert!(err.to_string().contains("2 vs 1"));
    }

    #[test]
    fn test_composition() {
        let lattice = Lattice::cubic(4.0);
        let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];

        let structure = Structure::new(lattice, species, coords);
        let comp = structure.composition();
        assert_eq!(comp.reduced_formula(), "NaCl");
    }

    #[test]
    fn test_to_moyo_cell() {
        let s = make_nacl();
        let cell = s.to_moyo_cell();

        assert_eq!(cell.num_atoms(), 2);
        assert_eq!(cell.numbers, vec![11, 17]); // Na=11, Cl=17
    }

    #[test]
    fn test_from_moyo_cell_roundtrip() {
        let s = make_nacl();
        let cell = s.to_moyo_cell();
        let s2 = Structure::from_moyo_cell(&cell).unwrap();

        assert_eq!(s2.num_sites(), s.num_sites());
        assert_eq!(s2.species[0].element, Element::Na);
        assert_eq!(s2.species[1].element, Element::Cl);
    }

    #[test]
    fn test_get_primitive_fcc() {
        // FCC conventional cell (4 atoms) -> primitive (1 atom)
        let fcc_conv = make_fcc_conventional(Element::Cu, 3.6);
        assert_eq!(fcc_conv.num_sites(), 4);

        let prim = fcc_conv.get_primitive(1e-4).unwrap();
        assert_eq!(prim.num_sites(), 1);
        assert_eq!(prim.species[0].element, Element::Cu);
    }

    #[test]
    fn test_get_primitive_already_primitive() {
        // Simple cubic is already primitive
        let lattice = Lattice::cubic(2.87);
        let s = Structure::new(
            lattice,
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );

        let prim = s.get_primitive(1e-4).unwrap();
        assert_eq!(prim.num_sites(), s.num_sites());
    }

    #[test]
    fn test_get_spacegroup_number() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        let sg = fcc.get_spacegroup_number(1e-4).unwrap();
        assert_eq!(sg, 225); // Fm-3m for FCC
    }

    fn make_bcc(element: Element, a: f64) -> Structure {
        let lattice = Lattice::cubic(a);
        let species = vec![Species::neutral(element), Species::neutral(element)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        Structure::new(lattice, species, coords)
    }

    #[test]
    fn test_structure_basics() {
        let s = make_nacl();

        // num_sites, volume, clone
        assert_eq!(s.num_sites(), 2);
        assert!((s.lattice.volume() - 5.64_f64.powi(3)).abs() < 1e-6);

        let s2 = s.clone();
        assert_eq!(s.num_sites(), s2.num_sites());

        // composition
        let comp = s.composition();
        assert_eq!(comp.num_elements(), 2);
        assert_eq!(comp.reduced_formula(), "NaCl");
    }

    #[test]
    fn test_spacegroups() {
        // FCC Cu: 225 (Fm-3m)
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        assert_eq!(fcc.get_spacegroup_number(1e-4).unwrap(), 225);

        // BCC Fe: 229 (Im-3m)
        let bcc = make_bcc(Element::Fe, 2.87);
        assert_eq!(bcc.get_spacegroup_number(1e-4).unwrap(), 229);

        // CsCl-type NaCl: 221 (Pm-3m)
        let nacl = make_nacl();
        assert_eq!(nacl.get_spacegroup_number(1e-4).unwrap(), 221);
    }

    #[test]
    fn test_get_primitive() {
        // FCC conventional (4 atoms) -> primitive (1 atom)
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        assert_eq!(fcc.num_sites(), 4);
        let prim = fcc.get_primitive(1e-4).unwrap();
        assert_eq!(prim.num_sites(), 1);

        // BCC conventional (2 atoms) -> primitive (1 atom)
        let bcc = make_bcc(Element::Fe, 2.87);
        let prim = bcc.get_primitive(1e-4).unwrap();
        assert_eq!(prim.num_sites(), 1);
    }

    #[test]
    fn test_moyo_roundtrip() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        let cell = fcc.to_moyo_cell();
        let restored = Structure::from_moyo_cell(&cell).unwrap();

        assert_eq!(restored.num_sites(), fcc.num_sites());
        for (orig, new) in fcc.species.iter().zip(restored.species.iter()) {
            assert_eq!(orig.element, new.element);
        }
    }

    #[test]
    fn test_oxidation_states() {
        // Test structures with various oxidation state configurations
        let nacl = Structure::new(
            Lattice::cubic(5.64),
            vec![Species::new(Element::Na, Some(1)), Species::new(Element::Cl, Some(-1))],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert_eq!(nacl.species[0].oxidation_state, Some(1));
        assert_eq!(nacl.species[1].oxidation_state, Some(-1));

        // Mixed neutral and charged
        let mixed = Structure::new(
            Lattice::cubic(4.0),
            vec![
                Species::neutral(Element::Fe),
                Species::new(Element::Fe, Some(2)),
                Species::new(Element::Fe, Some(3)),
            ],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.0, 0.0),
                Vector3::new(0.0, 0.5, 0.0),
            ],
        );
        assert_eq!(mixed.species[0].oxidation_state, None);
        assert_eq!(mixed.species[1].oxidation_state, Some(2));
        assert_eq!(mixed.species[2].oxidation_state, Some(3));

        // Oxidation states are preserved in composition (element only)
        assert_eq!(mixed.composition().reduced_formula(), "Fe");
    }

    #[test]
    fn test_cart_coords() {
        let s = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Cu), Species::neutral(Element::Cu)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let cart = s.cart_coords();
        assert_eq!(cart.len(), 2);

        // Origin stays at origin
        assert!((cart[0][0]).abs() < 1e-10);
        assert!((cart[0][1]).abs() < 1e-10);
        assert!((cart[0][2]).abs() < 1e-10);

        // (0.5, 0.5, 0.5) in fractional -> (2.0, 2.0, 2.0) in Cartesian for 4.0 cubic
        assert!((cart[1][0] - 2.0).abs() < 1e-10);
        assert!((cart[1][1] - 2.0).abs() < 1e-10);
        assert!((cart[1][2] - 2.0).abs() < 1e-10);
    }

    #[test]
    fn test_cart_coords_hexagonal() {
        // Test with non-cubic lattice
        let hex = Lattice::hexagonal(3.0, 5.0);
        let s = Structure::new(
            hex,
            vec![Species::neutral(Element::Zn)],
            vec![Vector3::new(0.0, 0.0, 0.5)],
        );

        let cart = s.cart_coords();
        assert_eq!(cart.len(), 1);

        // z = 0.5 in fractional -> z = 2.5 in Cartesian for c=5.0
        assert!((cart[0][2] - 2.5).abs() < 1e-10);
    }

    #[test]
    fn test_empty_structure() {
        // Empty structures are valid (useful for lattice-only operations)
        let s = Structure::new(Lattice::cubic(4.0), vec![], vec![]);
        assert_eq!(s.num_sites(), 0);
        assert!(s.cart_coords().is_empty());
        assert!(s.composition().is_empty());

        // Lattice properties still work
        assert!((s.lattice.volume() - 64.0).abs() < 1e-10);
        let lengths = s.lattice.lengths();
        assert!((lengths[0] - 4.0).abs() < 1e-10);
        assert!((lengths[1] - 4.0).abs() < 1e-10);
        assert!((lengths[2] - 4.0).abs() < 1e-10);

        // Spacegroup detection should work (returns P1 for empty)
        // Note: moyo may fail on empty structures, which is acceptable
    }

    #[test]
    fn test_large_structure() {
        // Test with more sites
        let lattice = Lattice::cubic(10.0);
        let mut species = Vec::new();
        let mut coords = Vec::new();

        // Create 8 sites in a 2x2x2 grid
        for idx in 0..2 {
            for jdx in 0..2 {
                for kdx in 0..2 {
                    species.push(Species::neutral(Element::Fe));
                    coords.push(Vector3::new(
                        idx as f64 * 0.5,
                        jdx as f64 * 0.5,
                        kdx as f64 * 0.5,
                    ));
                }
            }
        }

        let s = Structure::new(lattice, species, coords);
        assert_eq!(s.num_sites(), 8);
        assert_eq!(s.composition().reduced_formula(), "Fe");
    }
}
