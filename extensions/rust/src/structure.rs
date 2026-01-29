//! Crystal structure representation.
//!
//! This module provides the `Structure` type for representing crystal structures
//! with a lattice, site occupancies, and fractional coordinates.

use crate::composition::Composition;
use crate::element::Element;
use crate::error::{FerroxError, Result};
use crate::lattice::Lattice;
use crate::species::{SiteOccupancy, Species};
use itertools::Itertools;
use moyo::MoyoDataset;
use moyo::base::{AngleTolerance, Cell as MoyoCell, Lattice as MoyoLattice};
use moyo::data::Setting;
use nalgebra::{Matrix3, Vector3};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A crystal structure with lattice, site occupancies, and coordinates.
///
/// Each site can have multiple species with partial occupancies (disordered sites).
/// For ordered sites, there is a single species with occupancy 1.0.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Structure {
    /// The crystal lattice.
    pub lattice: Lattice,
    /// Site occupancies (species + occupancy) at each site.
    pub site_occupancies: Vec<SiteOccupancy>,
    /// Fractional coordinates for each site.
    pub frac_coords: Vec<Vector3<f64>>,
    /// Optional properties (for caching).
    #[serde(default)]
    pub properties: HashMap<String, serde_json::Value>,
}

impl Structure {
    /// Try to create a new structure from site occupancies.
    pub fn try_new_from_occupancies(
        lattice: Lattice,
        site_occupancies: Vec<SiteOccupancy>,
        frac_coords: Vec<Vector3<f64>>,
    ) -> Result<Self> {
        Self::try_new_from_occupancies_with_properties(
            lattice,
            site_occupancies,
            frac_coords,
            HashMap::new(),
        )
    }

    /// Create a structure with site occupancies and properties.
    pub fn try_new_from_occupancies_with_properties(
        lattice: Lattice,
        site_occupancies: Vec<SiteOccupancy>,
        frac_coords: Vec<Vector3<f64>>,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<Self> {
        if site_occupancies.len() != frac_coords.len() {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "site_occupancies and frac_coords must have same length: {} vs {}",
                    site_occupancies.len(),
                    frac_coords.len()
                ),
            });
        }
        // Validate that each site has at least one species (required by dominant_species(),
        // species(), to_moyo_cell(), etc.)
        for (idx, site_occ) in site_occupancies.iter().enumerate() {
            if site_occ.species.is_empty() {
                return Err(FerroxError::InvalidStructure {
                    index: idx,
                    reason: "SiteOccupancy must have at least one species".to_string(),
                });
            }
        }
        Ok(Self {
            lattice,
            site_occupancies,
            frac_coords,
            properties,
        })
    }

    /// Try to create a new structure from ordered species (convenience constructor).
    pub fn try_new(
        lattice: Lattice,
        species: Vec<Species>,
        frac_coords: Vec<Vector3<f64>>,
    ) -> Result<Self> {
        Self::try_new_with_properties(lattice, species, frac_coords, HashMap::new())
    }

    /// Create a structure from ordered species with properties (convenience constructor).
    pub fn try_new_with_properties(
        lattice: Lattice,
        species: Vec<Species>,
        frac_coords: Vec<Vector3<f64>>,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<Self> {
        let site_occupancies = species.into_iter().map(SiteOccupancy::ordered).collect();
        Self::try_new_from_occupancies_with_properties(
            lattice,
            site_occupancies,
            frac_coords,
            properties,
        )
    }

    /// Create a new structure from ordered species (convenience constructor).
    pub fn new(lattice: Lattice, species: Vec<Species>, frac_coords: Vec<Vector3<f64>>) -> Self {
        Self::try_new(lattice, species, frac_coords)
            .expect("species and frac_coords must have same length")
    }

    /// Create a new structure from site occupancies.
    pub fn new_from_occupancies(
        lattice: Lattice,
        site_occupancies: Vec<SiteOccupancy>,
        frac_coords: Vec<Vector3<f64>>,
    ) -> Self {
        Self::try_new_from_occupancies(lattice, site_occupancies, frac_coords)
            .expect("site_occupancies and frac_coords must have same length")
    }

    /// Get the number of sites in the structure.
    pub fn num_sites(&self) -> usize {
        self.site_occupancies.len()
    }

    /// Check if all sites are ordered (single species per site).
    pub fn is_ordered(&self) -> bool {
        self.site_occupancies.iter().all(|so| so.is_ordered())
    }

    /// Get the dominant species at each site.
    pub fn species(&self) -> Vec<&Species> {
        self.site_occupancies
            .iter()
            .map(|so| so.dominant_species())
            .collect()
    }

    /// Get the composition of the structure (weighted by occupancy for disordered sites).
    pub fn composition(&self) -> Composition {
        let mut counts: std::collections::BTreeMap<Element, f64> =
            std::collections::BTreeMap::new();
        for site_occ in &self.site_occupancies {
            for (sp, occ) in &site_occ.species {
                *counts.entry(sp.element).or_insert(0.0) += occ;
            }
        }
        Composition::new(counts)
    }

    /// Get Cartesian coordinates.
    pub fn cart_coords(&self) -> Vec<Vector3<f64>> {
        self.lattice.get_cartesian_coords(&self.frac_coords)
    }

    /// Convert to moyo::base::Cell for symmetry analysis (uses dominant species).
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
            .site_occupancies
            .iter()
            .map(|so| so.dominant_species().element.atomic_number() as i32)
            .collect();
        MoyoCell::new(moyo_lattice, positions, numbers)
    }

    /// Create Structure from moyo::base::Cell (creates ordered sites).
    pub fn from_moyo_cell(cell: &MoyoCell) -> Result<Self> {
        let lattice = Lattice::new(cell.lattice.basis);
        let site_occupancies: Vec<SiteOccupancy> = cell
            .numbers
            .iter()
            .enumerate()
            .map(|(idx, &n)| {
                let z = u8::try_from(n).ok().filter(|&z| z > 0 && z <= 118);
                let elem = z.and_then(Element::from_atomic_number).ok_or_else(|| {
                    FerroxError::InvalidStructure {
                        index: idx,
                        reason: format!("Invalid atomic number: {n}"),
                    }
                })?;
                Ok(SiteOccupancy::ordered(Species::neutral(elem)))
            })
            .collect::<Result<Vec<_>>>()?;
        let frac_coords = cell.positions.clone();
        Structure::try_new_from_occupancies(lattice, site_occupancies, frac_coords)
    }

    /// Get the primitive cell using moyo symmetry analysis.
    pub fn get_primitive(&self, symprec: f64) -> Result<Self> {
        let moyo_cell = self.to_moyo_cell();
        let dataset = MoyoDataset::new(
            &moyo_cell,
            symprec,
            AngleTolerance::Default,
            Setting::Standard,
            false,
        )
        .map_err(|e| FerroxError::MoyoError {
            index: 0,
            reason: format!("{e:?}"),
        })?;
        Self::from_moyo_cell(&dataset.prim_std_cell)
    }

    /// Get the spacegroup number using moyo.
    pub fn get_spacegroup_number(&self, symprec: f64) -> Result<i32> {
        let moyo_cell = self.to_moyo_cell();
        let dataset = MoyoDataset::new(
            &moyo_cell,
            symprec,
            AngleTolerance::Default,
            Setting::Standard,
            false,
        )
        .map_err(|e| FerroxError::MoyoError {
            index: 0,
            reason: format!("{e:?}"),
        })?;
        Ok(dataset.number)
    }

    /// Get unique elements in this structure.
    pub fn unique_elements(&self) -> Vec<Element> {
        self.site_occupancies
            .iter()
            .flat_map(|so| so.species.iter().map(|(sp, _)| sp.element))
            .unique()
            .collect()
    }

    /// Create a copy with species elements remapped.
    ///
    /// If multiple species map to the same element, their occupancies are summed.
    pub fn remap_species(&self, mapping: &HashMap<Element, Element>) -> Self {
        let new_site_occupancies: Vec<SiteOccupancy> = self
            .site_occupancies
            .iter()
            .map(|so| {
                // Group by (new_element, oxidation_state) and sum occupancies
                // Use BTreeMap for deterministic ordering (important for dominant_species on ties)
                let mut grouped: std::collections::BTreeMap<(Element, Option<i8>), f64> =
                    std::collections::BTreeMap::new();
                for (sp, occ) in &so.species {
                    let new_elem = mapping.get(&sp.element).copied().unwrap_or(sp.element);
                    let key = (new_elem, sp.oxidation_state);
                    *grouped.entry(key).or_insert(0.0) += occ;
                }
                let new_species: Vec<(Species, f64)> = grouped
                    .into_iter()
                    .map(|((elem, oxi), occ)| (Species::new(elem, oxi), occ))
                    .collect();
                SiteOccupancy::new(new_species)
            })
            .collect();
        Self {
            lattice: self.lattice.clone(),
            site_occupancies: new_site_occupancies,
            frac_coords: self.frac_coords.clone(),
            properties: self.properties.clone(),
        }
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
        let species = vec![Species::neutral(element); 4];
        let coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.0),
            Vector3::new(0.5, 0.0, 0.5),
            Vector3::new(0.0, 0.5, 0.5),
        ];
        Structure::new(lattice, species, coords)
    }

    fn make_bcc(element: Element, a: f64) -> Structure {
        let lattice = Lattice::cubic(a);
        let species = vec![Species::neutral(element), Species::neutral(element)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        Structure::new(lattice, species, coords)
    }

    fn make_rocksalt(cation: Element, anion: Element, a: f64) -> Structure {
        let lattice = Lattice::cubic(a);
        let species = vec![Species::neutral(cation), Species::neutral(anion)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        Structure::new(lattice, species, coords)
    }

    #[test]
    fn test_new() {
        let structure = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert_eq!(structure.num_sites(), 2);
    }

    #[test]
    fn test_try_new_success() {
        let result = Structure::try_new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap().num_sites(), 2);
    }

    #[test]
    fn test_try_new_length_mismatch() {
        let result = Structure::try_new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_try_new_empty_site_occupancy_error() {
        // Manually create an empty SiteOccupancy (bypassing SiteOccupancy::new's panic)
        let empty_occ = SiteOccupancy {
            species: vec![], // Empty species list
        };
        let result = Structure::try_new_from_occupancies(
            Lattice::cubic(4.0),
            vec![empty_occ],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );
        assert!(result.is_err(), "Empty SiteOccupancy should be rejected");
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("at least one species"),
            "Error should mention empty species: {err}"
        );
    }

    #[test]
    fn test_composition() {
        let structure = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert_eq!(structure.composition().reduced_formula(), "NaCl");
    }

    #[test]
    fn test_to_moyo_cell() {
        let s = make_nacl();
        let cell = s.to_moyo_cell();
        assert_eq!(cell.num_atoms(), 2);
        assert_eq!(cell.numbers, vec![11, 17]);
    }

    #[test]
    fn test_from_moyo_cell_roundtrip() {
        let s = make_nacl();
        let s2 = Structure::from_moyo_cell(&s.to_moyo_cell()).unwrap();
        assert_eq!(s2.num_sites(), s.num_sites());
        assert_eq!(s2.species()[0].element, Element::Na);
        assert_eq!(s2.species()[1].element, Element::Cl);
    }

    #[test]
    fn test_get_primitive_fcc() {
        let fcc_conv = make_fcc_conventional(Element::Cu, 3.6);
        assert_eq!(fcc_conv.num_sites(), 4);
        let prim = fcc_conv.get_primitive(1e-4).unwrap();
        assert_eq!(prim.num_sites(), 1);
        assert_eq!(prim.species()[0].element, Element::Cu);
    }

    #[test]
    fn test_get_spacegroup_number() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        assert_eq!(fcc.get_spacegroup_number(1e-4).unwrap(), 225);
    }

    #[test]
    fn test_spacegroups() {
        assert_eq!(
            make_fcc_conventional(Element::Cu, 3.6)
                .get_spacegroup_number(1e-4)
                .unwrap(),
            225
        );
        assert_eq!(
            make_bcc(Element::Fe, 2.87)
                .get_spacegroup_number(1e-4)
                .unwrap(),
            229
        );
        assert_eq!(make_nacl().get_spacegroup_number(1e-4).unwrap(), 221);
    }

    #[test]
    fn test_get_primitive() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        assert_eq!(fcc.get_primitive(1e-4).unwrap().num_sites(), 1);
        let bcc = make_bcc(Element::Fe, 2.87);
        assert_eq!(bcc.get_primitive(1e-4).unwrap().num_sites(), 1);
    }

    #[test]
    fn test_moyo_roundtrip() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        let restored = Structure::from_moyo_cell(&fcc.to_moyo_cell()).unwrap();
        assert_eq!(restored.num_sites(), fcc.num_sites());
        for (orig, new) in fcc.species().iter().zip(restored.species().iter()) {
            assert_eq!(orig.element, new.element);
        }
    }

    #[test]
    fn test_oxidation_states() {
        let nacl = Structure::new(
            Lattice::cubic(5.64),
            vec![
                Species::new(Element::Na, Some(1)),
                Species::new(Element::Cl, Some(-1)),
            ],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert_eq!(nacl.species()[0].oxidation_state, Some(1));
        assert_eq!(nacl.species()[1].oxidation_state, Some(-1));
    }

    #[test]
    fn test_cart_coords() {
        let s = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Cu); 2],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        let cart = s.cart_coords();
        assert_eq!(cart.len(), 2);
        assert!((cart[1][0] - 2.0).abs() < 1e-10);
    }

    #[test]
    fn test_empty_structure() {
        let s = Structure::new(Lattice::cubic(4.0), vec![], vec![]);
        assert_eq!(s.num_sites(), 0);
        assert!(s.composition().is_empty());
    }

    #[test]
    fn test_disordered_structure() {
        let site_occ = vec![
            SiteOccupancy::new(vec![
                (Species::neutral(Element::Fe), 0.5),
                (Species::neutral(Element::Co), 0.5),
            ]),
            SiteOccupancy::ordered(Species::neutral(Element::O)),
        ];
        let s = Structure::new_from_occupancies(
            Lattice::cubic(4.0),
            site_occ,
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert_eq!(s.num_sites(), 2);
        assert!(!s.is_ordered());
        assert!(!s.site_occupancies[0].is_ordered());
        assert!(s.site_occupancies[1].is_ordered());
    }

    #[test]
    fn test_disordered_composition() {
        let site_occ = vec![
            SiteOccupancy::new(vec![
                (Species::neutral(Element::Fe), 0.5),
                (Species::neutral(Element::Co), 0.5),
            ]),
            SiteOccupancy::new(vec![
                (Species::neutral(Element::Fe), 0.5),
                (Species::neutral(Element::Co), 0.5),
            ]),
        ];
        let s = Structure::new_from_occupancies(
            Lattice::cubic(4.0),
            site_occ,
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        let comp = s.composition();
        assert!((comp.get(Element::Fe) - 1.0).abs() < 1e-10);
        assert!((comp.get(Element::Co) - 1.0).abs() < 1e-10);
        assert_eq!(comp.reduced_formula(), "FeCo");
    }

    #[test]
    fn test_ordered_structure_is_ordered() {
        assert!(make_nacl().is_ordered());
    }

    #[test]
    fn test_species_accessor() {
        let site_occ = vec![
            SiteOccupancy::new(vec![
                (Species::neutral(Element::Fe), 0.7),
                (Species::neutral(Element::Co), 0.3),
            ]),
            SiteOccupancy::ordered(Species::neutral(Element::O)),
        ];
        let s = Structure::new_from_occupancies(
            Lattice::cubic(4.0),
            site_occ,
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert_eq!(s.species()[0].element, Element::Fe);
        assert_eq!(s.species()[1].element, Element::O);
    }

    #[test]
    fn test_unique_elements_disordered() {
        let site_occ = vec![
            SiteOccupancy::new(vec![
                (Species::neutral(Element::Fe), 0.5),
                (Species::neutral(Element::Co), 0.5),
            ]),
            SiteOccupancy::ordered(Species::neutral(Element::O)),
        ];
        let s = Structure::new_from_occupancies(
            Lattice::cubic(4.0),
            site_occ,
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        let elements = s.unique_elements();
        assert_eq!(elements.len(), 3);
        assert!(elements.contains(&Element::Fe));
        assert!(elements.contains(&Element::Co));
        assert!(elements.contains(&Element::O));
    }

    #[test]
    fn test_unique_elements_non_consecutive_duplicates() {
        // Verify itertools::unique() removes ALL duplicates, not just consecutive ones.
        // Pattern: disordered site with Fe+Co followed by ordered Fe site.
        // Should produce [Fe, Co], not [Fe, Co, Fe].
        let site_occ = vec![
            SiteOccupancy::new(vec![
                (Species::neutral(Element::Fe), 0.5),
                (Species::neutral(Element::Co), 0.5),
            ]),
            SiteOccupancy::ordered(Species::neutral(Element::Fe)), // Fe again, non-consecutive
        ];
        let s = Structure::new_from_occupancies(
            Lattice::cubic(4.0),
            site_occ,
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        let elements = s.unique_elements();
        // itertools::unique() correctly removes ALL duplicates (not just consecutive ones
        // like dedup() would). This is critical for fit_anonymous() to work correctly.
        assert_eq!(
            elements.len(),
            2,
            "unique_elements should dedupe non-consecutive duplicates, got: {elements:?}"
        );
        assert!(elements.contains(&Element::Fe));
        assert!(elements.contains(&Element::Co));
    }

    // =========================================================================
    // remap_species() tests
    // =========================================================================

    #[test]
    fn test_remap_species_basic() {
        // NaCl -> KCl mapping
        let nacl = make_rocksalt(Element::Na, Element::Cl, 5.64);
        let mapping = HashMap::from([(Element::Na, Element::K)]);
        let remapped = nacl.remap_species(&mapping);

        assert_eq!(
            remapped.species()[0].element,
            Element::K,
            "Na should map to K"
        );
        assert_eq!(
            remapped.species()[1].element,
            Element::Cl,
            "Cl should be unchanged"
        );
        assert_eq!(
            remapped.num_sites(),
            nacl.num_sites(),
            "Site count should be preserved"
        );
    }

    #[test]
    fn test_remap_species_preserves_oxidation_states() {
        // Species with oxidation states should preserve them
        let s = Structure::new(
            Lattice::cubic(5.0),
            vec![
                Species::new(Element::Fe, Some(2)),
                Species::new(Element::O, Some(-2)),
            ],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        let mapping = HashMap::from([(Element::Fe, Element::Co)]);
        let remapped = s.remap_species(&mapping);

        assert_eq!(remapped.species()[0].element, Element::Co);
        assert_eq!(
            remapped.species()[0].oxidation_state,
            Some(2),
            "Oxidation state should be preserved"
        );
    }

    #[test]
    fn test_remap_species_unmapped_elements_unchanged() {
        let s = make_rocksalt(Element::Na, Element::Cl, 5.64);
        let mapping = HashMap::from([(Element::Fe, Element::Co)]); // irrelevant mapping
        let remapped = s.remap_species(&mapping);

        assert_eq!(
            remapped.species()[0].element,
            Element::Na,
            "Na should be unchanged"
        );
        assert_eq!(
            remapped.species()[1].element,
            Element::Cl,
            "Cl should be unchanged"
        );
    }

    #[test]
    fn test_remap_species_empty_structure() {
        let s = Structure::new(Lattice::cubic(5.0), vec![], vec![]);
        let mapping = HashMap::from([(Element::Na, Element::K)]);
        let remapped = s.remap_species(&mapping);
        assert_eq!(
            remapped.num_sites(),
            0,
            "Empty structure should remain empty"
        );
    }
}
