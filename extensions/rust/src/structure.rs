//! Crystal structure representation.
//!
//! This module provides the `Structure` type for representing crystal structures
//! with a lattice, site occupancies, and fractional coordinates.

use crate::algorithms::EnumConfig;
use crate::composition::Composition;
use crate::element::Element;
use crate::error::{FerroxError, Result};
use crate::lattice::Lattice;
use crate::species::{SiteOccupancy, Species};
use crate::transformations::{OrderDisorderedConfig, PartialRemoveConfig};
use itertools::Itertools;
use moyo::MoyoDataset;
use moyo::base::{
    AngleTolerance, Cell as MoyoCell, Lattice as MoyoLattice, Operation as MoyoOperation,
};
use moyo::data::Setting;
use nalgebra::{Matrix3, Vector3};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

/// A symmetry operation represented as a rotation matrix and translation vector.
/// The rotation is a 3x3 integer matrix (in fractional coordinates) and the
/// translation is a 3-element float array (in fractional coordinates).
pub type SymmetryOperation = ([[i32; 3]; 3], [f64; 3]);

/// Lattice reduction algorithm choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReductionAlgo {
    /// Niggli reduction - produces unique reduced cell with a <= b <= c
    Niggli,
    /// LLL reduction - produces nearly orthogonal basis (faster, less unique)
    LLL,
}

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
    ///
    /// Note: This allocates a new Vec on each call. For performance-critical
    /// code that iterates once, consider using `site_occupancies` directly.
    pub fn species(&self) -> Vec<&Species> {
        self.site_occupancies
            .iter()
            .map(|so| so.dominant_species())
            .collect()
    }

    /// Get the element composition (oxidation states ignored, weighted by occupancy).
    pub fn composition(&self) -> Composition {
        let mut counts: BTreeMap<Element, f64> = BTreeMap::new();
        for site_occ in &self.site_occupancies {
            for (sp, occ) in &site_occ.species {
                *counts.entry(sp.element).or_insert(0.0) += occ;
            }
        }
        Composition::from_elements(counts)
    }

    /// Get the species composition (preserves oxidation states, weighted by occupancy).
    pub fn species_composition(&self) -> Composition {
        let mut counts: Vec<(Species, f64)> = Vec::new();
        for site_occ in &self.site_occupancies {
            for (sp, occ) in &site_occ.species {
                if let Some(entry) = counts.iter_mut().find(|(s, _)| s == sp) {
                    entry.1 += occ;
                } else {
                    counts.push((*sp, *occ));
                }
            }
        }
        Composition::new(counts)
    }

    /// Get species strings for all sites.
    ///
    /// Returns a vector of human-readable species strings, one per site.
    /// For ordered sites: "Fe" or "Fe2+". For disordered: "Fe:0.5, Co:0.5"
    /// (sorted by electronegativity, matching pymatgen).
    pub fn species_strings(&self) -> Vec<String> {
        self.site_occupancies
            .iter()
            .map(|so| so.species_string())
            .collect()
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
        validate_symprec(symprec)?;
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

    /// Get the conventional (standardized) cell using moyo symmetry analysis.
    pub fn get_conventional_structure(&self, symprec: f64) -> Result<Self> {
        validate_symprec(symprec)?;
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
        Self::from_moyo_cell(&dataset.std_cell)
    }

    /// Get the spacegroup number using moyo.
    pub fn get_spacegroup_number(&self, symprec: f64) -> Result<i32> {
        // symprec validated by get_symmetry_dataset
        Ok(self.get_symmetry_dataset(symprec)?.number)
    }

    /// Get the full symmetry dataset from moyo.
    ///
    /// This is more efficient when you need multiple symmetry properties,
    /// as it only runs the symmetry analysis once.
    pub fn get_symmetry_dataset(&self, symprec: f64) -> Result<MoyoDataset> {
        validate_symprec(symprec)?;
        if self.num_sites() == 0 {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: "Cannot compute symmetry for empty structure (0 sites)".to_string(),
            });
        }
        let moyo_cell = self.to_moyo_cell();
        MoyoDataset::new(
            &moyo_cell,
            symprec,
            AngleTolerance::Default,
            Setting::Standard,
            false,
        )
        .map_err(|e| FerroxError::MoyoError {
            index: 0,
            reason: format!("{e:?}"),
        })
    }

    /// Get the Hermann-Mauguin spacegroup symbol (e.g., "F m -3 m", "P 2_1/c").
    ///
    /// Note: Returns space-separated tokens as provided by the underlying
    /// symmetry library (moyo). For condensed symbols, post-process by removing spaces.
    pub fn get_spacegroup_symbol(&self, symprec: f64) -> Result<String> {
        Ok(self.get_symmetry_dataset(symprec)?.hm_symbol)
    }

    /// Get the Hall number (1-530) identifying the specific spacegroup setting.
    pub fn get_hall_number(&self, symprec: f64) -> Result<i32> {
        Ok(self.get_symmetry_dataset(symprec)?.hall_number)
    }

    /// Get the Pearson symbol (e.g., "cF8" for FCC Cu).
    ///
    /// The Pearson symbol encodes the crystal system, centering type, and
    /// number of atoms in the conventional cell.
    pub fn get_pearson_symbol(&self, symprec: f64) -> Result<String> {
        Ok(self.get_symmetry_dataset(symprec)?.pearson_symbol)
    }

    /// Get Wyckoff letters for each site in the structure.
    ///
    /// Wyckoff positions describe the site symmetry and multiplicity of each
    /// atomic position. Sites with the same letter have equivalent positions
    /// under the space group symmetry.
    pub fn get_wyckoff_letters(&self, symprec: f64) -> Result<Vec<char>> {
        Ok(self.get_symmetry_dataset(symprec)?.wyckoffs)
    }

    /// Get site symmetry symbols for each site (e.g., "m..", "-1", "4mm").
    ///
    /// The site symmetry describes the point group symmetry at each atomic site,
    /// oriented with respect to the standardized cell.
    pub fn get_site_symmetry_symbols(&self, symprec: f64) -> Result<Vec<String>> {
        Ok(self.get_symmetry_dataset(symprec)?.site_symmetry_symbols)
    }

    /// Get symmetry operations in the input cell.
    ///
    /// Returns a vector of (rotation_matrix, translation_vector) pairs.
    /// The rotation is a 3x3 integer matrix in fractional coordinates,
    /// and the translation is a 3-vector in fractional coordinates.
    ///
    /// A symmetry operation transforms a point r to: R @ r + t
    pub fn get_symmetry_operations(&self, symprec: f64) -> Result<Vec<SymmetryOperation>> {
        let dataset = self.get_symmetry_dataset(symprec)?;
        Ok(moyo_ops_to_arrays(&dataset.operations))
    }

    /// Get equivalent sites (crystallographic orbits).
    ///
    /// Returns a vector where orbits[i] is the index of the representative site
    /// that site i is equivalent to. Sites with the same orbit index are
    /// related by space group symmetry.
    ///
    /// For example, orbits=[0, 0, 2, 2, 2, 2] means sites 0-1 are equivalent
    /// to site 0, and sites 2-5 are equivalent to site 2.
    pub fn get_equivalent_sites(&self, symprec: f64) -> Result<Vec<usize>> {
        Ok(self.get_symmetry_dataset(symprec)?.orbits)
    }

    /// Get the crystal system based on the spacegroup number.
    ///
    /// Returns one of: "triclinic", "monoclinic", "orthorhombic",
    /// "tetragonal", "trigonal", "hexagonal", "cubic".
    pub fn get_crystal_system(&self, symprec: f64) -> Result<String> {
        Ok(spacegroup_to_crystal_system(self.get_symmetry_dataset(symprec)?.number).to_string())
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
                let mut grouped: BTreeMap<(Element, Option<i8>), f64> = BTreeMap::new();
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

    // =========================================================================
    // Neighbor Finding Methods
    // =========================================================================

    /// Get neighbor list as arrays: (center_indices, neighbor_indices, offset_vectors, distances).
    ///
    /// Finds all atom pairs within cutoff radius `r` using periodic boundary conditions.
    ///
    /// # Arguments
    ///
    /// * `r` - Cutoff radius in Angstroms
    /// * `numerical_tol` - Tolerance for distance comparisons (typically 1e-8)
    /// * `exclude_self` - If true, exclude self-pairs (distance ~0)
    ///
    /// # Returns
    ///
    /// Tuple of (center_indices, neighbor_indices, image_offsets, distances)
    ///
    /// # Performance
    ///
    /// Uses O(n² × images) brute-force search. For large structures with long cutoffs,
    /// consider using specialized neighbor-finding libraries.
    pub fn get_neighbor_list(
        &self,
        r: f64,
        numerical_tol: f64,
        exclude_self: bool,
    ) -> (Vec<usize>, Vec<usize>, Vec<[i32; 3]>, Vec<f64>) {
        let num_sites = self.num_sites();
        if num_sites == 0 || r <= 0.0 {
            return (vec![], vec![], vec![], vec![]);
        }

        // Compute the search range for periodic images
        let lattice_vecs = [
            self.lattice.matrix().row(0).transpose(),
            self.lattice.matrix().row(1).transpose(),
            self.lattice.matrix().row(2).transpose(),
        ];

        // For each axis, compute how many images we need
        let volume = self.lattice.volume();
        let max_range: [i32; 3] = std::array::from_fn(|idx| {
            let cross = lattice_vecs[(idx + 1) % 3].cross(&lattice_vecs[(idx + 2) % 3]);
            let height = volume / cross.norm();
            (r / height).ceil() as i32 + 1
        });

        let cart_coords = self.cart_coords();
        let mut center_indices = Vec::new();
        let mut neighbor_indices = Vec::new();
        let mut image_offsets = Vec::new();
        let mut distances = Vec::new();

        for (idx, cart_i) in cart_coords.iter().enumerate() {
            for (jdx, cart_j) in cart_coords.iter().enumerate() {
                for dx in -max_range[0]..=max_range[0] {
                    for dy in -max_range[1]..=max_range[1] {
                        for dz in -max_range[2]..=max_range[2] {
                            let offset = (dx as f64) * lattice_vecs[0]
                                + (dy as f64) * lattice_vecs[1]
                                + (dz as f64) * lattice_vecs[2];
                            let dist = (cart_j + offset - cart_i).norm();
                            if dist <= r {
                                if exclude_self && dist < numerical_tol && idx == jdx {
                                    continue;
                                }
                                center_indices.push(idx);
                                neighbor_indices.push(jdx);
                                image_offsets.push([dx, dy, dz]);
                                distances.push(dist);
                            }
                        }
                    }
                }
            }
        }

        (center_indices, neighbor_indices, image_offsets, distances)
    }

    /// Get all neighbors for each site within radius `r`.
    pub fn get_all_neighbors(&self, r: f64) -> Vec<Vec<(usize, f64, [i32; 3])>> {
        let num_sites = self.num_sites();
        let mut result = vec![Vec::new(); num_sites];

        let (centers, neighbors, images, dists) = self.get_neighbor_list(r, 1e-8, true);

        for (kdx, &center) in centers.iter().enumerate() {
            result[center].push((neighbors[kdx], dists[kdx], images[kdx]));
        }

        result
    }

    /// Get the distance between sites `i` and `j` using minimum image convention.
    ///
    /// # Panics
    ///
    /// Panics if `i` or `j` is out of bounds.
    #[inline]
    pub fn get_distance(&self, i: usize, j: usize) -> f64 {
        self.get_distance_and_image(i, j).0
    }

    /// Get distance and periodic image between sites `i` and `j`.
    ///
    /// Returns `(distance, image)` where `image` is the lattice translation `[da, db, dc]`
    /// that gives the shortest distance. For example, `[1, 0, 0]` means the shortest
    /// path goes through the +a periodic boundary.
    ///
    /// # Panics
    ///
    /// Panics if `i` or `j` is out of bounds.
    pub fn get_distance_and_image(&self, i: usize, j: usize) -> (f64, [i32; 3]) {
        assert!(
            i < self.num_sites(),
            "Index i={} out of bounds (num_sites={})",
            i,
            self.num_sites()
        );
        assert!(
            j < self.num_sites(),
            "Index j={} out of bounds (num_sites={})",
            j,
            self.num_sites()
        );

        let fcoords_i = vec![self.frac_coords[i]];
        let fcoords_j = vec![self.frac_coords[j]];
        let (_, d2, images) =
            crate::pbc::pbc_shortest_vectors(&self.lattice, &fcoords_i, &fcoords_j, None, None);
        (d2[0][0].sqrt(), images[0][0])
    }

    /// Get distance to a specific periodic image of site `j`.
    ///
    /// `jimage` specifies the lattice translation, e.g., `[1, 0, 0]` means the image
    /// of site `j` shifted by +a lattice vector. Coordinates are wrapped to [0, 1)
    /// only along periodic axes, consistent with `pbc_shortest_vectors`.
    ///
    /// # Panics
    ///
    /// Panics if `i` or `j` is out of bounds.
    pub fn get_distance_with_image(&self, i: usize, j: usize, jimage: [i32; 3]) -> f64 {
        assert!(
            i < self.num_sites(),
            "Index i={} out of bounds (num_sites={})",
            i,
            self.num_sites()
        );
        assert!(
            j < self.num_sites(),
            "Index j={} out of bounds (num_sites={})",
            j,
            self.num_sites()
        );

        // Wrap coordinates only along periodic axes for consistency with pbc_shortest_vectors
        let pbc = self.lattice.pbc;
        let frac_i = crate::pbc::wrap_frac_coords_pbc(&self.frac_coords[i], pbc);
        let frac_j = crate::pbc::wrap_frac_coords_pbc(&self.frac_coords[j], pbc);

        let cart_i = self.lattice.get_cartesian_coords(&[frac_i])[0];
        let frac_j_shifted = frac_j + Vector3::from(jimage.map(|val| val as f64));
        let cart_j = self.lattice.get_cartesian_coords(&[frac_j_shifted])[0];
        (cart_j - cart_i).norm()
    }

    /// Get the full distance matrix between all sites under PBC.
    pub fn distance_matrix(&self) -> Vec<Vec<f64>> {
        let num_sites = self.num_sites();
        if num_sites == 0 {
            return vec![];
        }

        let (_, d2, _) = crate::pbc::pbc_shortest_vectors(
            &self.lattice,
            &self.frac_coords,
            &self.frac_coords,
            None,
            None,
        );

        d2.into_iter()
            .map(|row| row.into_iter().map(|dist_sq| dist_sq.sqrt()).collect())
            .collect()
    }

    /// Get Cartesian distance from a site to an arbitrary point.
    ///
    /// This is a simple Euclidean distance, not using periodic boundary conditions.
    /// For PBC-aware distances between sites, use `get_distance()`.
    ///
    /// # Arguments
    ///
    /// * `idx` - Site index
    /// * `point` - Cartesian coordinates of the point
    ///
    /// # Panics
    ///
    /// Panics if `idx` is out of bounds.
    pub fn distance_from_point(&self, idx: usize, point: Vector3<f64>) -> f64 {
        assert!(
            idx < self.num_sites(),
            "Site index {} out of bounds (num_sites={})",
            idx,
            self.num_sites()
        );
        let cart = self.lattice.get_cartesian_coords(&[self.frac_coords[idx]])[0];
        (cart - point).norm()
    }

    /// Check if sites `i` and `j` are periodic images of each other.
    ///
    /// Two sites are periodic images if they have the same species (using dominant
    /// species for disordered sites) and their fractional coordinates differ by
    /// integers within the specified tolerance.
    ///
    /// # Arguments
    ///
    /// * `i` - First site index
    /// * `j` - Second site index
    /// * `tolerance` - Tolerance for coordinate comparison (typically 1e-8)
    ///
    /// # Panics
    ///
    /// Panics if `i` or `j` is out of bounds.
    pub fn is_periodic_image(&self, i: usize, j: usize, tolerance: f64) -> bool {
        assert!(
            i < self.num_sites(),
            "Index i={} out of bounds (num_sites={})",
            i,
            self.num_sites()
        );
        assert!(
            j < self.num_sites(),
            "Index j={} out of bounds (num_sites={})",
            j,
            self.num_sites()
        );

        // Check species match (using dominant species for disordered sites)
        if self.site_occupancies[i].dominant_species()
            != self.site_occupancies[j].dominant_species()
        {
            return false;
        }

        // Check coordinates differ by integers within tolerance
        let diff = self.frac_coords[i] - self.frac_coords[j];
        for kdx in 0..3 {
            if (diff[kdx] - diff[kdx].round()).abs() > tolerance {
                return false;
            }
        }
        true
    }

    // =========================================================================
    // Coordination Analysis
    // =========================================================================

    /// Get coordination numbers for all sites using a distance cutoff.
    ///
    /// Counts the number of neighbors within the specified cutoff distance for each site.
    /// Uses periodic boundary conditions.
    ///
    /// # Arguments
    ///
    /// * `cutoff` - Maximum distance (in Angstroms) to consider a site as a neighbor
    ///
    /// # Returns
    ///
    /// A vector of coordination numbers, one for each site in the structure.
    pub fn get_coordination_numbers(&self, cutoff: f64) -> Vec<usize> {
        crate::coordination::get_coordination_numbers(self, cutoff)
    }

    /// Get coordination number for a single site using a distance cutoff.
    ///
    /// # Arguments
    ///
    /// * `site_idx` - Index of the site to analyze
    /// * `cutoff` - Maximum distance (in Angstroms) to consider a site as a neighbor
    ///
    /// # Returns
    ///
    /// The coordination number for the specified site.
    ///
    /// # Panics
    ///
    /// Panics if `site_idx` is out of bounds.
    pub fn get_coordination_number(&self, site_idx: usize, cutoff: f64) -> usize {
        crate::coordination::get_coordination_number(self, site_idx, cutoff)
    }

    /// Get the local environment (detailed neighbor information) for a site.
    ///
    /// Returns detailed information about each neighbor including species, distance,
    /// and periodic image offset.
    ///
    /// # Arguments
    ///
    /// * `site_idx` - Index of the site to analyze
    /// * `cutoff` - Maximum distance (in Angstroms) to consider a site as a neighbor
    ///
    /// # Returns
    ///
    /// A vector of `LocalEnvNeighbor` structs describing each neighbor.
    ///
    /// # Panics
    ///
    /// Panics if `site_idx` is out of bounds.
    pub fn get_local_environment(
        &self,
        site_idx: usize,
        cutoff: f64,
    ) -> Vec<crate::coordination::LocalEnvNeighbor> {
        crate::coordination::get_local_environment(self, site_idx, cutoff)
    }

    /// Get Voronoi-weighted coordination number for a single site.
    ///
    /// Uses Voronoi tessellation to determine neighbors based on solid angle.
    ///
    /// **Note**: Results are only geometrically correct for orthogonal lattices
    /// (cubic/tetragonal/orthorhombic). Use cutoff-based methods for non-orthogonal cells.
    ///
    /// # Arguments
    ///
    /// * `site_idx` - Index of the site to analyze
    /// * `config` - Optional configuration (min_solid_angle threshold)
    ///
    /// # Returns
    ///
    /// The effective coordination number (can be fractional).
    ///
    /// # Panics
    ///
    /// Panics if `site_idx` is out of bounds.
    pub fn get_cn_voronoi(
        &self,
        site_idx: usize,
        config: Option<&crate::coordination::VoronoiConfig>,
    ) -> f64 {
        crate::coordination::get_cn_voronoi(self, site_idx, config)
    }

    /// Get Voronoi-weighted coordination numbers for all sites.
    ///
    /// Uses Voronoi tessellation to determine neighbors based on solid angle.
    ///
    /// **Note**: Results are only geometrically correct for orthogonal lattices
    /// (cubic/tetragonal/orthorhombic). Use cutoff-based methods for non-orthogonal cells.
    ///
    /// # Arguments
    ///
    /// * `config` - Optional configuration (min_solid_angle threshold)
    ///
    /// # Returns
    ///
    /// A vector of effective coordination numbers, one for each site.
    pub fn get_cn_voronoi_all(
        &self,
        config: Option<&crate::coordination::VoronoiConfig>,
    ) -> Vec<f64> {
        crate::coordination::get_cn_voronoi_all(self, config)
    }

    /// Get Voronoi neighbors with their solid angle fractions for a site.
    ///
    /// Returns neighbors sorted by solid angle (largest first).
    ///
    /// **Note**: Results are only geometrically correct for orthogonal lattices
    /// (cubic/tetragonal/orthorhombic). Use cutoff-based methods for non-orthogonal cells.
    ///
    /// # Arguments
    ///
    /// * `site_idx` - Index of the site to analyze
    /// * `config` - Optional configuration (min_solid_angle threshold)
    ///
    /// # Returns
    ///
    /// A vector of tuples `(neighbor_idx, solid_angle_fraction)`.
    pub fn get_voronoi_neighbors(
        &self,
        site_idx: usize,
        config: Option<&crate::coordination::VoronoiConfig>,
    ) -> Vec<(usize, f64)> {
        crate::coordination::get_voronoi_neighbors(self, site_idx, config)
    }

    // =========================================================================
    // Structure Interpolation (NEB)
    // =========================================================================

    /// Interpolate between this structure and end_structure for NEB calculations.
    ///
    /// Generates `n_images + 1` structures including the start and end structures.
    /// Intermediate structures have linearly interpolated coordinates.
    ///
    /// # Arguments
    ///
    /// * `end` - The end structure (must have same number of sites and species order)
    /// * `n_images` - Number of intermediate images (n_images=0 returns just start)
    /// * `interpolate_lattices` - If true, also interpolate lattice parameters linearly
    /// * `use_pbc` - If true, use minimum image convention for coordinate interpolation
    ///
    /// # Returns
    ///
    /// `Ok(Vec<Structure>)` with n_images + 1 structures, or `Err` if structures are incompatible.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let images = start.interpolate(&end, 5, false, true)?;
    /// assert_eq!(images.len(), 6); // start + 5 intermediates + end overlap
    /// ```
    pub fn interpolate(
        &self,
        end: &Structure,
        n_images: usize,
        interpolate_lattices: bool,
        use_pbc: bool,
    ) -> Result<Vec<Structure>> {
        // Validate compatibility: same number of sites
        if self.num_sites() != end.num_sites() {
            return Err(FerroxError::MatchingError {
                reason: format!(
                    "Cannot interpolate structures with different number of sites: {} vs {}",
                    self.num_sites(),
                    end.num_sites()
                ),
            });
        }

        // Check species match at each site (using dominant species for disordered sites)
        for (idx, (so1, so2)) in self
            .site_occupancies
            .iter()
            .zip(&end.site_occupancies)
            .enumerate()
        {
            if so1.dominant_species().element != so2.dominant_species().element {
                return Err(FerroxError::MatchingError {
                    reason: format!(
                        "Species mismatch at site {}: {:?} vs {:?}",
                        idx,
                        so1.dominant_species().element,
                        so2.dominant_species().element
                    ),
                });
            }
        }

        // Edge case: n_images=0 returns just the start structure
        if n_images == 0 {
            return Ok(vec![self.clone()]);
        }

        let mut images = Vec::with_capacity(n_images + 1);

        for img_idx in 0..=n_images {
            let x = img_idx as f64 / n_images as f64;

            // Interpolate fractional coordinates
            let new_frac_coords: Vec<Vector3<f64>> = self
                .frac_coords
                .iter()
                .zip(&end.frac_coords)
                .map(|(fc_start, fc_end)| {
                    let diff = fc_end - fc_start;
                    let diff = if use_pbc { wrap_frac_diff(diff) } else { diff };
                    fc_start + x * diff
                })
                .collect();

            // Optionally interpolate lattice
            let new_lattice = if interpolate_lattices {
                interpolate_lattices_linear(&self.lattice, &end.lattice, x)
            } else {
                self.lattice.clone()
            };

            images.push(Structure::try_new_from_occupancies_with_properties(
                new_lattice,
                self.site_occupancies.clone(),
                new_frac_coords,
                self.properties.clone(),
            )?);
        }

        Ok(images)
    }

    // =========================================================================
    // Structure Matching Convenience Methods
    // =========================================================================

    /// Check if this structure matches another using default matcher settings.
    ///
    /// # Arguments
    ///
    /// * `other` - The structure to compare against
    /// * `anonymous` - If true, allows any species permutation (prototype matching)
    ///
    /// # Returns
    ///
    /// `true` if structures match, `false` otherwise.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let nacl = make_nacl();
    /// let mgo = make_mgo();
    ///
    /// // Exact match (same species)
    /// assert!(nacl.matches(&nacl, false));
    ///
    /// // Anonymous match (same prototype, different species)
    /// assert!(nacl.matches(&mgo, true));
    /// ```
    pub fn matches(&self, other: &Structure, anonymous: bool) -> bool {
        let matcher = crate::matcher::StructureMatcher::new();
        self.matches_with(other, &matcher, anonymous)
    }

    /// Check if structures match using custom matcher settings.
    ///
    /// # Arguments
    ///
    /// * `other` - The structure to compare against
    /// * `matcher` - Custom `StructureMatcher` with tolerance settings
    /// * `anonymous` - If true, allows any species permutation
    ///
    /// # Returns
    ///
    /// `true` if structures match according to the matcher settings.
    pub fn matches_with(
        &self,
        other: &Structure,
        matcher: &crate::matcher::StructureMatcher,
        anonymous: bool,
    ) -> bool {
        if anonymous {
            matcher.fit_anonymous(self, other)
        } else {
            matcher.fit(self, other)
        }
    }

    // =========================================================================
    // Structure Sorting
    // =========================================================================

    /// Sort sites in place by atomic number (ascending by default).
    ///
    /// Sites with disordered occupancies are sorted by their dominant species
    /// (highest occupancy).
    ///
    /// # Arguments
    ///
    /// * `reverse` - If true, sort in descending order (heaviest first)
    ///
    /// # Returns
    ///
    /// Mutable reference to self for method chaining.
    pub fn sort(&mut self, reverse: bool) -> &mut Self {
        self.sort_by_key(|so| so.dominant_species().element.atomic_number(), reverse)
    }

    /// Sort sites in place by electronegativity (ascending by default).
    ///
    /// Sites with undefined electronegativity (noble gases) are placed last.
    /// Uses dominant species for disordered sites.
    ///
    /// # Arguments
    ///
    /// * `reverse` - If true, sort in descending order (most electronegative first)
    pub fn sort_by_electronegativity(&mut self, reverse: bool) -> &mut Self {
        let mut indices: Vec<usize> = (0..self.num_sites()).collect();
        indices.sort_by(|&a_idx, &b_idx| {
            let en_a = self.site_occupancies[a_idx]
                .dominant_species()
                .element
                .electronegativity();
            let en_b = self.site_occupancies[b_idx]
                .dominant_species()
                .element
                .electronegativity();
            match (en_a, en_b) {
                (Some(a), Some(b)) => a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal),
                (Some(_), None) => std::cmp::Ordering::Less, // Defined before undefined
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });

        if reverse {
            indices.reverse();
        }

        self.apply_site_permutation(&indices)
    }

    /// Sort sites in place by a custom key function.
    ///
    /// # Arguments
    ///
    /// * `key` - Function that extracts a sortable key from each SiteOccupancy
    /// * `reverse` - If true, sort in descending order
    pub fn sort_by_key<K, F>(&mut self, key: F, reverse: bool) -> &mut Self
    where
        F: Fn(&SiteOccupancy) -> K,
        K: Ord,
    {
        let mut indices: Vec<usize> = (0..self.num_sites()).collect();
        indices.sort_by_key(|&idx| key(&self.site_occupancies[idx]));

        if reverse {
            indices.reverse();
        }

        self.apply_site_permutation(&indices)
    }

    /// Apply a permutation to reorder sites.
    #[inline]
    fn apply_site_permutation(&mut self, indices: &[usize]) -> &mut Self {
        let new_site_occupancies: Vec<SiteOccupancy> = indices
            .iter()
            .map(|&idx| self.site_occupancies[idx].clone())
            .collect();
        let new_frac_coords: Vec<Vector3<f64>> =
            indices.iter().map(|&idx| self.frac_coords[idx]).collect();

        self.site_occupancies = new_site_occupancies;
        self.frac_coords = new_frac_coords;
        self
    }

    /// Get a sorted copy of the structure by atomic number.
    pub fn get_sorted_structure(&self, reverse: bool) -> Self {
        let mut copy = self.clone();
        copy.sort(reverse);
        copy
    }

    /// Get a copy sorted by electronegativity.
    pub fn get_sorted_by_electronegativity(&self, reverse: bool) -> Self {
        let mut copy = self.clone();
        copy.sort_by_electronegativity(reverse);
        copy
    }

    // =========================================================================
    // Copy and Sanitization
    // =========================================================================

    /// Create a copy, optionally sanitized.
    ///
    /// Sanitization applies these steps in order:
    /// 1. LLL lattice reduction (produces nearly orthogonal basis)
    /// 2. Sort sites by electronegativity
    /// 3. Wrap fractional coordinates to [0, 1)
    ///
    /// # Arguments
    ///
    /// * `sanitize` - If true, apply sanitization steps
    pub fn copy(&self, sanitize: bool) -> Self {
        if !sanitize {
            return self.clone();
        }

        // 1. Get LLL-reduced structure (or clone if reduction fails)
        let mut result = self
            .get_reduced_structure(ReductionAlgo::LLL)
            .unwrap_or_else(|err| {
                tracing::warn!("LLL reduction failed during sanitization: {err}");
                self.clone()
            });

        // 2. Sort by electronegativity
        result.sort_by_electronegativity(false);

        // 3. Wrap coords to [0, 1)
        result.wrap_to_unit_cell();

        result
    }

    /// Create a copy with updated properties.
    ///
    /// Existing properties are preserved; new ones are added or overwritten.
    pub fn copy_with_properties(&self, properties: HashMap<String, serde_json::Value>) -> Self {
        let mut result = self.clone();
        result.properties.extend(properties);
        result
    }

    /// Wrap all fractional coordinates to [0, 1).
    ///
    /// # Returns
    ///
    /// Mutable reference to self for method chaining.
    pub fn wrap_to_unit_cell(&mut self) -> &mut Self {
        for fc in &mut self.frac_coords {
            *fc = crate::pbc::wrap_frac_coords(fc);
        }
        self
    }

    // =========================================================================
    // Supercell Methods
    // =========================================================================

    /// Create a supercell from a 3x3 integer scaling matrix.
    ///
    /// The new lattice vectors are: new_lattice = scaling_matrix * old_lattice.
    /// Sites are replicated for all lattice points within the supercell.
    ///
    /// # Arguments
    ///
    /// * `scaling_matrix` - 3x3 integer matrix defining the supercell transformation
    ///
    /// # Returns
    ///
    /// `Ok(Structure)` with the supercell, or `Err` if the scaling matrix has zero determinant.
    pub fn make_supercell(&self, scaling_matrix: [[i32; 3]; 3]) -> Result<Self> {
        // Convert to nalgebra Matrix3<f64>
        let scale = Matrix3::new(
            scaling_matrix[0][0] as f64,
            scaling_matrix[0][1] as f64,
            scaling_matrix[0][2] as f64,
            scaling_matrix[1][0] as f64,
            scaling_matrix[1][1] as f64,
            scaling_matrix[1][2] as f64,
            scaling_matrix[2][0] as f64,
            scaling_matrix[2][1] as f64,
            scaling_matrix[2][2] as f64,
        );

        // Check determinant (should be a non-zero integer)
        let det = scale.determinant();
        if det.abs() < 0.5 {
            return Err(FerroxError::InvalidLattice {
                reason: "Supercell scaling matrix has zero determinant".to_string(),
            });
        }
        let n_cells = det.abs().round() as usize;

        // Compute new lattice matrix: new_matrix = scale * old_matrix
        let new_matrix = scale * self.lattice.matrix();
        let mut new_lattice = Lattice::new(new_matrix);
        new_lattice.pbc = self.lattice.pbc;

        // Compute inverse for transforming fractional coordinates
        let inv_scale = scale
            .try_inverse()
            .ok_or_else(|| FerroxError::InvalidLattice {
                reason: "Cannot invert scaling matrix".to_string(),
            })?;

        // Generate all lattice points in the supercell
        let lattice_points = lattice_points_in_supercell(&scaling_matrix);

        // Create new sites
        let mut new_site_occupancies = Vec::with_capacity(self.num_sites() * n_cells);
        let mut new_frac_coords = Vec::with_capacity(self.num_sites() * n_cells);

        for (orig_idx, (site_occ, frac)) in self
            .site_occupancies
            .iter()
            .zip(&self.frac_coords)
            .enumerate()
        {
            for lattice_pt in &lattice_points {
                // Shift by lattice point, then transform to new fractional coords
                let shifted = frac + lattice_pt;
                let new_frac = inv_scale * shifted;

                // Copy site occupancy with orig_site_idx for tracking
                // Only set if not already present (preserves chain for nested supercells)
                let mut new_site_occ = site_occ.clone();
                new_site_occ
                    .properties
                    .entry("orig_site_idx".to_string())
                    .or_insert_with(|| serde_json::json!(orig_idx));

                new_site_occupancies.push(new_site_occ);
                new_frac_coords.push(new_frac);
            }
        }

        Structure::try_new_from_occupancies_with_properties(
            new_lattice,
            new_site_occupancies,
            new_frac_coords,
            self.properties.clone(),
        )
    }

    /// Create a diagonal supercell (nx x ny x nz).
    ///
    /// This is a convenience method for the common case of uniform scaling
    /// along each axis without shearing.
    ///
    /// # Panics
    ///
    /// Panics if any scaling factor is not positive.
    pub fn make_supercell_diag(&self, ns: [i32; 3]) -> Self {
        assert!(
            ns.iter().all(|&n| n > 0),
            "Supercell scaling factors must be positive, got {:?}",
            ns
        );
        self.make_supercell([[ns[0], 0, 0], [0, ns[1], 0], [0, 0, ns[2]]])
            .expect("Diagonal supercell matrix cannot have zero determinant")
    }

    // =========================================================================
    // Lattice Reduction Methods
    // =========================================================================

    /// Get structure with reduced lattice.
    ///
    /// Atomic positions are preserved in Cartesian space; only the lattice
    /// basis changes. Fractional coordinates are wrapped to [0, 1).
    ///
    /// # Arguments
    ///
    /// * `algo` - Which reduction algorithm to use (Niggli or LLL)
    pub fn get_reduced_structure(&self, algo: ReductionAlgo) -> Result<Self> {
        self.get_reduced_structure_with_params(algo, 1e-5, 0.75)
    }

    /// Get reduced structure with custom parameters.
    ///
    /// # Arguments
    ///
    /// * `algo` - Reduction algorithm (Niggli or LLL)
    /// * `niggli_tol` - Tolerance for Niggli reduction (ignored if LLL)
    /// * `lll_delta` - Delta parameter for LLL reduction (ignored if Niggli)
    pub fn get_reduced_structure_with_params(
        &self,
        algo: ReductionAlgo,
        niggli_tol: f64,
        lll_delta: f64,
    ) -> Result<Self> {
        // Get reduced lattice
        let reduced_lattice = match algo {
            ReductionAlgo::Niggli => self.lattice.get_niggli_reduced(niggli_tol)?,
            ReductionAlgo::LLL => self.lattice.get_lll_reduced(lll_delta),
        };

        // Convert current fractional coords to Cartesian
        let cart_coords = self.lattice.get_cartesian_coords(&self.frac_coords);

        // Convert Cartesian to new fractional coords and wrap to [0, 1)
        let new_frac_coords: Vec<Vector3<f64>> = reduced_lattice
            .get_fractional_coords(&cart_coords)
            .into_iter()
            .map(|fc| crate::pbc::wrap_frac_coords(&fc))
            .collect();

        Structure::try_new_from_occupancies_with_properties(
            reduced_lattice,
            self.site_occupancies.clone(),
            new_frac_coords,
            self.properties.clone(),
        )
    }
}

// =============================================================================
// Supercell Helper Functions
// =============================================================================

/// Generate all fractional lattice points inside a supercell.
///
/// For a scaling matrix S, finds all integer vectors (i, j, k) such that
/// S^(-1) * (i, j, k) is in [0, 1)^3. These are the lattice translation
/// vectors needed to fill the supercell.
fn lattice_points_in_supercell(scaling_matrix: &[[i32; 3]; 3]) -> Vec<Vector3<f64>> {
    // Compute determinant using i64 to avoid overflow for large scaling matrices
    let mat: [[i64; 3]; 3] =
        std::array::from_fn(|row| std::array::from_fn(|col| scaling_matrix[row][col] as i64));
    let det = mat[0][0] * (mat[1][1] * mat[2][2] - mat[1][2] * mat[2][1])
        - mat[0][1] * (mat[1][0] * mat[2][2] - mat[1][2] * mat[2][0])
        + mat[0][2] * (mat[1][0] * mat[2][1] - mat[1][1] * mat[2][0]);
    let n_points = det.unsigned_abs() as usize;

    if n_points == 0 {
        return vec![];
    }

    // Fast path for diagonal matrices (most common case)
    let is_diagonal = scaling_matrix[0][1] == 0
        && scaling_matrix[0][2] == 0
        && scaling_matrix[1][0] == 0
        && scaling_matrix[1][2] == 0
        && scaling_matrix[2][0] == 0
        && scaling_matrix[2][1] == 0;

    if is_diagonal {
        // For diagonal entry s, valid integers i satisfy 0 <= i/s < 1:
        // - If s > 0: i ∈ {0, 1, ..., s-1}
        // - If s < 0: i ∈ {s+1, s+2, ..., 0}
        fn diag_range(s: i32) -> std::ops::Range<i32> {
            if s > 0 { 0..s } else { s + 1..1 }
        }
        let (sx, sy, sz) = (
            scaling_matrix[0][0],
            scaling_matrix[1][1],
            scaling_matrix[2][2],
        );
        let mut points = Vec::with_capacity(n_points);
        for idx in diag_range(sx) {
            for jdx in diag_range(sy) {
                for kdx in diag_range(sz) {
                    points.push(Vector3::new(idx as f64, jdx as f64, kdx as f64));
                }
            }
        }
        return points;
    }

    // General case: search all candidates and filter by inverse transform
    let scale = Matrix3::new(
        scaling_matrix[0][0] as f64,
        scaling_matrix[0][1] as f64,
        scaling_matrix[0][2] as f64,
        scaling_matrix[1][0] as f64,
        scaling_matrix[1][1] as f64,
        scaling_matrix[1][2] as f64,
        scaling_matrix[2][0] as f64,
        scaling_matrix[2][1] as f64,
        scaling_matrix[2][2] as f64,
    );

    let inv_scale = match scale.try_inverse() {
        Some(inv) => inv,
        None => return vec![], // Zero determinant
    };

    let mut points = Vec::with_capacity(n_points);

    // Search range: need to cover all points that could map into the unit cell
    let max_val = scaling_matrix
        .iter()
        .flat_map(|row| row.iter())
        .map(|&x| x.abs())
        .max()
        .unwrap_or(1);
    let search_range = max_val * 2;

    const TOL: f64 = 1e-10;
    for idx in -search_range..=search_range {
        for jdx in -search_range..=search_range {
            for kdx in -search_range..=search_range {
                let lattice_pt = Vector3::new(idx as f64, jdx as f64, kdx as f64);
                let frac = inv_scale * lattice_pt;

                // Check if transformed point is in [0, 1)^3 (with tolerance)
                if frac[0] >= -TOL
                    && frac[0] < 1.0 - TOL
                    && frac[1] >= -TOL
                    && frac[1] < 1.0 - TOL
                    && frac[2] >= -TOL
                    && frac[2] < 1.0 - TOL
                {
                    points.push(lattice_pt);
                }
            }
        }
    }

    // Sanity check: we should have exactly |det| points
    debug_assert_eq!(
        points.len(),
        n_points,
        "Expected {} lattice points, found {}",
        n_points,
        points.len()
    );

    points
}

// =============================================================================
// Mul Trait Implementations for Supercell
// =============================================================================

impl std::ops::Mul<i32> for &Structure {
    type Output = Structure;

    /// Create an n x n x n uniform supercell.
    ///
    /// # Panics
    ///
    /// Panics if n <= 0.
    fn mul(self, n: i32) -> Structure {
        assert!(n > 0, "Supercell scaling must be positive, got {n}");
        self.make_supercell_diag([n, n, n])
    }
}

impl std::ops::Mul<[i32; 3]> for &Structure {
    type Output = Structure;

    /// Create an nx x ny x nz diagonal supercell.
    ///
    /// # Panics
    ///
    /// Panics if any n <= 0.
    fn mul(self, ns: [i32; 3]) -> Structure {
        assert!(
            ns.iter().all(|&n| n > 0),
            "Supercell scaling must be positive, got {ns:?}"
        );
        self.make_supercell_diag(ns)
    }
}

// =============================================================================
// Symmetry Operations
// =============================================================================

/// A crystallographic symmetry operation: rotation + translation.
///
/// Transforms coordinates as: `new = rotation * old + translation`
///
/// In fractional coordinates:
///   `new_frac = rotation @ old_frac + translation`
///
/// In Cartesian coordinates:
///   `new_cart = rotation @ old_cart + translation`
#[derive(Debug, Clone)]
pub struct SymmOp {
    /// 3x3 rotation/rotation-reflection matrix.
    pub rotation: Matrix3<f64>,
    /// Translation vector.
    pub translation: Vector3<f64>,
}

impl SymmOp {
    /// Create a new symmetry operation from rotation matrix and translation vector.
    pub fn new(rotation: Matrix3<f64>, translation: Vector3<f64>) -> Self {
        Self {
            rotation,
            translation,
        }
    }

    /// Identity operation (no transformation).
    pub fn identity() -> Self {
        Self::new(Matrix3::identity(), Vector3::zeros())
    }

    /// Inversion through the origin.
    pub fn inversion() -> Self {
        Self::new(-Matrix3::identity(), Vector3::zeros())
    }

    /// Pure translation (no rotation).
    pub fn translation(vector: Vector3<f64>) -> Self {
        Self::new(Matrix3::identity(), vector)
    }

    /// Rotation around the z-axis by angle (in radians).
    pub fn rotation_z(angle: f64) -> Self {
        let c = angle.cos();
        let s = angle.sin();
        let rotation = Matrix3::new(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
        Self::new(rotation, Vector3::zeros())
    }
}

// Additional Structure methods for symmetry operations
impl Structure {
    /// Apply a symmetry operation to all sites.
    ///
    /// # Arguments
    ///
    /// * `op` - The symmetry operation to apply
    /// * `fractional` - If true, operation is in fractional coordinates; otherwise Cartesian
    ///
    /// # Returns
    ///
    /// Mutable reference to self for method chaining.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let mut s = make_nacl();
    /// // Inversion through origin
    /// s.apply_operation(&SymmOp::inversion(), true);
    /// ```
    pub fn apply_operation(&mut self, op: &SymmOp, fractional: bool) -> &mut Self {
        if fractional {
            // Apply in fractional coordinates directly
            for fc in &mut self.frac_coords {
                *fc = op.rotation * (*fc) + op.translation;
            }
        } else {
            // Convert to Cartesian, apply operation, convert back
            let cart_coords = self.lattice.get_cartesian_coords(&self.frac_coords);
            let new_cart: Vec<Vector3<f64>> = cart_coords
                .iter()
                .map(|c| op.rotation * c + op.translation)
                .collect();
            self.frac_coords = self.lattice.get_fractional_coords(&new_cart);
        }
        self
    }

    /// Apply a symmetry operation and return a new structure.
    ///
    /// This is a non-mutating version of `apply_operation` that returns
    /// a transformed copy while leaving the original unchanged.
    ///
    /// # Arguments
    ///
    /// * `op` - The symmetry operation to apply
    /// * `fractional` - If true, operation is in fractional coordinates; otherwise Cartesian
    pub fn apply_operation_copy(&self, op: &SymmOp, fractional: bool) -> Self {
        let mut copy = self.clone();
        copy.apply_operation(op, fractional);
        copy
    }

    // =========================================================================
    // Physical Properties
    // =========================================================================

    /// Volume of the unit cell in Angstrom^3.
    #[inline]
    pub fn volume(&self) -> f64 {
        self.lattice.volume()
    }

    /// Total mass in atomic mass units (u), accounting for partial occupancies.
    pub fn total_mass(&self) -> f64 {
        self.site_occupancies
            .iter()
            .flat_map(|site_occ| site_occ.species.iter())
            .map(|(sp, occ)| sp.element.atomic_mass() * occ)
            .sum()
    }

    /// Density in g/cm^3, or `None` for zero-volume structures.
    pub fn density(&self) -> Option<f64> {
        let volume = self.volume();
        if volume <= 0.0 {
            return None;
        }
        // 1 amu = 1.66053906660e-24 g
        // 1 Å = 1e-8 cm, so 1 Å³ = 1e-24 cm³
        // density = (mass_amu * 1.66054e-24 g) / (volume_ang3 * 1e-24 cm³)
        const AMU_TO_G_PER_CM3: f64 = 1.66053906660;
        Some(self.total_mass() * AMU_TO_G_PER_CM3 / volume)
    }

    // =========================================================================
    // Site Properties
    // =========================================================================

    /// Get site properties for a specific site index.
    ///
    /// # Panics
    ///
    /// Panics if `idx` is out of bounds.
    pub fn site_properties(&self, idx: usize) -> &HashMap<String, serde_json::Value> {
        assert!(
            idx < self.num_sites(),
            "Site index {} out of bounds (num_sites={})",
            idx,
            self.num_sites()
        );
        &self.site_occupancies[idx].properties
    }

    /// Get mutable site properties for a specific site index.
    ///
    /// # Panics
    ///
    /// Panics if `idx` is out of bounds.
    pub fn site_properties_mut(&mut self, idx: usize) -> &mut HashMap<String, serde_json::Value> {
        assert!(
            idx < self.num_sites(),
            "Site index {} out of bounds (num_sites={})",
            idx,
            self.num_sites()
        );
        &mut self.site_occupancies[idx].properties
    }

    /// Set a site property.
    ///
    /// # Panics
    ///
    /// Panics if `idx` is out of bounds.
    pub fn set_site_property(
        &mut self,
        idx: usize,
        key: &str,
        value: serde_json::Value,
    ) -> &mut Self {
        assert!(
            idx < self.num_sites(),
            "Site index {} out of bounds (num_sites={})",
            idx,
            self.num_sites()
        );
        self.site_occupancies[idx]
            .properties
            .insert(key.to_string(), value);
        self
    }

    /// Get all site properties as a vector (parallel to frac_coords).
    pub fn all_site_properties(&self) -> Vec<&HashMap<String, serde_json::Value>> {
        self.site_occupancies
            .iter()
            .map(|so| &so.properties)
            .collect()
    }

    /// Get label for a specific site.
    ///
    /// Returns the explicit label if set in site properties, otherwise falls back
    /// to `species_string()` (e.g., "Fe" or "Fe:0.5, Co:0.5").
    ///
    /// # Panics
    ///
    /// Panics if `idx` is out of bounds.
    pub fn site_label(&self, idx: usize) -> String {
        assert!(
            idx < self.num_sites(),
            "Site index {} out of bounds (num_sites={})",
            idx,
            self.num_sites()
        );
        self.site_occupancies[idx]
            .properties
            .get("label")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| self.site_occupancies[idx].species_string())
    }

    /// Set label for a specific site.
    ///
    /// The label is stored in the site's properties as `"label"`.
    /// Returns self for method chaining.
    ///
    /// # Panics
    ///
    /// Panics if `idx` is out of bounds.
    pub fn set_site_label(&mut self, idx: usize, label: &str) -> &mut Self {
        assert!(
            idx < self.num_sites(),
            "Site index {} out of bounds (num_sites={})",
            idx,
            self.num_sites()
        );
        self.site_occupancies[idx]
            .properties
            .insert("label".to_string(), serde_json::json!(label));
        self
    }

    /// Get labels for all sites.
    ///
    /// Returns a vector of labels, one per site. Sites without explicit labels
    /// return their `species_string()`.
    pub fn site_labels(&self) -> Vec<String> {
        (0..self.num_sites())
            .map(|idx| self.site_label(idx))
            .collect()
    }

    /// Normalize all species symbols in the structure.
    ///
    /// Since structures are already normalized during parsing (element symbols
    /// are converted to Element enum variants), this is a no-op. Provided for
    /// API symmetry with pymatgen.
    ///
    /// Returns mutable reference to self for method chaining.
    pub fn normalize(&mut self) -> &mut Self {
        // Already normalized - Element enum guarantees valid symbols
        self
    }

    // =========================================================================
    // Site Manipulation
    // =========================================================================

    /// Translate specific sites by a vector.
    ///
    /// # Arguments
    /// * `indices` - Site indices to translate
    /// * `vector` - Translation vector
    /// * `frac_coords` - If true, vector is in fractional coords; otherwise Cartesian
    ///
    /// # Panics
    /// Panics if any index is out of bounds.
    pub fn translate_sites(
        &mut self,
        indices: &[usize],
        vector: Vector3<f64>,
        frac_coords: bool,
    ) -> &mut Self {
        let frac_vector = if frac_coords {
            vector
        } else {
            self.lattice.get_fractional_coords(&[vector])[0]
        };
        for &idx in indices {
            assert!(
                idx < self.frac_coords.len(),
                "Index {idx} out of bounds (num_sites = {})",
                self.num_sites()
            );
            self.frac_coords[idx] += frac_vector;
        }
        self
    }

    /// Perturb all sites by random vectors with magnitude up to `distance` Angstroms.
    ///
    /// # Arguments
    /// * `distance` - Maximum perturbation distance in Angstroms
    /// * `min_distance` - Minimum perturbation distance (default 0)
    /// * `seed` - Optional seed for reproducibility
    ///
    /// # Panics
    /// Panics if distance < min_distance.
    pub fn perturb(
        &mut self,
        distance: f64,
        min_distance: Option<f64>,
        seed: Option<u64>,
    ) -> &mut Self {
        use rand::SeedableRng;
        use rand::rngs::StdRng;

        let min_dist = min_distance.unwrap_or(0.0);
        assert!(
            distance >= min_dist,
            "distance ({distance}) must be >= min_distance ({min_dist})"
        );

        // Use seeded RNG for reproducibility, or thread RNG for randomness
        let mut seeded_rng;
        let mut thread_rng;
        let rng: &mut dyn rand::RngCore = match seed {
            Some(s) => {
                seeded_rng = StdRng::seed_from_u64(s);
                &mut seeded_rng
            }
            None => {
                thread_rng = rand::thread_rng();
                &mut thread_rng
            }
        };

        for idx in 0..self.num_sites() {
            let rand_vec = get_random_vector(rng, min_dist, distance);
            self.translate_sites(&[idx], rand_vec, false);
        }
        self
    }
}

// =============================================================================
// Ordering and Enumeration Methods
// =============================================================================

impl Structure {
    /// Scale structure so fractional occupancies become integral site counts.
    ///
    /// Creates the smallest supercell where fractional occupancies can be represented
    /// as whole numbers of fully-occupied sites. After transformation, all sites have
    /// occupancy 1.0, ready for use with `order_disordered`.
    ///
    /// # Arguments
    ///
    /// * `max_denominator` - Maximum denominator when rationalizing occupancies
    /// * `tolerance` - Tolerance for matching occupancies to fractions
    ///
    /// # Returns
    ///
    /// A new structure with discretized occupancies.
    ///
    /// # Example
    ///
    /// ```ignore
    /// // Structure with 1 site at 0.75 Li, 0.25 vacancy
    /// let discretized = structure.discretize_occupancies(10, 0.01)?;
    /// // Now has 4x supercell with 4 sites, each at 1.0 occupancy
    /// ```
    pub fn discretize_occupancies(&self, max_denominator: u32, tolerance: f64) -> Result<Self> {
        use crate::transformations::{DiscretizeOccupanciesTransform, Transform};
        let transform = DiscretizeOccupanciesTransform::new(max_denominator, tolerance);
        transform.applied(self)
    }

    /// Enumerate all orderings of a disordered structure.
    ///
    /// Takes a structure with disordered sites (multiple species per site) and
    /// enumerates all possible ordered configurations. Structures are optionally
    /// ranked by Ewald energy.
    ///
    /// # Arguments
    ///
    /// * `config` - Configuration options for ordering
    ///
    /// # Returns
    ///
    /// A vector of ordered structures, optionally sorted by energy.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let config = OrderDisorderedConfig {
    ///     max_structures: Some(100),
    ///     sort_by_energy: true,
    ///     ..Default::default()
    /// };
    /// let orderings = disordered.order_disordered(config)?;
    /// for s in orderings {
    ///     println!("Energy: {:?}", s.properties.get("ewald_energy"));
    /// }
    /// ```
    pub fn order_disordered(&self, config: OrderDisorderedConfig) -> Result<Vec<Self>> {
        use crate::transformations::{OrderDisorderedTransform, TransformMany};
        let transform = OrderDisorderedTransform::new(config);
        transform.apply_all(self)
    }

    /// Enumerate all ways to partially remove a species.
    ///
    /// Removes a fraction of a specific species and enumerates all possible
    /// removal patterns, ranked by Ewald energy.
    ///
    /// # Arguments
    ///
    /// * `config` - Configuration specifying species, fraction, and options
    ///
    /// # Returns
    ///
    /// A vector of structures with partial removals, sorted by energy.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let config = PartialRemoveConfig::new(Species::new(Element::Li, Some(1)), 0.5);
    /// let removed = lio2.partial_remove(config)?;
    /// // Each structure has half the Li atoms removed
    /// ```
    pub fn partial_remove(&self, config: PartialRemoveConfig) -> Result<Vec<Self>> {
        use crate::transformations::{PartialRemoveTransform, TransformMany};
        let transform = PartialRemoveTransform::new(config);
        transform.apply_all(self)
    }

    /// Generate all derivative structures (supercells) in size range.
    ///
    /// Enumerates derivative structures from the parent lattice using HNF/SNF
    /// algorithms. This is useful for systematic exploration of supercells
    /// and ordered configurations.
    ///
    /// # Arguments
    ///
    /// * `min_size` - Minimum supercell size (number of formula units)
    /// * `max_size` - Maximum supercell size (number of formula units)
    ///
    /// # Returns
    ///
    /// A vector of derivative structures.
    ///
    /// # Example
    ///
    /// ```ignore
    /// // Generate all supercells with 1-4 formula units
    /// let derivatives = parent.enumerate_derivatives(1, 4)?;
    /// for d in derivatives {
    ///     println!("Volume ratio: {}", d.volume() / parent.volume());
    /// }
    /// ```
    pub fn enumerate_derivatives(&self, min_size: usize, max_size: usize) -> Result<Vec<Self>> {
        use crate::algorithms::EnumerateDerivativesTransform;
        use crate::transformations::TransformMany;
        let config = EnumConfig {
            min_size,
            max_size,
            ..Default::default()
        };
        let transform = EnumerateDerivativesTransform::new(config);
        transform.apply_all(self)
    }
}

// =============================================================================
// Random Vector Generation for Perturbation
// =============================================================================

/// Generate a random vector with magnitude uniformly distributed in [min_dist, max_dist].
///
/// Direction is uniformly distributed on the unit sphere using rejection sampling.
fn get_random_vector(rng: &mut dyn rand::RngCore, min_dist: f64, max_dist: f64) -> Vector3<f64> {
    use rand::Rng;

    loop {
        // Generate point in cube [-1, 1]^3
        let x: f64 = rng.gen_range(-1.0..1.0);
        let y: f64 = rng.gen_range(-1.0..1.0);
        let z: f64 = rng.gen_range(-1.0..1.0);
        let norm_sq = x * x + y * y + z * z;

        // Rejection sampling: accept if inside unit sphere and not at origin
        if norm_sq > 0.01 && norm_sq <= 1.0 {
            let norm = norm_sq.sqrt();
            let magnitude = rng.gen_range(min_dist..=max_dist);
            return Vector3::new(x, y, z) / norm * magnitude;
        }
    }
}

/// Wrap fractional coordinate difference to [-0.5, 0.5) for minimum image convention.
#[inline]
fn wrap_frac_diff(diff: Vector3<f64>) -> Vector3<f64> {
    Vector3::new(
        diff[0] - diff[0].round(),
        diff[1] - diff[1].round(),
        diff[2] - diff[2].round(),
    )
}

/// Linear interpolation of lattice parameters (lengths and angles).
///
/// Creates a new lattice with linearly interpolated a, b, c lengths and
/// alpha, beta, gamma angles between the start and end lattices.
fn interpolate_lattices_linear(start: &Lattice, end: &Lattice, x: f64) -> Lattice {
    let start_lengths = start.lengths();
    let start_angles = start.angles();
    let end_lengths = end.lengths();
    let end_angles = end.angles();

    let new_lengths = start_lengths + x * (end_lengths - start_lengths);
    let new_angles = start_angles + x * (end_angles - start_angles);

    Lattice::from_parameters(
        new_lengths[0],
        new_lengths[1],
        new_lengths[2],
        new_angles[0],
        new_angles[1],
        new_angles[2],
    )
}

// =============================================================================
// Transformation Methods
// =============================================================================

impl Structure {
    /// Rotate the structure around an arbitrary axis by a given angle.
    ///
    /// Uses Rodrigues' rotation formula. Both the lattice and atomic positions
    /// are rotated together, so fractional coordinates remain unchanged.
    ///
    /// # Arguments
    /// * `axis` - Rotation axis (will be normalized)
    /// * `angle` - Rotation angle in radians
    ///
    /// # Errors
    /// Returns an error if the rotation axis has zero length.
    ///
    /// # Example
    /// ```rust,ignore
    /// use nalgebra::Vector3;
    /// use std::f64::consts::FRAC_PI_2;
    ///
    /// let rotated = structure.rotate(Vector3::z(), FRAC_PI_2)?;
    /// ```
    pub fn rotate(&self, axis: Vector3<f64>, angle: f64) -> Result<Self> {
        // Normalize axis, error if zero-length
        let axis = axis
            .try_normalize(f64::EPSILON)
            .ok_or_else(|| FerroxError::TransformError {
                reason: "rotation axis has zero length".to_string(),
            })?;

        // Rodrigues' rotation formula
        let cos_a = angle.cos();
        let sin_a = angle.sin();
        let one_minus_cos = 1.0 - cos_a;
        let (ax, ay, az) = (axis.x, axis.y, axis.z);

        let rot = Matrix3::new(
            one_minus_cos * ax * ax + cos_a,
            one_minus_cos * ax * ay - sin_a * az,
            one_minus_cos * ax * az + sin_a * ay,
            one_minus_cos * ax * ay + sin_a * az,
            one_minus_cos * ay * ay + cos_a,
            one_minus_cos * ay * az - sin_a * ax,
            one_minus_cos * ax * az - sin_a * ay,
            one_minus_cos * ay * az + sin_a * ax,
            one_minus_cos * az * az + cos_a,
        );

        // Rotate lattice vectors: L_new = R * L_old
        let new_matrix = rot * self.lattice.matrix();
        let new_lattice = Lattice::from_matrix_with_pbc(new_matrix, self.lattice.pbc);

        // Fractional coordinates remain unchanged for rigid rotation
        let mut result = self.clone();
        result.lattice = new_lattice;
        Ok(result)
    }

    /// Substitute one species for another throughout the structure.
    ///
    /// All occurrences of `from` species are replaced with `to` species.
    ///
    /// # Arguments
    /// * `from` - The species to replace
    /// * `to` - The replacement species
    ///
    /// # Example
    /// ```rust,ignore
    /// use ferrox::species::Species;
    /// use ferrox::element::Element;
    ///
    /// let substituted = structure.substitute(
    ///     Species::neutral(Element::Fe),
    ///     Species::neutral(Element::Co),
    /// )?;
    /// ```
    pub fn substitute(&self, from: Species, to: Species) -> Result<Self> {
        let mut result = self.clone();
        for site_occ in &mut result.site_occupancies {
            for (species, _) in &mut site_occ.species {
                if *species == from {
                    *species = to;
                }
            }
        }
        Ok(result)
    }

    /// Substitute multiple species according to a mapping.
    ///
    /// Each species in the map's keys is replaced with the corresponding value.
    ///
    /// # Arguments
    /// * `map` - HashMap mapping old species to new species
    ///
    /// # Example
    /// ```rust,ignore
    /// use std::collections::HashMap;
    /// use ferrox::species::Species;
    /// use ferrox::element::Element;
    ///
    /// let mut map = HashMap::new();
    /// map.insert(Species::neutral(Element::Fe), Species::neutral(Element::Co));
    /// map.insert(Species::neutral(Element::Ni), Species::neutral(Element::Cu));
    /// let substituted = structure.substitute_map(map)?;
    /// ```
    pub fn substitute_map(&self, map: HashMap<Species, Species>) -> Result<Self> {
        let mut result = self.clone();
        for site_occ in &mut result.site_occupancies {
            for (species, _) in &mut site_occ.species {
                if let Some(replacement) = map.get(species) {
                    *species = *replacement;
                }
            }
        }
        Ok(result)
    }

    /// Remove all sites containing the specified species.
    ///
    /// Sites that have any of the specified species in their occupancy are removed.
    ///
    /// # Arguments
    /// * `species` - Slice of species to remove
    ///
    /// # Example
    /// ```rust,ignore
    /// use ferrox::species::Species;
    /// use ferrox::element::Element;
    ///
    /// let stripped = structure.remove_species(&[
    ///     Species::neutral(Element::Li),
    /// ])?;
    /// ```
    pub fn remove_species(&self, species: &[Species]) -> Result<Self> {
        let species_to_remove: HashSet<&Species> = species.iter().collect();

        // Find indices of sites to keep (those without any species to remove)
        let indices_to_keep: Vec<usize> = self
            .site_occupancies
            .iter()
            .enumerate()
            .filter(|(_, site_occ)| {
                !site_occ
                    .species
                    .iter()
                    .any(|(sp, _)| species_to_remove.contains(sp))
            })
            .map(|(idx, _)| idx)
            .collect();

        let mut result = self.clone();
        result.site_occupancies = indices_to_keep
            .iter()
            .map(|&idx| self.site_occupancies[idx].clone())
            .collect();
        result.frac_coords = indices_to_keep
            .iter()
            .map(|&idx| self.frac_coords[idx])
            .collect();

        Ok(result)
    }

    /// Apply a deformation gradient to the lattice.
    ///
    /// The deformation gradient F transforms the lattice as:
    /// `new_lattice = F * old_lattice`
    ///
    /// Fractional coordinates remain unchanged (they're relative to the lattice).
    ///
    /// # Arguments
    /// * `gradient` - 3x3 deformation gradient tensor
    ///
    /// # Example
    /// ```rust,ignore
    /// use nalgebra::Matrix3;
    ///
    /// // Apply 1% tensile strain along x
    /// let f = Matrix3::new(
    ///     1.01, 0.0, 0.0,
    ///     0.0, 1.0, 0.0,
    ///     0.0, 0.0, 1.0,
    /// );
    /// let deformed = structure.deform(f)?;
    /// ```
    pub fn deform(&self, gradient: Matrix3<f64>) -> Result<Self> {
        let new_matrix = gradient * self.lattice.matrix();
        let new_lattice = Lattice::from_matrix_with_pbc(new_matrix, self.lattice.pbc);

        let mut result = self.clone();
        result.lattice = new_lattice;
        Ok(result)
    }

    /// Randomly perturb atomic positions.
    ///
    /// Each site is translated by a random vector with magnitude uniformly
    /// distributed in [0, distance].
    ///
    /// # Arguments
    /// * `distance` - Maximum perturbation distance in Angstroms
    /// * `seed` - Optional seed for reproducibility
    ///
    /// # Example
    /// ```rust,ignore
    /// // Perturb all atoms by up to 0.1 Å with fixed seed
    /// let perturbed = structure.perturb_copy(0.1, Some(42))?;
    /// ```
    pub fn perturb_copy(&self, distance: f64, seed: Option<u64>) -> Result<Self> {
        let mut result = self.clone();
        result.perturb(distance, None, seed);
        Ok(result)
    }

    // -------------------------------------------------------------------------
    // Site-level transformations
    // -------------------------------------------------------------------------

    /// Insert new sites into the structure.
    ///
    /// Creates a new structure with additional sites at the specified coordinates.
    ///
    /// # Arguments
    ///
    /// * `species` - Species for each new site
    /// * `coords` - Coordinates of each new site
    /// * `fractional` - Whether coordinates are fractional (true) or Cartesian (false)
    ///
    /// # Errors
    ///
    /// Returns an error if the lengths of `species` and `coords` don't match.
    pub fn insert_sites(
        &self,
        species: &[Species],
        coords: &[Vector3<f64>],
        fractional: bool,
    ) -> Result<Self> {
        if species.len() != coords.len() {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "species and coords must have same length ({} vs {})",
                    species.len(),
                    coords.len()
                ),
            });
        }

        let mut result = self.clone();
        for (sp, coord) in species.iter().zip(coords.iter()) {
            let frac_coord = if fractional {
                *coord
            } else {
                result.lattice.get_fractional_coord(coord)
            };
            result.site_occupancies.push(SiteOccupancy::ordered(*sp));
            result.frac_coords.push(frac_coord);
        }
        Ok(result)
    }

    /// Remove sites by index.
    ///
    /// Creates a new structure with the specified sites removed.
    ///
    /// # Errors
    ///
    /// Returns an error if any index is out of bounds.
    pub fn remove_sites(&self, indices: &[usize]) -> Result<Self> {
        let n_sites = self.num_sites();
        for &idx in indices {
            if idx >= n_sites {
                return Err(FerroxError::InvalidStructure {
                    index: idx,
                    reason: format!("Site index {} out of bounds (num_sites={})", idx, n_sites),
                });
            }
        }

        let remove_set: HashSet<usize> = indices.iter().copied().collect();

        let (new_occupancies, new_coords): (Vec<_>, Vec<_>) = self
            .site_occupancies
            .iter()
            .zip(self.frac_coords.iter())
            .enumerate()
            .filter(|(idx, _)| !remove_set.contains(idx))
            .map(|(_, (occ, coord))| (occ.clone(), *coord))
            .unzip();

        let mut result = self.clone();
        result.site_occupancies = new_occupancies;
        result.frac_coords = new_coords;
        Ok(result)
    }

    /// Replace species at specific site indices.
    ///
    /// Creates a new structure with the species at the specified sites replaced.
    ///
    /// # Errors
    ///
    /// Returns an error if any index is out of bounds.
    pub fn replace_site_species(&self, replacements: &[(usize, Species)]) -> Result<Self> {
        let n_sites = self.num_sites();

        for &(idx, _) in replacements {
            if idx >= n_sites {
                return Err(FerroxError::InvalidStructure {
                    index: idx,
                    reason: format!("Site index {} out of bounds (num_sites={})", idx, n_sites),
                });
            }
        }

        let mut result = self.clone();
        for &(idx, species) in replacements {
            result.site_occupancies[idx] = SiteOccupancy::ordered(species);
        }
        Ok(result)
    }

    /// Translate specific sites by a vector, returning a new structure.
    ///
    /// Creates a new structure with the specified sites translated. Duplicate
    /// indices are deduplicated to avoid translating the same site multiple times.
    ///
    /// This is the Result-returning, copy-based version of [`translate_sites`].
    ///
    /// # Errors
    ///
    /// Returns an error if any index is out of bounds.
    pub fn translate_sites_copy(
        &self,
        indices: &[usize],
        vector: Vector3<f64>,
        fractional: bool,
    ) -> Result<Self> {
        let n_sites = self.num_sites();

        // Deduplicate indices to avoid translating the same site multiple times
        let mut unique_indices: Vec<usize> = indices.to_vec();
        unique_indices.sort_unstable();
        unique_indices.dedup();

        // Validate indices
        for &idx in &unique_indices {
            if idx >= n_sites {
                return Err(FerroxError::InvalidStructure {
                    index: idx,
                    reason: format!("Site index {} out of bounds (num_sites={})", idx, n_sites),
                });
            }
        }

        // Convert to fractional if needed
        let frac_vector = if fractional {
            vector
        } else {
            self.lattice.get_fractional_coord(&vector)
        };

        let mut result = self.clone();
        for &idx in &unique_indices {
            result.frac_coords[idx] += frac_vector;
        }
        Ok(result)
    }

    /// Translate all sites by a vector.
    ///
    /// Creates a new structure with all sites translated by the given vector.
    pub fn translate_all(&self, vector: Vector3<f64>, fractional: bool) -> Result<Self> {
        let frac_vector = if fractional {
            vector
        } else {
            self.lattice.get_fractional_coord(&vector)
        };

        let mut result = self.clone();
        for fc in &mut result.frac_coords {
            *fc += frac_vector;
        }
        Ok(result)
    }

    /// Apply radial distortion around a center site.
    ///
    /// Displaces neighboring sites radially outward (positive displacement)
    /// or inward (negative displacement) from a center site. Useful for
    /// modeling defects and local relaxation effects.
    ///
    /// # Arguments
    ///
    /// * `center_idx` - Index of the center site
    /// * `displacement` - Radial displacement in Angstroms (positive = outward, negative = inward)
    /// * `cutoff` - Cutoff radius in Angstroms (None = only nearest neighbors)
    ///
    /// # Errors
    ///
    /// Returns an error if `center_idx` is out of bounds.
    pub fn radial_distort(
        &self,
        center_idx: usize,
        displacement: f64,
        cutoff: Option<f64>,
    ) -> Result<Self> {
        let n_sites = self.num_sites();

        if center_idx >= n_sites {
            return Err(FerroxError::InvalidStructure {
                index: center_idx,
                reason: format!(
                    "Center site index {} out of bounds (num_sites={})",
                    center_idx, n_sites
                ),
            });
        }

        let mut result = self.clone();

        // Get the center position in Cartesian coordinates
        let center_frac = result.frac_coords[center_idx];
        let center_cart = result.lattice.get_cartesian_coord(&center_frac);

        // Determine cutoff (if None, find nearest neighbor distance)
        let effective_cutoff = match cutoff {
            Some(r) => r,
            None => {
                // Find minimum non-zero distance to center
                let mut min_dist = f64::INFINITY;
                for idx in 0..n_sites {
                    if idx == center_idx {
                        continue;
                    }
                    let dist = result.get_distance(center_idx, idx);
                    if dist > 1e-8 && dist < min_dist {
                        min_dist = dist;
                    }
                }
                // Add small tolerance to include nearest neighbors
                min_dist + 0.1
            }
        };

        // Apply radial displacement to sites within cutoff
        for idx in 0..n_sites {
            if idx == center_idx {
                continue;
            }

            let fc = result.frac_coords[idx];
            let cart = result.lattice.get_cartesian_coord(&fc);
            let diff = cart - center_cart;
            let dist = diff.norm();

            if dist > 1e-8 && dist <= effective_cutoff {
                // Compute unit radial vector
                let radial_unit = diff / dist;
                // Apply displacement
                let new_cart = cart + radial_unit * displacement;
                result.frac_coords[idx] = result.lattice.get_fractional_coord(&new_cart);
            }
        }

        Ok(result)
    }
}

// =============================================================================
// Symmetry Helper Functions
// =============================================================================

/// Validate symprec parameter for symmetry operations.
fn validate_symprec(symprec: f64) -> Result<()> {
    if !symprec.is_finite() || symprec <= 0.0 {
        return Err(FerroxError::InvalidStructure {
            index: 0,
            reason: format!("symprec must be positive and finite, got {symprec}"),
        });
    }
    Ok(())
}

/// Convert moyo Operations to arrays for easy serialization.
pub(crate) fn moyo_ops_to_arrays(ops: &[MoyoOperation]) -> Vec<SymmetryOperation> {
    ops.iter()
        .map(|op| {
            let rot = std::array::from_fn(|i| std::array::from_fn(|j| op.rotation[(i, j)]));
            let trans = [op.translation.x, op.translation.y, op.translation.z];
            (rot, trans)
        })
        .collect()
}

/// Get crystal system from spacegroup number.
pub(crate) fn spacegroup_to_crystal_system(sg: i32) -> &'static str {
    match sg {
        1..=2 => "triclinic",
        3..=15 => "monoclinic",
        16..=74 => "orthorhombic",
        75..=142 => "tetragonal",
        143..=167 => "trigonal",
        168..=194 => "hexagonal",
        195..=230 => "cubic",
        _ => "unknown",
    }
}

// =============================================================================
// Slab Generation
// =============================================================================

/// Configuration for slab generation.
#[derive(Debug, Clone)]
pub struct SlabConfig {
    /// Miller indices (h, k, l) defining the surface orientation.
    pub miller_index: [i32; 3],
    /// Minimum thickness of the slab in Angstroms (or unit planes if in_unit_planes=true).
    pub min_slab_size: f64,
    /// Minimum vacuum layer thickness in Angstroms.
    pub min_vacuum_size: f64,
    /// If true, center the slab in the vacuum region.
    pub center_slab: bool,
    /// If true, min_slab_size is interpreted as number of unit planes, not Angstroms.
    pub in_unit_planes: bool,
    /// If true, reduce to primitive surface unit cell (not yet implemented).
    pub primitive: bool,
    /// Symmetry precision for identifying unique terminations.
    pub symprec: f64,
    /// If Some(idx), only generate the termination at this index (0-indexed).
    /// This avoids computing all terminations when only one is needed.
    pub termination_index: Option<usize>,
}

impl Default for SlabConfig {
    fn default() -> Self {
        Self {
            miller_index: [1, 0, 0],
            min_slab_size: 10.0,
            min_vacuum_size: 10.0,
            center_slab: true,
            in_unit_planes: false,
            primitive: false,
            symprec: 0.01,
            termination_index: None,
        }
    }
}

impl SlabConfig {
    /// Create a new SlabConfig with the given Miller indices.
    #[must_use]
    pub fn new(miller_index: [i32; 3]) -> Self {
        Self {
            miller_index,
            ..Default::default()
        }
    }

    /// Set the minimum slab thickness in Angstroms.
    #[must_use]
    pub fn with_min_slab_size(mut self, size: f64) -> Self {
        self.min_slab_size = size;
        self
    }

    /// Set the minimum vacuum layer thickness in Angstroms.
    #[must_use]
    pub fn with_min_vacuum_size(mut self, size: f64) -> Self {
        self.min_vacuum_size = size;
        self
    }

    /// Set whether to center the slab in the vacuum region.
    #[must_use]
    pub fn with_center_slab(mut self, center: bool) -> Self {
        self.center_slab = center;
        self
    }

    /// Set whether min_slab_size is in unit planes (true) or Angstroms (false).
    #[must_use]
    pub fn with_in_unit_planes(mut self, in_planes: bool) -> Self {
        self.in_unit_planes = in_planes;
        self
    }

    /// Set whether to reduce to primitive surface unit cell (not yet implemented).
    #[must_use]
    pub fn with_primitive(mut self, primitive: bool) -> Self {
        self.primitive = primitive;
        self
    }

    /// Set the symmetry precision for identifying unique terminations.
    #[must_use]
    pub fn with_symprec(mut self, symprec: f64) -> Self {
        self.symprec = symprec;
        self
    }

    /// Set a specific termination index to generate (0-indexed).
    /// When set, only this termination is computed, avoiding unnecessary work.
    #[must_use]
    pub fn with_termination_index(mut self, index: usize) -> Self {
        self.termination_index = Some(index);
        self
    }
}

/// Compute the interplanar spacing (d-spacing) for the given Miller indices.
///
/// # Panics
/// Panics if `hkl` is `[0, 0, 0]` (division by zero).
#[allow(dead_code)] // Used in tests; useful utility for crystallography
fn compute_d_spacing(lattice: &Lattice, hkl: [i32; 3]) -> f64 {
    debug_assert!(hkl != [0, 0, 0], "Miller indices cannot all be zero");
    // d = 1 / |G| where G = h*b1 + k*b2 + l*b3 (reciprocal lattice vector)
    let inv_t = lattice.inv_matrix().transpose();
    let hkl_vec = Vector3::new(hkl[0] as f64, hkl[1] as f64, hkl[2] as f64);
    let g_vec = inv_t * hkl_vec;
    1.0 / g_vec.norm()
}

/// Reduce Miller indices to their smallest integer representation (coprime).
fn reduce_miller_indices(hkl: [i32; 3]) -> [i32; 3] {
    fn gcd(a: i32, b: i32) -> i32 {
        if b == 0 { a.abs() } else { gcd(b, a % b) }
    }
    let g = gcd(gcd(hkl[0], hkl[1]), hkl[2]);
    if g == 0 {
        hkl
    } else {
        [hkl[0] / g, hkl[1] / g, hkl[2] / g]
    }
}

/// Compute GCD of two integers using Euclidean algorithm.
fn int_gcd(a: i32, b: i32) -> i32 {
    if b == 0 { a.abs() } else { int_gcd(b, a % b) }
}

/// Compute LCM of two integers, avoiding intermediate overflow.
/// Returns None if result would overflow i32.
fn int_lcm_checked(a: i32, b: i32) -> Option<i32> {
    if a == 0 || b == 0 {
        return Some(0);
    }
    let gcd = int_gcd(a, b);
    let a_div = a.abs() / gcd;
    // Use checked multiplication to detect overflow
    a_div.checked_mul(b.abs())
}

/// Compute LCM of two integers, saturating at i32::MAX on overflow.
fn int_lcm(a: i32, b: i32) -> i32 {
    int_lcm_checked(a, b).unwrap_or(i32::MAX)
}

/// Calculate the slab transformation matrix using pymatgen's algorithm.
/// This produces minimal supercells by using LCM-based in-plane vector construction.
///
/// The algorithm (matching pymatgen's SlabGenerator):
/// 1. For Miller indices that are 0, use the corresponding basis vector (it's in-plane)
/// 2. For non-zero indices, use LCM trick to construct minimal in-plane vectors
/// 3. For c-direction, use the basis vector with maximum projection onto surface normal
fn get_slab_transformation(lattice: &Lattice, hkl: [i32; 3]) -> [[i32; 3]; 3] {
    let [h, k, l] = reduce_miller_indices(hkl);

    // Calculate surface normal in Cartesian coordinates
    let inv_t = lattice.inv_matrix().transpose();
    let hkl_vec = Vector3::new(h as f64, k as f64, l as f64);
    let normal = inv_t * hkl_vec;
    let normal_len = normal.norm();
    let normal = if normal_len > 1e-10 {
        normal / normal_len
    } else {
        Vector3::new(0.0, 0.0, 1.0)
    };

    let miller = [h, k, l];
    let eye: [[i32; 3]; 3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

    let mut slab_scale_factor: Vec<[i32; 3]> = Vec::new();
    let mut non_orth_ind: Vec<(usize, f64)> = Vec::new();

    for (idx, &miller_idx) in miller.iter().enumerate() {
        if miller_idx == 0 {
            slab_scale_factor.push(eye[idx]);
        } else {
            let lat_vec = lattice.matrix().row(idx).transpose();
            let lat_len = lat_vec.norm();
            let d = (normal.dot(&lat_vec)).abs() / lat_len;
            non_orth_ind.push((idx, d));
        }
    }

    if non_orth_ind.len() > 1 {
        let lcm_miller = non_orth_ind
            .iter()
            .map(|&(idx, _)| miller[idx].abs())
            .fold(1, int_lcm);
        'outer: for i in 0..non_orth_ind.len() {
            for j in (i + 1)..non_orth_ind.len() {
                let (ii, _) = non_orth_ind[i];
                let (jj, _) = non_orth_ind[j];
                let mut scale_factor = [0i32; 3];
                scale_factor[ii] = -(lcm_miller / miller[ii]);
                scale_factor[jj] = lcm_miller / miller[jj];
                slab_scale_factor.push(reduce_miller_indices(scale_factor));
                if slab_scale_factor.len() == 2 {
                    break 'outer;
                }
            }
        }
    }

    let c_index = if non_orth_ind.is_empty() {
        2
    } else {
        non_orth_ind
            .iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|&(idx, _)| idx)
            .unwrap_or(2)
    };
    slab_scale_factor.push(eye[c_index]);

    while slab_scale_factor.len() < 3 {
        for basis in &eye {
            if !slab_scale_factor.contains(basis) {
                slab_scale_factor.push(*basis);
                break;
            }
        }
    }

    let mut result = [[0i32; 3]; 3];
    for (i, v) in slab_scale_factor.iter().take(3).enumerate() {
        result[i] = *v;
    }

    // Use i64 to avoid overflow for large Miller indices
    let r = |i: usize, j: usize| result[i][j] as i64;
    let det = r(0, 0) * (r(1, 1) * r(2, 2) - r(1, 2) * r(2, 1))
        - r(0, 1) * (r(1, 0) * r(2, 2) - r(1, 2) * r(2, 0))
        + r(0, 2) * (r(1, 0) * r(2, 1) - r(1, 1) * r(2, 0));

    if det < 0 {
        for row in &mut result {
            for val in row {
                *val = -*val;
            }
        }
    }

    result
}

/// Identify unique atomic layers along the c-axis (surface normal direction).
/// Returns fractional z-coordinates of each layer, sorted ascending.
/// Uses single-linkage clustering: atoms are in same layer if within `tol` of first atom in layer.
fn identify_layer_positions(frac_coords: &[Vector3<f64>], tol: f64) -> Vec<f64> {
    if frac_coords.is_empty() {
        return vec![];
    }

    let mut z_coords: Vec<f64> = frac_coords.iter().map(|fc| fc.z).collect();
    z_coords.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    // Group into layers - compare to first z in layer (not rolling average)
    let mut layer_positions = Vec::new();
    let mut layer_start = z_coords[0];
    let mut layer_sum = z_coords[0];
    let mut layer_count = 1usize;

    for &z_coord in &z_coords[1..] {
        // Compare to first atom in layer, not rolling average (fixes clustering bug)
        if (z_coord - layer_start).abs() < tol {
            layer_sum += z_coord;
            layer_count += 1;
        } else {
            layer_positions.push(layer_sum / layer_count as f64);
            layer_start = z_coord;
            layer_sum = z_coord;
            layer_count = 1;
        }
    }
    layer_positions.push(layer_sum / layer_count as f64);

    layer_positions
}

/// Maximum allowed n_layers to prevent integer overflow when casting to i32.
const MAX_SLAB_LAYERS: usize = 10_000;

/// Maximum allowed supercell determinant (atoms in oriented cell) to prevent memory issues.
const MAX_SUPERCELL_DET: i32 = 100_000;

/// Maximum allowed total atoms in final slab (det × n_layers × original_atoms).
const MAX_SLAB_ATOMS: usize = 100_000;

impl Structure {
    /// Generate a surface slab with the specified configuration.
    ///
    /// Returns a single slab structure with the default (bottom) termination.
    /// For all unique terminations, use `generate_slabs()`.
    pub fn make_slab(&self, config: &SlabConfig) -> Result<Self> {
        // Use termination_index=0 to avoid generating all terminations
        let mut config = config.clone();
        if config.termination_index.is_none() {
            config.termination_index = Some(0);
        }
        let slabs = self.generate_slabs(&config)?;
        slabs
            .into_iter()
            .next()
            .ok_or_else(|| FerroxError::InvalidStructure {
                index: 0,
                reason: "No slab could be generated".to_string(),
            })
    }

    /// Generate all unique surface terminations for the given slab configuration.
    ///
    /// Returns a vector of slab structures, each with a different surface termination.
    ///
    /// # Differences from pymatgen's SlabGenerator
    ///
    /// - **Unit cell size**: The transformation matrix may produce larger supercells than
    ///   pymatgen's minimal algorithm for some Miller indices (e.g., (111)). The surface
    ///   is mathematically equivalent but with more atoms in the periodic unit.
    /// - **Layer counting**: Uses `ceil(min_slab_size / proj_height)` where `proj_height` is the
    ///   projection of the c-vector onto the surface normal, matching pymatgen's SlabGenerator.
    /// - **Primitive reduction**: The `primitive` option is not yet implemented.
    pub fn generate_slabs(&self, config: &SlabConfig) -> Result<Vec<Self>> {
        let hkl = config.miller_index;
        if hkl == [0, 0, 0] {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: "Miller indices cannot all be zero".to_string(),
            });
        }
        if self.num_sites() == 0 {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: "Cannot generate slab from empty structure".to_string(),
            });
        }
        if !config.min_slab_size.is_finite() || config.min_slab_size <= 0.0 {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: "min_slab_size must be positive and finite".to_string(),
            });
        }
        if !config.min_vacuum_size.is_finite() || config.min_vacuum_size < 0.0 {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: "min_vacuum_size must be non-negative and finite".to_string(),
            });
        }
        if !config.symprec.is_finite() || config.symprec <= 0.0 {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: "symprec must be positive and finite".to_string(),
            });
        }

        // Create oriented unit cell with a,b in surface plane
        let transform = get_slab_transformation(&self.lattice, hkl);
        // Use i64 to avoid overflow for large Miller indices
        let t = |i: usize, j: usize| transform[i][j] as i64;
        let det = t(0, 0) * (t(1, 1) * t(2, 2) - t(1, 2) * t(2, 1))
            - t(0, 1) * (t(1, 0) * t(2, 2) - t(1, 2) * t(2, 0))
            + t(0, 2) * (t(1, 0) * t(2, 1) - t(1, 1) * t(2, 0));
        if det.abs() > MAX_SUPERCELL_DET as i64 {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "Miller indices {:?} require supercell with {} unit cells, exceeding maximum of {}",
                    hkl,
                    det.abs(),
                    MAX_SUPERCELL_DET
                ),
            });
        }

        // Pre-compute expected total atoms to avoid creating huge structures
        // Estimate proj_height = abs(dot(normal, c_vec)) like pymatgen
        let inv_t = self.lattice.inv_matrix().transpose();
        let hkl_vec = Vector3::new(hkl[0] as f64, hkl[1] as f64, hkl[2] as f64);
        let normal = inv_t * hkl_vec;
        let normal = normal / normal.norm();
        let c_row = Vector3::new(
            transform[2][0] as f64,
            transform[2][1] as f64,
            transform[2][2] as f64,
        );
        let c_vec_estimate = self.lattice.matrix() * c_row;
        let proj_height_estimate = normal.dot(&c_vec_estimate).abs();
        let n_layers_estimate = if config.in_unit_planes {
            config.min_slab_size.ceil() as usize
        } else {
            (config.min_slab_size / proj_height_estimate).ceil() as usize
        }
        .max(1);
        let expected_atoms =
            self.frac_coords.len() * (det.unsigned_abs() as usize) * n_layers_estimate;
        if expected_atoms > MAX_SLAB_ATOMS {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "Slab would contain ~{} atoms ({} sites × {} unit cells × {} layers), exceeding maximum of {}. \
                     Consider using smaller Miller indices or reducing min_slab_size.",
                    expected_atoms,
                    self.frac_coords.len(),
                    det.abs(),
                    n_layers_estimate,
                    MAX_SLAB_ATOMS
                ),
            });
        }

        let oriented = self.make_supercell(transform)?;

        // Identify unique layer positions in the oriented cell (single repeat)
        // This preserves all distinct terminations within one unit cell
        let oriented_layers = identify_layer_positions(&oriented.frac_coords, config.symprec);
        let unique_terminations = oriented_layers.len().max(1);

        // Calculate surface normal for layer thickness calculation
        let inv_t = self.lattice.inv_matrix().transpose();
        let hkl_vec = Vector3::new(hkl[0] as f64, hkl[1] as f64, hkl[2] as f64);
        let normal = inv_t * hkl_vec;
        let normal = normal / normal.norm();

        // Determine slab thickness in number of unit cells
        // Use _proj_height = abs(dot(normal, c_vec)) to match pymatgen's behavior
        // This gives the actual slab thickness contribution per layer
        let c_vec = oriented.lattice.matrix().row(2).transpose();
        let proj_height = normal.dot(&c_vec).abs();
        let n_layers = if config.in_unit_planes {
            config.min_slab_size.ceil() as usize
        } else {
            (config.min_slab_size / proj_height).ceil() as usize
        }
        .max(1);

        // Prevent integer overflow when casting to i32
        if n_layers > MAX_SLAB_LAYERS {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "Slab would require {} layers, exceeding maximum of {}",
                    n_layers, MAX_SLAB_LAYERS
                ),
            });
        }

        // Stack along c-axis
        let slab_supercell = if n_layers > 1 {
            oriented.make_supercell([[1, 0, 0], [0, 1, 0], [0, 0, n_layers as i32]])?
        } else {
            oriented
        };

        // Use layer positions from supercell for shifting, but limit to unique terminations
        // Scale symprec by n_layers: fractional layer spacing is compressed by factor of n_layers
        // in the supercell, so tolerance must shrink proportionally to avoid merging distinct layers
        let scaled_symprec = config.symprec / n_layers as f64;
        let layer_positions = identify_layer_positions(&slab_supercell.frac_coords, scaled_symprec);
        let termination_count = unique_terminations.min(layer_positions.len()).max(1);

        // Determine which terminations to generate
        let (start_idx, end_idx) = match config.termination_index {
            Some(idx) if idx < termination_count => (idx, idx + 1),
            Some(idx) => {
                return Err(FerroxError::InvalidStructure {
                    index: 0,
                    reason: format!(
                        "termination_index {} out of range (0..{})",
                        idx, termination_count
                    ),
                });
            }
            None => (0, termination_count),
        };

        let mut slabs = Vec::with_capacity(end_idx - start_idx);

        for (term_idx, &shift) in layer_positions
            .iter()
            .enumerate()
            .skip(start_idx)
            .take(end_idx - start_idx)
        {
            let mut slab = slab_supercell.clone();

            // Shift z-coordinates and wrap
            for fc in &mut slab.frac_coords {
                fc.z -= shift;
            }
            slab.wrap_to_unit_cell();

            // Add vacuum by scaling c-axis
            let current_c = slab.lattice.lengths().z;
            let total_c = current_c + config.min_vacuum_size;
            let scale = total_c / current_c;

            let mut new_matrix = *slab.lattice.matrix();
            for idx in 0..3 {
                new_matrix[(2, idx)] *= scale;
            }

            // Rescale z-coordinates to account for vacuum
            let slab_frac = current_c / total_c;
            for fc in &mut slab.frac_coords {
                fc.z *= slab_frac;
            }

            // Center slab in vacuum if requested
            if config.center_slab {
                let shift_z = (config.min_vacuum_size / total_c) / 2.0;
                for fc in &mut slab.frac_coords {
                    fc.z += shift_z;
                }
            }

            // Set lattice with non-periodic c-axis
            slab.lattice = Lattice::from_matrix_with_pbc(new_matrix, [true, true, false]);

            // Store metadata
            slab.properties
                .insert("termination_index".to_string(), serde_json::json!(term_idx));
            slab.properties
                .insert("miller_index".to_string(), serde_json::json!(hkl));

            slabs.push(slab);
        }

        Ok(slabs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;

    // =========================================================================
    // Test Structure Factories
    // =========================================================================

    // NaCl primitive cell (rocksalt, a=5.64Å)
    fn make_nacl() -> Structure {
        make_rocksalt(Element::Na, Element::Cl, 5.64)
    }

    // FCC conventional cell (4 atoms)
    fn make_fcc_conventional(element: Element, a: f64) -> Structure {
        Structure::new(
            Lattice::cubic(a),
            vec![Species::neutral(element); 4],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.5, 0.0),
                Vector3::new(0.5, 0.0, 0.5),
                Vector3::new(0.0, 0.5, 0.5),
            ],
        )
    }

    // BCC conventional cell (2 atoms)
    fn make_bcc(element: Element, a: f64) -> Structure {
        Structure::new(
            Lattice::cubic(a),
            vec![Species::neutral(element); 2],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        )
    }

    // Rocksalt structure (cation at origin, anion at body center)
    fn make_rocksalt(cation: Element, anion: Element, a: f64) -> Structure {
        Structure::new(
            Lattice::cubic(a),
            vec![Species::neutral(cation), Species::neutral(anion)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        )
    }

    // Single Cu atom at fractional position in 4Å cubic cell
    fn make_cu_at(x: f64, y: f64, z: f64) -> Structure {
        Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Cu)],
            vec![Vector3::new(x, y, z)],
        )
    }

    // Single Cu atom at origin in cubic cell with variable lattice constant
    fn make_cu_cubic(a: f64) -> Structure {
        Structure::new(
            Lattice::cubic(a),
            vec![Species::neutral(Element::Cu)],
            vec![Vector3::zeros()],
        )
    }

    #[test]
    fn test_structure_constructors() {
        // new() and try_new() both work
        let s = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert_eq!(s.num_sites(), 2);
        assert_eq!(s.composition().reduced_formula(), "NaCl");

        let s2 = Structure::try_new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        )
        .unwrap();
        assert_eq!(s2.num_sites(), 2);
    }

    #[test]
    fn test_structure_constructor_errors() {
        // Length mismatch
        let result = Structure::try_new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
            vec![Vector3::new(0.0, 0.0, 0.0)], // Only 1 coord for 2 species
        );
        assert!(result.is_err());

        // Empty SiteOccupancy
        let empty_occ = SiteOccupancy {
            species: vec![],
            properties: HashMap::new(),
        };
        let result = Structure::try_new_from_occupancies(
            Lattice::cubic(4.0),
            vec![empty_occ],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("at least one species")
        );
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
    fn test_get_spacegroup_symbol() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        // moyo returns space-separated symbols
        assert_eq!(fcc.get_spacegroup_symbol(1e-4).unwrap(), "F m -3 m");
        let bcc = make_bcc(Element::Fe, 2.87);
        assert_eq!(bcc.get_spacegroup_symbol(1e-4).unwrap(), "I m -3 m");
        let nacl = make_nacl();
        assert_eq!(nacl.get_spacegroup_symbol(1e-4).unwrap(), "P m -3 m");
    }

    #[test]
    fn test_get_hall_number() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        // FCC (Fm-3m) has Hall number 523
        let hall = fcc.get_hall_number(1e-4).unwrap();
        assert!(hall > 0 && hall <= 530);
    }

    #[test]
    fn test_get_pearson_symbol() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        // FCC Cu conventional cell: face-centered cubic with 4 atoms
        assert_eq!(fcc.get_pearson_symbol(1e-4).unwrap(), "cF4");
        let bcc = make_bcc(Element::Fe, 2.87);
        // BCC Fe: body-centered cubic with 2 atoms
        assert_eq!(bcc.get_pearson_symbol(1e-4).unwrap(), "cI2");
    }

    #[test]
    fn test_get_wyckoff_letters() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        let wyckoffs = fcc.get_wyckoff_letters(1e-4).unwrap();
        assert_eq!(wyckoffs.len(), 4); // 4 atoms in conventional FCC cell
        // All should be same Wyckoff position for identical atoms
        let first = wyckoffs[0];
        assert!(wyckoffs.iter().all(|&w| w == first));
    }

    #[test]
    fn test_get_site_symmetry_symbols() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        let symbols = fcc.get_site_symmetry_symbols(1e-4).unwrap();
        assert_eq!(symbols.len(), 4);
        // FCC atoms at high-symmetry positions should have same site symmetry
        let first = &symbols[0];
        assert!(symbols.iter().all(|s| s == first));
    }

    #[test]
    fn test_get_symmetry_operations() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        let ops = fcc.get_symmetry_operations(1e-4).unwrap();
        // Fm-3m has 192 operations in the conventional cell
        assert!(!ops.is_empty());
        // Check that operations have valid structure
        for (rot, trans) in &ops {
            // Rotation determinant should be +/- 1
            let det = rot[0][0] * (rot[1][1] * rot[2][2] - rot[1][2] * rot[2][1])
                - rot[0][1] * (rot[1][0] * rot[2][2] - rot[1][2] * rot[2][0])
                + rot[0][2] * (rot[1][0] * rot[2][1] - rot[1][1] * rot[2][0]);
            assert!(det == 1 || det == -1);
            // Translation should be within the conventional [-0.5, 0.5] range
            for &t in trans {
                assert!((-0.5..=0.5 + 1e-8).contains(&t));
            }
        }
    }

    #[test]
    fn test_get_equivalent_sites() {
        // NaCl: 2 sites should be inequivalent (different elements)
        let nacl = make_nacl();
        let orbits = nacl.get_equivalent_sites(1e-4).unwrap();
        assert_eq!(orbits.len(), 2);
        // Each site should be its own representative since they're different elements
        assert_eq!(orbits[0], 0);
        assert_eq!(orbits[1], 1);

        // FCC: All 4 sites should be equivalent
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        let orbits_fcc = fcc.get_equivalent_sites(1e-4).unwrap();
        assert_eq!(orbits_fcc.len(), 4);
        // All should map to the same representative
        let representative = orbits_fcc[0];
        assert!(orbits_fcc.iter().all(|&o| o == representative));
    }

    #[test]
    fn test_get_crystal_system() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        assert_eq!(fcc.get_crystal_system(1e-4).unwrap(), "cubic");
        let bcc = make_bcc(Element::Fe, 2.87);
        assert_eq!(bcc.get_crystal_system(1e-4).unwrap(), "cubic");
        let nacl = make_nacl();
        assert_eq!(nacl.get_crystal_system(1e-4).unwrap(), "cubic");
    }

    #[test]
    fn test_get_symmetry_dataset() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        let dataset = fcc.get_symmetry_dataset(1e-4).unwrap();
        assert_eq!(dataset.number, 225);
        assert_eq!(dataset.hm_symbol, "F m -3 m");
        assert_eq!(dataset.wyckoffs.len(), 4);
        assert_eq!(dataset.orbits.len(), 4);
        assert!(!dataset.operations.is_empty());
    }

    #[test]
    fn test_empty_structure_symmetry_error() {
        let empty = Structure::new(Lattice::cubic(4.0), vec![], vec![]);
        let result = empty.get_symmetry_dataset(1e-4);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("empty structure"));
    }

    #[test]
    fn test_crystal_system_coverage() {
        // Test the spacegroup_to_crystal_system helper
        assert_eq!(spacegroup_to_crystal_system(1), "triclinic");
        assert_eq!(spacegroup_to_crystal_system(2), "triclinic");
        assert_eq!(spacegroup_to_crystal_system(3), "monoclinic");
        assert_eq!(spacegroup_to_crystal_system(15), "monoclinic");
        assert_eq!(spacegroup_to_crystal_system(16), "orthorhombic");
        assert_eq!(spacegroup_to_crystal_system(74), "orthorhombic");
        assert_eq!(spacegroup_to_crystal_system(75), "tetragonal");
        assert_eq!(spacegroup_to_crystal_system(142), "tetragonal");
        assert_eq!(spacegroup_to_crystal_system(143), "trigonal");
        assert_eq!(spacegroup_to_crystal_system(167), "trigonal");
        assert_eq!(spacegroup_to_crystal_system(168), "hexagonal");
        assert_eq!(spacegroup_to_crystal_system(194), "hexagonal");
        assert_eq!(spacegroup_to_crystal_system(195), "cubic");
        assert_eq!(spacegroup_to_crystal_system(230), "cubic");
        assert_eq!(spacegroup_to_crystal_system(0), "unknown");
        assert_eq!(spacegroup_to_crystal_system(231), "unknown");
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
    fn test_species_composition_preserves_oxidation_states() {
        let fe2 = Species::new(Element::Fe, Some(2));
        let fe3 = Species::new(Element::Fe, Some(3));
        let o2 = Species::new(Element::O, Some(-2));

        // Minimal structure: Fe2+, Fe3+, O2- (3 sites)
        let structure = Structure::new(
            Lattice::cubic(4.0),
            vec![fe2, fe3, o2],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.0, 0.0),
                Vector3::new(0.5, 0.5, 0.5),
            ],
        );

        // composition() loses oxidation states
        let elem_comp = structure.composition();
        assert!((elem_comp.get(Element::Fe) - 2.0).abs() < 1e-10);

        // species_composition() preserves them
        let species_comp = structure.species_composition();
        assert!((species_comp.get(fe2) - 1.0).abs() < 1e-10);
        assert!((species_comp.get(fe3) - 1.0).abs() < 1e-10);

        // species_hash differs, formula_hash is the same
        assert_ne!(elem_comp.species_hash(), species_comp.species_hash());
        assert_eq!(elem_comp.formula_hash(), species_comp.formula_hash());
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

    #[test]
    fn test_remap_species_disordered_site() {
        // Disordered site with Fe(0.6) + Co(0.4), mapping both to Ni
        // Should produce single Ni(1.0) species
        let site_occ = vec![SiteOccupancy::new(vec![
            (Species::neutral(Element::Fe), 0.6),
            (Species::neutral(Element::Co), 0.4),
        ])];
        let s = Structure::new_from_occupancies(
            Lattice::cubic(4.0),
            site_occ,
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );
        let mapping = HashMap::from([(Element::Fe, Element::Ni), (Element::Co, Element::Ni)]);
        let remapped = s.remap_species(&mapping);

        // Should have single species with combined occupancy
        assert_eq!(remapped.site_occupancies[0].species.len(), 1);
        assert_eq!(remapped.species()[0].element, Element::Ni);
        assert!(
            (remapped.site_occupancies[0].total_occupancy() - 1.0).abs() < 1e-10,
            "Occupancies should sum to 1.0"
        );
    }

    // =========================================================================
    // Neighbor Finding Tests
    // =========================================================================

    #[test]
    fn test_neighbor_list_edge_cases() {
        // Empty structure returns empty results
        let empty = Structure::new(Lattice::cubic(4.0), vec![], vec![]);
        let (centers, neighbors, images, distances) = empty.get_neighbor_list(3.0, 1e-8, true);
        assert!(
            centers.is_empty() && neighbors.is_empty() && images.is_empty() && distances.is_empty()
        );

        // Zero cutoff returns empty results
        let nacl = make_nacl();
        let (centers, neighbors, images, distances) = nacl.get_neighbor_list(0.0, 1e-8, true);
        assert!(
            centers.is_empty() && neighbors.is_empty() && images.is_empty() && distances.is_empty()
        );
    }

    #[test]
    fn test_neighbor_list_nacl() {
        // NaCl: Na at (0,0,0), Cl at (0.5,0.5,0.5)
        // Na-Cl distance = a * sqrt(3) / 2 = 5.64 * sqrt(3) / 2 ≈ 4.88 Å
        let nacl = make_nacl();
        let na_cl_dist = 5.64 * (3.0_f64).sqrt() / 2.0;

        // Find neighbors within 5 Å (should find the Cl neighbor)
        let (centers, neighbors, _images, distances) = nacl.get_neighbor_list(5.0, 1e-8, true);

        // Count neighbors of site 0 (Na)
        let na_neighbors: Vec<_> = centers
            .iter()
            .zip(&distances)
            .filter(|&(&c, _)| c == 0)
            .collect();

        assert!(
            !na_neighbors.is_empty(),
            "Na should have at least one neighbor within 5 Å"
        );

        // Check that the Cl neighbor is found at correct distance
        let cl_found = na_neighbors
            .iter()
            .any(|&(_, &d)| (d - na_cl_dist).abs() < 0.01);
        assert!(cl_found, "Should find Cl at distance {:.2} Å", na_cl_dist);

        // Verify neighbor is Cl (site 1)
        let cl_neighbor = centers
            .iter()
            .zip(&neighbors)
            .any(|(&c, &n)| c == 0 && n == 1);
        assert!(
            cl_neighbor,
            "Na (site 0) should have Cl (site 1) as neighbor"
        );
    }

    #[test]
    fn test_neighbor_list_fcc_nearest_neighbors() {
        // FCC Cu: each atom has 12 nearest neighbors at distance a/sqrt(2)
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        let nn_dist = 3.6 / (2.0_f64).sqrt(); // ≈ 2.55 Å

        // Find neighbors just beyond NN distance
        let (centers, _neighbors, _images, distances) =
            fcc.get_neighbor_list(nn_dist + 0.1, 1e-8, true);

        // Count unique (center, neighbor) pairs for site 0
        let site0_neighbors: Vec<_> = centers
            .iter()
            .zip(&distances)
            .filter(|&(&c, _)| c == 0)
            .collect();

        assert_eq!(
            site0_neighbors.len(),
            12,
            "FCC site 0 should have 12 nearest neighbors, got {}",
            site0_neighbors.len()
        );

        // All distances should be approximately nn_dist
        for &(_, &d) in &site0_neighbors {
            assert!(
                (d - nn_dist).abs() < 0.01,
                "NN distance should be {:.3}, got {:.3}",
                nn_dist,
                d
            );
        }
    }

    #[test]
    fn test_neighbor_list_self_pairs() {
        let s = make_cu_at(0.0, 0.0, 0.0);

        // With exclude_self=true, should not find self at distance 0
        let (centers, neighbors, images, _) = s.get_neighbor_list(10.0, 1e-8, true);
        let self_same_image = centers
            .iter()
            .zip(&neighbors)
            .zip(&images)
            .any(|((&c, &n), &img)| c == n && img == [0, 0, 0]);
        assert!(!self_same_image, "Self in same image should be excluded");

        // With exclude_self=false, should find self at distance 0
        let (_, _, images, distances) = s.get_neighbor_list(0.1, 1e-8, false);
        let self_found = images
            .iter()
            .zip(&distances)
            .any(|(&img, &d)| img == [0, 0, 0] && d < 1e-8);
        assert!(self_found, "Self at distance 0 should be found");
    }

    #[test]
    fn test_neighbor_list_periodic_images() {
        // Cutoff = 4.0 should find 6 neighbors (periodic images along each axis)
        let (centers, _, images, distances) =
            make_cu_at(0.0, 0.0, 0.0).get_neighbor_list(4.0, 1e-8, true);

        assert_eq!(centers.len(), 6, "Should find 6 periodic images");
        assert!(distances.iter().all(|&d| (d - 4.0).abs() < 1e-8));

        // Check all 6 face-adjacent images are found
        for exp in [
            [-1, 0, 0],
            [1, 0, 0],
            [0, -1, 0],
            [0, 1, 0],
            [0, 0, -1],
            [0, 0, 1],
        ] {
            assert!(images.contains(&exp), "Missing image {exp:?}");
        }
    }

    #[test]
    fn test_get_all_neighbors() {
        let nacl = make_nacl();
        let neighbors = nacl.get_all_neighbors(5.0);

        assert_eq!(neighbors.len(), 2, "Should have 2 sites");
        assert!(!neighbors[0].is_empty(), "Na should have neighbors");
        assert!(!neighbors[1].is_empty(), "Cl should have neighbors");
    }

    #[test]
    fn test_get_distance() {
        let nacl = make_nacl();

        // Self-distance is zero
        assert!(nacl.get_distance(0, 0) < 1e-10);
        assert!(nacl.get_distance(1, 1) < 1e-10);

        // Distance is symmetric
        let d01 = nacl.get_distance(0, 1);
        assert!((d01 - nacl.get_distance(1, 0)).abs() < 1e-10);

        // Na-Cl distance in rocksalt is a*sqrt(3)/2
        let expected = 5.64 * (3.0_f64).sqrt() / 2.0;
        assert!(
            (d01 - expected).abs() < 0.01,
            "Na-Cl distance: expected {expected:.3}, got {d01:.3}"
        );
    }

    #[test]
    #[should_panic(expected = "out of bounds")]
    fn test_get_distance_out_of_bounds() {
        let nacl = make_nacl();
        nacl.get_distance(0, 10); // Site 10 doesn't exist
    }

    #[test]
    fn test_distance_matrix() {
        // Empty structure returns empty matrix
        let empty = Structure::new(Lattice::cubic(4.0), vec![], vec![]);
        assert!(empty.distance_matrix().is_empty());

        // NaCl: dimensions, consistency with get_distance
        let nacl = make_nacl();
        let dm = nacl.distance_matrix();
        assert_eq!(dm.len(), 2);
        assert!(dm.iter().all(|row| row.len() == 2));
        for (idx, row) in dm.iter().enumerate() {
            for (jdx, &d) in row.iter().enumerate() {
                assert!((d - nacl.get_distance(idx, jdx)).abs() < 1e-10);
            }
        }

        // FCC: diagonal is zero, matrix is symmetric
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        let dm = fcc.distance_matrix();
        for (idx, row) in dm.iter().enumerate() {
            assert!(row[idx] < 1e-10, "Diagonal should be 0");
            for (jdx, &val) in row.iter().enumerate().skip(idx + 1) {
                assert!((val - dm[jdx][idx]).abs() < 1e-10, "Should be symmetric");
            }
        }
    }

    // =========================================================================
    // Comprehensive tests for pymatgen-parity features
    // =========================================================================

    #[test]
    fn test_distance_and_image_cubic() {
        // sqrt(2.5^2 + 3.5^2 + 4.5^2) = 6.22494979899
        let expected_dist = 6.22494979899;

        // Direct path (no image shift)
        let s = Structure::new(
            Lattice::cubic(10.0),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::new(0.25, 0.35, 0.45), Vector3::zeros()],
        );
        let (dist, img) = s.get_distance_and_image(0, 1);
        assert!((dist - expected_dist).abs() < 1e-6);
        assert_eq!(img, [0, 0, 0]);

        // Via periodic boundary (site at 1.0 wraps to 0.0)
        let s = Structure::new(
            Lattice::cubic(10.0),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::new(0.25, 0.35, 0.45), Vector3::new(1.0, 1.0, 1.0)],
        );
        let (dist, img) = s.get_distance_and_image(0, 1);
        assert!((dist - expected_dist).abs() < 1e-6);
        assert!((dist - s.get_distance_with_image(0, 1, img)).abs() < 1e-10);
    }

    #[test]
    fn test_distance_and_image_lattice_types() {
        // Same site: zero distance
        let s = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::new(0.5, 0.5, 0.5)],
        );
        let (dist, img) = s.get_distance_and_image(0, 0);
        assert!(dist < 1e-10);
        assert_eq!(img, [0, 0, 0]);

        // Multiple lattice types: verify get_distance_and_image matches get_distance
        let lattices = [
            Lattice::cubic(4.0),
            Lattice::hexagonal(3.0, 5.0),
            Lattice::from_parameters(3.0, 4.0, 5.0, 80.0, 85.0, 95.0), // Triclinic
            Lattice::from_parameters(3.0, 3.1, 10.0, 2.96, 2.0, 1.0),  // Highly skewed
        ];
        for lattice in lattices {
            let s = Structure::new(
                lattice,
                vec![Species::neutral(Element::Fe), Species::neutral(Element::Cu)],
                vec![Vector3::new(0.1, 0.2, 0.3), Vector3::new(0.7, 0.8, 0.9)],
            );
            let (dist, _) = s.get_distance_and_image(0, 1);
            assert!((dist - s.get_distance(0, 1)).abs() < 1e-10);
            assert!(dist > 0.0 && dist < 10.0);
        }
        // Image roundtrip consistency (cubic - simple case where LLL doesn't skew images)
        let s = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Cu)],
            vec![Vector3::new(0.1, 0.2, 0.3), Vector3::new(0.7, 0.8, 0.9)],
        );
        let (dist, img) = s.get_distance_and_image(0, 1);
        assert!((dist - s.get_distance_with_image(0, 1, img)).abs() < 1e-10);

        // Hexagonal: verify specific distance along c-axis
        let s = Structure::new(
            Lattice::hexagonal(3.0, 5.0),
            vec![Species::neutral(Element::Cu), Species::neutral(Element::Cu)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.0, 0.0, 0.5)],
        );
        let (dist, _) = s.get_distance_and_image(0, 1);
        assert!((dist - 2.5).abs() < 1e-10); // 0.5 * 5.0
    }

    #[test]
    fn test_distance_with_image() {
        // Specific image distances in cubic lattice
        let s = Structure::new(
            Lattice::cubic(10.0),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::zeros(), Vector3::new(0.5, 0.0, 0.0)],
        );
        assert!((s.get_distance_with_image(0, 1, [0, 0, 0]) - 5.0).abs() < 1e-10); // Direct
        assert!((s.get_distance_with_image(0, 1, [1, 0, 0]) - 15.0).abs() < 1e-10); // +a shift
        assert!((s.get_distance_with_image(0, 1, [-1, 0, 0]) - 5.0).abs() < 1e-10); // -a shift
        let diag_expected = (1.5_f64.powi(2) + 1.0 + 1.0).sqrt() * 10.0;
        assert!((s.get_distance_with_image(0, 1, [1, 1, 1]) - diag_expected).abs() < 1e-10);

        // Image returned by get_distance_and_image gives same distance
        let s = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Cu), Species::neutral(Element::Cu)],
            vec![Vector3::new(0.1, 0.0, 0.0), Vector3::new(0.9, 0.0, 0.0)],
        );
        let (dist, img) = s.get_distance_and_image(0, 1);
        assert!((dist - s.get_distance_with_image(0, 1, img)).abs() < 1e-10);

        // Coordinates outside [0,1) are wrapped correctly for periodic axes
        let s = Structure::new(
            Lattice::cubic(10.0),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::new(0.25, 0.35, 0.45), Vector3::new(1.0, 1.0, 1.0)], // Wraps to (0,0,0)
        );
        let (dist, img) = s.get_distance_and_image(0, 1);
        assert!((dist - s.get_distance_with_image(0, 1, img)).abs() < 1e-10);

        // Non-periodic axes: coordinates outside [0,1) should NOT be wrapped
        let mut slab_lattice = Lattice::cubic(10.0);
        slab_lattice.pbc = [true, true, false]; // z is non-periodic (slab)
        let s = Structure::new(
            slab_lattice.clone(),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::new(0.0, 0.0, 0.1), Vector3::new(0.0, 0.0, 1.5)], // z=1.5 outside [0,1)
        );
        // With non-periodic z, z=1.5 should NOT wrap to 0.5
        // Distance should be (1.5 - 0.1) * 10 = 14, not (0.5 - 0.1) * 10 = 4
        let dist = s.get_distance_with_image(0, 1, [0, 0, 0]);
        assert!(
            (dist - 14.0).abs() < 1e-10,
            "Non-periodic axis should not wrap: expected 14.0, got {dist}"
        );

        // Negative coordinate on non-periodic axis should also NOT wrap
        let s = Structure::new(
            slab_lattice.clone(),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::new(0.0, 0.0, 0.5), Vector3::new(0.0, 0.0, -0.5)], // z=-0.5
        );
        // z=-0.5 should NOT wrap to 0.5, distance = |0.5 - (-0.5)| * 10 = 10
        let dist = s.get_distance_with_image(0, 1, [0, 0, 0]);
        assert!(
            (dist - 10.0).abs() < 1e-10,
            "Negative coord on non-periodic axis should not wrap: expected 10.0, got {dist}"
        );

        // Non-zero jimage on partial-PBC: only periodic axes should use the image shift
        let s = Structure::new(
            slab_lattice.clone(),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        // jimage [1, 0, 0] shifts site 1 by +a (periodic): x = 0.5 + 1 = 1.5
        // Distance in x: 1.5 * 10 = 15, y: 0.5 * 10 = 5, z: 0.5 * 10 = 5
        let dist_with_x_shift = s.get_distance_with_image(0, 1, [1, 0, 0]);
        let expected = (15.0_f64.powi(2) + 5.0_f64.powi(2) + 5.0_f64.powi(2)).sqrt();
        assert!(
            (dist_with_x_shift - expected).abs() < 1e-10,
            "jimage shift on periodic x axis: expected {expected}, got {dist_with_x_shift}"
        );

        // jimage [0, 0, 1] shifts site 1 by +c (non-periodic z): z = 0.5 + 1 = 1.5
        // Note: for non-periodic axes, the jimage shift still applies but coords don't wrap
        let dist_with_z_shift = s.get_distance_with_image(0, 1, [0, 0, 1]);
        let expected_z = (5.0_f64.powi(2) + 5.0_f64.powi(2) + 15.0_f64.powi(2)).sqrt();
        assert!(
            (dist_with_z_shift - expected_z).abs() < 1e-10,
            "jimage shift on non-periodic z axis: expected {expected_z}, got {dist_with_z_shift}"
        );
    }

    #[test]
    fn test_is_periodic_image() {
        let lattice = Lattice::cubic(10.0);

        // Same position in different cells (differs by integers)
        let s = Structure::new(
            lattice.clone(),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![
                Vector3::new(0.25, 0.35, 0.45),
                Vector3::new(1.25, 2.35, 4.45),
            ],
        );
        assert!(s.is_periodic_image(0, 1, 1e-8));
        assert!(s.is_periodic_image(1, 0, 1e-8)); // Symmetric

        // Tolerance behavior: slight difference
        let s = Structure::new(
            lattice.clone(),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![
                Vector3::new(0.25, 0.35, 0.45),
                Vector3::new(1.25, 2.35, 4.46),
            ],
        );
        assert!(!s.is_periodic_image(0, 1, 1e-8)); // Tight: no
        assert!(s.is_periodic_image(0, 1, 0.02)); // Loose: yes

        // Different species -> NOT periodic images
        let s = Structure::new(
            lattice.clone(),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Co)],
            vec![
                Vector3::new(0.25, 0.35, 0.45),
                Vector3::new(1.25, 2.35, 4.45),
            ],
        );
        assert!(!s.is_periodic_image(0, 1, 1e-8));

        // Disordered sites with same dominant species
        let s = Structure::new_from_occupancies(
            lattice,
            vec![
                SiteOccupancy::new(vec![
                    (Species::neutral(Element::Fe), 0.6),
                    (Species::neutral(Element::Co), 0.4),
                ]),
                SiteOccupancy::new(vec![
                    (Species::neutral(Element::Fe), 0.7),
                    (Species::neutral(Element::Ni), 0.3),
                ]),
            ],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(1.0, 0.0, 0.0)],
        );
        assert!(s.is_periodic_image(0, 1, 1e-8)); // Same dominant species (Fe)

        // Self is own periodic image
        let s = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::new(0.5, 0.5, 0.5)],
        );
        assert!(s.is_periodic_image(0, 0, 1e-8));

        // Negative tolerance always fails (validated at Python layer, but document Rust behavior)
        assert!(!s.is_periodic_image(0, 0, -1.0));
    }

    #[test]
    fn test_distance_from_point() {
        // Cubic: site at (2.5, 3.5, 4.5) Cartesian
        let s = Structure::new(
            Lattice::cubic(10.0),
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::new(0.25, 0.35, 0.45)],
        );
        // From origin: sqrt(2.5^2 + 3.5^2 + 4.5^2)
        assert!((s.distance_from_point(0, Vector3::zeros()) - 6.22494979899).abs() < 1e-6);
        // From (1, 1, 1): sqrt((2.5-1)^2 + (3.5-1)^2 + (4.5-1)^2)
        assert!(
            (s.distance_from_point(0, Vector3::new(1.0, 1.0, 1.0)) - 20.75_f64.sqrt()).abs()
                < 1e-10
        );

        // Same location -> zero distance
        let s = Structure::new(
            Lattice::cubic(10.0),
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::new(0.1, 0.1, 0.1)], // Cartesian: (1, 1, 1)
        );
        assert!(s.distance_from_point(0, Vector3::new(1.0, 1.0, 1.0)) < 1e-10);

        // Hexagonal: site along c-axis at z=2.5
        let s = Structure::new(
            Lattice::hexagonal(3.0, 5.0),
            vec![Species::neutral(Element::Cu)],
            vec![Vector3::new(0.0, 0.0, 0.5)],
        );
        assert!((s.distance_from_point(0, Vector3::zeros()) - 2.5).abs() < 1e-10);
    }

    #[test]
    fn test_site_labels() {
        let lattice = Lattice::cubic(4.0);

        // Defaults to species string (ordered and with oxidation)
        let s = Structure::new(
            lattice.clone(),
            vec![
                Species::neutral(Element::Fe),
                Species::new(Element::O, Some(-2)),
            ],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert_eq!(s.site_label(0), "Fe");
        assert_eq!(s.site_label(1), "O2-");

        // Disordered site uses species_string (sorted by electronegativity: Fe < Co)
        let s = Structure::new_from_occupancies(
            lattice.clone(),
            vec![SiteOccupancy::new(vec![
                (Species::neutral(Element::Fe), 0.5),
                (Species::neutral(Element::Co), 0.5),
            ])],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );
        assert_eq!(s.site_label(0), "Fe:0.5, Co:0.5");

        // Custom labels override defaults
        let mut s = Structure::new(
            lattice.clone(),
            vec![
                Species::neutral(Element::Fe),
                Species::neutral(Element::Co),
                Species::neutral(Element::Ni),
            ],
            vec![
                Vector3::zeros(),
                Vector3::new(0.25, 0.25, 0.25),
                Vector3::new(0.5, 0.5, 0.5),
            ],
        );
        assert_eq!(s.site_labels(), vec!["Fe", "Co", "Ni"]); // Defaults
        s.set_site_label(1, "custom");
        assert_eq!(s.site_labels(), vec!["Fe", "custom", "Ni"]); // Mixed

        // Method chaining and special characters
        let mut s = Structure::new(
            lattice,
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::zeros(), Vector3::new(0.5, 0.5, 0.5)],
        );
        s.set_site_label(0, "Fe_oct (site 1)")
            .set_site_label(1, "Fe_tet");
        assert_eq!(s.site_label(0), "Fe_oct (site 1)");
        assert_eq!(s.site_label(1), "Fe_tet");

        // Label persists in properties
        let props = s.site_properties(0);
        assert_eq!(
            props.get("label").unwrap().as_str().unwrap(),
            "Fe_oct (site 1)"
        );
    }

    #[test]
    fn test_species_strings() {
        // Empty structure
        let s = Structure::new(Lattice::cubic(4.0), vec![], vec![]);
        assert!(s.species_strings().is_empty());

        // Large structure: all same species
        let n = 100;
        let s = Structure::new(
            Lattice::cubic(10.0),
            (0..n).map(|_| Species::neutral(Element::Cu)).collect(),
            (0..n)
                .map(|idx| {
                    Vector3::new(
                        (idx % 10) as f64 / 10.0,
                        ((idx / 10) % 10) as f64 / 10.0,
                        (idx / 100) as f64 / 10.0,
                    )
                })
                .collect(),
        );
        let strings = s.species_strings();
        assert_eq!(strings.len(), n);
        assert!(strings.iter().all(|s| s == "Cu"));
    }

    #[test]
    fn test_pbc_image_indices() {
        let lattice = Lattice::cubic(4.0);

        // No wrap: nearby sites in same cell
        let c1 = vec![Vector3::new(0.2, 0.2, 0.2)];
        let c2 = vec![Vector3::new(0.3, 0.3, 0.3)];
        let (_, _, images) = crate::pbc::pbc_shortest_vectors(&lattice, &c1, &c2, None, None);
        assert_eq!(images[0][0], [0, 0, 0]);

        // Negative wrap: 0.1 to 0.9 wraps via -x
        let c1 = vec![Vector3::new(0.1, 0.0, 0.0)];
        let c2 = vec![Vector3::new(0.9, 0.0, 0.0)];
        let (_, d2, images) = crate::pbc::pbc_shortest_vectors(&lattice, &c1, &c2, None, None);
        assert!((d2[0][0].sqrt() - 0.8).abs() < 1e-8); // 0.2 * 4 = 0.8
        assert_eq!(images[0][0][0], -1);

        // Positive wrap: 0.9 to 0.1 wraps via +x
        let c1 = vec![Vector3::new(0.9, 0.0, 0.0)];
        let c2 = vec![Vector3::new(0.1, 0.0, 0.0)];
        let (_, _, images) = crate::pbc::pbc_shortest_vectors(&lattice, &c1, &c2, None, None);
        assert_eq!(images[0][0][0], 1);

        // Corner wrap: all three directions
        let c1 = vec![Vector3::new(0.05, 0.05, 0.05)];
        let c2 = vec![Vector3::new(0.95, 0.95, 0.95)];
        let (_, _, images) = crate::pbc::pbc_shortest_vectors(&lattice, &c1, &c2, None, None);
        assert_eq!(images[0][0], [-1, -1, -1]);

        // Multiple pairs: verify small images for nearby sites
        let c1 = vec![Vector3::new(0.1, 0.1, 0.1), Vector3::new(0.4, 0.4, 0.4)];
        let c2 = vec![Vector3::new(0.2, 0.2, 0.2), Vector3::new(0.3, 0.3, 0.3)];
        let (_, d2, images) = crate::pbc::pbc_shortest_vectors(&lattice, &c1, &c2, None, None);
        for idx in 0..2 {
            for jdx in 0..2 {
                assert!(d2[idx][jdx].sqrt() < 7.0);
                let img = images[idx][jdx];
                assert!(img[0].abs() <= 1 && img[1].abs() <= 1 && img[2].abs() <= 1);
            }
        }
    }

    #[test]
    fn test_comprehensive_distance_verification() {
        // Comprehensive test: verify all distance methods agree
        let lattice = Lattice::cubic(5.0);
        let s = Structure::new(
            lattice,
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Cu)],
            vec![Vector3::new(0.1, 0.2, 0.3), Vector3::new(0.8, 0.9, 0.7)],
        );

        // get_distance should equal sqrt of distance_matrix entry
        let d01 = s.get_distance(0, 1);
        let dm = s.distance_matrix();
        assert!((d01 - dm[0][1]).abs() < 1e-10);
        assert!((d01 - dm[1][0]).abs() < 1e-10); // Symmetric

        // get_distance_and_image should give same distance
        let (d_and_img, img) = s.get_distance_and_image(0, 1);
        assert!((d01 - d_and_img).abs() < 1e-10);

        // Using that image should give same distance
        let d_with_img = s.get_distance_with_image(0, 1, img);
        assert!((d01 - d_with_img).abs() < 1e-10);
    }

    #[test]
    fn test_neighbor_list_bcc_nearest_neighbors() {
        // BCC: each atom has 8 nearest neighbors at distance a*sqrt(3)/2
        let bcc = make_bcc(Element::Fe, 2.87);
        let nn_dist = 2.87 * (3.0_f64).sqrt() / 2.0; // ≈ 2.48 Å

        let (centers, _neighbors, _images, distances) =
            bcc.get_neighbor_list(nn_dist + 0.1, 1e-8, true);

        // Count neighbors for site 0
        let site0_neighbors: Vec<_> = centers
            .iter()
            .zip(&distances)
            .filter(|&(&c, _)| c == 0)
            .collect();

        assert_eq!(
            site0_neighbors.len(),
            8,
            "BCC site 0 should have 8 nearest neighbors, got {}",
            site0_neighbors.len()
        );
    }

    #[test]
    fn test_neighbor_list_hexagonal() {
        // Test with non-cubic lattice
        let lattice = Lattice::hexagonal(3.0, 5.0);
        let s = Structure::new(
            lattice,
            vec![Species::neutral(Element::Cu)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );

        // Find neighbors within lattice parameter distance
        let (centers, _neighbors, _images, distances) = s.get_neighbor_list(3.1, 1e-8, true);

        // Should find some neighbors
        assert!(
            !centers.is_empty(),
            "Should find neighbors in hexagonal lattice"
        );

        // All distances should be positive and <= cutoff
        for d in &distances {
            assert!(
                *d > 0.0 && *d <= 3.1,
                "Distance {} should be in (0, 3.1]",
                d
            );
        }
    }

    // =========================================================================
    // SymmOp and apply_operation tests
    // =========================================================================

    #[test]
    fn test_symmop_constructors() {
        // Identity: I, [0,0,0]
        let op = SymmOp::identity();
        assert_eq!(op.rotation, Matrix3::identity());
        assert_eq!(op.translation, Vector3::zeros());

        // Inversion: -I, [0,0,0]
        let op = SymmOp::inversion();
        assert_eq!(op.rotation, -Matrix3::identity());
        assert_eq!(op.translation, Vector3::zeros());

        // Translation: I, [0.5,0.25,0]
        let v = Vector3::new(0.5, 0.25, 0.0);
        let op = SymmOp::translation(v);
        assert_eq!(op.rotation, Matrix3::identity());
        assert_eq!(op.translation, v);

        // Rotation_z(90°): (1,0,0) -> (0,1,0)
        use std::f64::consts::FRAC_PI_2;
        let op = SymmOp::rotation_z(FRAC_PI_2);
        let rotated = op.rotation * Vector3::new(1.0, 0.0, 0.0);
        assert!((rotated - Vector3::new(0.0, 1.0, 0.0)).norm() < 1e-10);
    }

    #[test]
    fn test_apply_operation_fractional() {
        // Identity: coords unchanged
        let original = make_cu_at(0.25, 0.25, 0.25);
        let transformed = original.apply_operation_copy(&SymmOp::identity(), true);
        assert!((transformed.frac_coords[0] - original.frac_coords[0]).norm() < 1e-10);

        // Inversion: (0.25, 0.25, 0.25) -> (-0.25, -0.25, -0.25)
        let inverted = original.apply_operation_copy(&SymmOp::inversion(), true);
        assert!((inverted.frac_coords[0] - Vector3::new(-0.25, -0.25, -0.25)).norm() < 1e-10);

        // Translation: (0,0,0) + (0.5,0,0) = (0.5, 0, 0)
        let translated = make_cu_at(0.0, 0.0, 0.0)
            .apply_operation_copy(&SymmOp::translation(Vector3::new(0.5, 0.0, 0.0)), true);
        assert!((translated.frac_coords[0] - Vector3::new(0.5, 0.0, 0.0)).norm() < 1e-10);
    }

    #[test]
    fn test_apply_operation_cartesian() {
        use std::f64::consts::FRAC_PI_2;
        // 90° rotation around z-axis: (0.25,0,0) frac -> (1,0,0) Å -> (0,1,0) Å -> (0,0.25,0) frac
        let rotated =
            make_cu_at(0.25, 0.0, 0.0).apply_operation_copy(&SymmOp::rotation_z(FRAC_PI_2), false);
        assert!((rotated.frac_coords[0] - Vector3::new(0.0, 0.25, 0.0)).norm() < 1e-10);
    }

    #[test]
    fn test_apply_operation_in_place_and_chaining() {
        // In-place translation
        let mut s = make_cu_at(0.0, 0.0, 0.0);
        s.apply_operation(&SymmOp::translation(Vector3::new(0.5, 0.5, 0.5)), true);
        assert!((s.frac_coords[0] - Vector3::new(0.5, 0.5, 0.5)).norm() < 1e-10);

        // Chaining: translate then invert
        let mut s = make_cu_at(0.0, 0.0, 0.0);
        s.apply_operation(&SymmOp::translation(Vector3::new(0.25, 0.0, 0.0)), true)
            .apply_operation(&SymmOp::inversion(), true);
        assert!((s.frac_coords[0] - Vector3::new(-0.25, 0.0, 0.0)).norm() < 1e-10);
    }

    #[test]
    fn test_apply_operation_preserves_sites() {
        let nacl = make_nacl();
        let transformed = nacl.apply_operation_copy(&SymmOp::inversion(), true);
        assert_eq!(transformed.num_sites(), nacl.num_sites());
        assert_eq!(transformed.species()[0].element, nacl.species()[0].element);
    }

    // =========================================================================
    // Physical Properties Tests (volume, total_mass, density)
    // =========================================================================

    #[test]
    fn test_volume() {
        // Cubic cell: 4^3 = 64 Å³
        assert!((make_cu_at(0.0, 0.0, 0.0).volume() - 64.0).abs() < 1e-10);
        // Structure.volume() should delegate to Lattice.volume()
        let nacl = make_nacl();
        assert!((nacl.volume() - nacl.lattice.volume()).abs() < 1e-10);
    }

    #[test]
    fn test_total_mass() {
        // NaCl: Na (22.99) + Cl (35.45) ≈ 58.44 u
        assert!((make_nacl().total_mass() - 58.44).abs() < 0.1);
        // FCC Cu: 4 atoms * 63.546 ≈ 254.18 u
        assert!((make_fcc_conventional(Element::Cu, 3.6).total_mass() - 254.18).abs() < 0.1);
    }

    #[test]
    fn test_total_mass_disordered() {
        // 50% Fe (55.845) + 50% Co (58.933) = 57.389 u
        let s = Structure::new_from_occupancies(
            Lattice::cubic(2.87),
            vec![SiteOccupancy::new(vec![
                (Species::neutral(Element::Fe), 0.5),
                (Species::neutral(Element::Co), 0.5),
            ])],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );
        assert!((s.total_mass() - 57.389).abs() < 0.01);
    }

    #[test]
    fn test_density() {
        // FCC Cu: a=3.615Å, 4 atoms → ~8.94 g/cm³
        let fcc = make_fcc_conventional(Element::Cu, 3.615);
        assert!((fcc.density().unwrap() - 8.94).abs() < 0.1);
        // NaCl primitive: ~0.54 g/cm³
        let nacl = make_nacl();
        let nacl_density = nacl.density().unwrap();
        assert!(nacl_density > 0.5 && nacl_density < 0.6);
        // 1 Cu in 1 Å³ → ~105.5 g/cm³
        let tiny = make_cu_cubic(1.0);
        assert!((tiny.density().unwrap() - 105.5).abs() < 1.0);
    }

    // =========================================================================
    // Site Manipulation Tests (translate_sites, perturb)
    // =========================================================================

    #[test]
    fn test_translate_sites() {
        // Single site, fractional coords
        let mut s = make_nacl();
        s.translate_sites(&[0], Vector3::new(0.1, 0.0, 0.0), true);
        assert!((s.frac_coords[0][0] - 0.1).abs() < 1e-10);
        assert!((s.frac_coords[1] - Vector3::new(0.5, 0.5, 0.5)).norm() < 1e-10); // unchanged

        // Multiple sites
        let mut s = make_nacl();
        s.translate_sites(&[0, 1], Vector3::new(0.1, 0.0, 0.0), true);
        assert!((s.frac_coords[0][0] - 0.1).abs() < 1e-10);
        assert!((s.frac_coords[1][0] - 0.6).abs() < 1e-10);

        // Cartesian coords: 2Å on 4Å lattice = 0.5 fractional
        let mut s = make_cu_at(0.0, 0.0, 0.0);
        s.translate_sites(&[0], Vector3::new(2.0, 0.0, 0.0), false);
        assert!((s.frac_coords[0][0] - 0.5).abs() < 1e-10);

        // Chaining
        let mut s = make_nacl();
        s.translate_sites(&[0], Vector3::new(0.1, 0.0, 0.0), true)
            .translate_sites(&[0], Vector3::new(0.0, 0.1, 0.0), true);
        assert!((s.frac_coords[0][0] - 0.1).abs() < 1e-10);
        assert!((s.frac_coords[0][1] - 0.1).abs() < 1e-10);
    }

    #[test]
    #[should_panic(expected = "out of bounds")]
    fn test_translate_sites_out_of_bounds() {
        make_nacl().translate_sites(&[10], Vector3::new(0.1, 0.0, 0.0), true);
    }

    #[test]
    fn test_perturb_reproducibility() {
        // Same seed → same result
        let mut s1 = make_nacl();
        let mut s2 = make_nacl();
        s1.perturb(0.1, None, Some(42));
        s2.perturb(0.1, None, Some(42));
        for (fc1, fc2) in s1.frac_coords.iter().zip(&s2.frac_coords) {
            assert!((fc1 - fc2).norm() < 1e-10);
        }
        // Different seeds → different results
        let mut s3 = make_nacl();
        s3.perturb(0.1, None, Some(43));
        assert!(
            s1.frac_coords
                .iter()
                .zip(&s3.frac_coords)
                .any(|(a, b)| (a - b).norm() > 1e-10)
        );
    }

    #[test]
    fn test_perturb_distance_range() {
        let orig = make_nacl();
        let mut perturbed = orig.clone();
        perturbed.perturb(0.5, Some(0.2), Some(123));
        for (orig_c, pert_c) in orig.cart_coords().iter().zip(&perturbed.cart_coords()) {
            let dist = (orig_c - pert_c).norm();
            assert!(
                (0.2 - 1e-6..=0.5 + 1e-6).contains(&dist),
                "dist {dist} out of [0.2, 0.5]"
            );
        }
    }

    #[test]
    fn test_perturb_all_sites_moved() {
        let orig = make_nacl();
        let mut perturbed = orig.clone();
        perturbed.perturb(0.1, Some(0.05), Some(42));
        for (orig_fc, pert_fc) in orig.frac_coords.iter().zip(&perturbed.frac_coords) {
            assert!((orig_fc - pert_fc).norm() > 1e-10, "site should have moved");
        }
    }

    #[test]
    fn test_perturb_zero_distance() {
        let orig = make_nacl();
        let mut perturbed = orig.clone();
        perturbed.perturb(0.0, None, Some(42));
        for (orig_fc, pert_fc) in orig.frac_coords.iter().zip(&perturbed.frac_coords) {
            assert!(
                (orig_fc - pert_fc).norm() < 1e-10,
                "zero perturb should not move sites"
            );
        }
    }

    #[test]
    fn test_perturb_chaining() {
        let mut s = make_nacl();
        s.perturb(0.1, None, Some(42)).perturb(0.1, None, Some(43));
        assert_eq!(s.num_sites(), 2);
    }

    #[test]
    #[should_panic(expected = "must be >=")]
    fn test_perturb_invalid_range() {
        make_nacl().perturb(0.1, Some(0.5), None); // min > max
    }

    // =========================================================================
    // Sorting tests
    // =========================================================================

    #[test]
    fn test_sort_by_atomic_number() {
        // Test sorting by Z: Fe(26), O(8), H(1) -> H, O, Fe
        let s = Structure::new(
            Lattice::cubic(5.0),
            vec![
                Species::neutral(Element::Fe),
                Species::neutral(Element::O),
                Species::neutral(Element::H),
            ],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.0, 0.0),
                Vector3::new(0.0, 0.5, 0.0),
            ],
        );

        // Ascending: H < O < Fe
        let asc = s.get_sorted_structure(false);
        assert_eq!(asc.species()[0].element, Element::H);
        assert_eq!(asc.species()[1].element, Element::O);
        assert_eq!(asc.species()[2].element, Element::Fe);

        // Descending: Fe > O > H
        let desc = s.get_sorted_structure(true);
        assert_eq!(desc.species()[0].element, Element::Fe);
        assert_eq!(desc.species()[2].element, Element::H);
    }

    #[test]
    fn test_sort_by_electronegativity() {
        // Na (0.93) < Fe (1.83) < O (3.44)
        let s = Structure::new(
            Lattice::cubic(5.0),
            vec![
                Species::neutral(Element::O),
                Species::neutral(Element::Na),
                Species::neutral(Element::Fe),
            ],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.0, 0.0),
                Vector3::new(0.0, 0.5, 0.0),
            ],
        );

        let sorted = s.get_sorted_by_electronegativity(false);
        assert_eq!(sorted.species()[0].element, Element::Na);
        assert_eq!(sorted.species()[1].element, Element::Fe);
        assert_eq!(sorted.species()[2].element, Element::O);
    }

    #[test]
    fn test_sort_in_place_preserves_coords() {
        // Coords should follow their species when sorted
        let mut s = Structure::new(
            Lattice::cubic(5.0),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::H)],
            vec![Vector3::new(0.1, 0.2, 0.3), Vector3::new(0.4, 0.5, 0.6)],
        );
        s.sort(false); // H should come first

        assert_eq!(s.species()[0].element, Element::H);
        assert!((s.frac_coords[0] - Vector3::new(0.4, 0.5, 0.6)).norm() < 1e-10);
        assert_eq!(s.species()[1].element, Element::Fe);
        assert!((s.frac_coords[1] - Vector3::new(0.1, 0.2, 0.3)).norm() < 1e-10);
    }

    #[test]
    fn test_sort_noble_gas_last() {
        let s = Structure::new(
            Lattice::cubic(5.0),
            vec![
                Species::neutral(Element::Ar), // No EN
                Species::neutral(Element::Na), // EN = 0.93
            ],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let sorted = s.get_sorted_by_electronegativity(false);
        assert_eq!(sorted.species()[0].element, Element::Na);
        assert_eq!(sorted.species()[1].element, Element::Ar);
    }

    #[test]
    fn test_sort_empty_structure() {
        let mut s = Structure::new(Lattice::cubic(5.0), vec![], vec![]);
        s.sort(false);
        assert_eq!(s.num_sites(), 0);
    }

    #[test]
    fn test_sort_disordered_uses_dominant() {
        let site_occ = vec![
            SiteOccupancy::ordered(Species::neutral(Element::Cu)), // Z=29
            SiteOccupancy::new(vec![
                (Species::neutral(Element::Fe), 0.6), // Z=26, dominant
                (Species::neutral(Element::Co), 0.4), // Z=27
            ]),
        ];
        let s = Structure::new_from_occupancies(
            Lattice::cubic(5.0),
            site_occ,
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let sorted = s.get_sorted_structure(false);
        assert_eq!(sorted.species()[0].element, Element::Fe);
        assert_eq!(sorted.species()[1].element, Element::Cu);
    }

    // =========================================================================
    // Copy and sanitization tests
    // =========================================================================

    #[test]
    fn test_copy() {
        // Without sanitize: exact clone
        let nacl = make_nacl();
        let copy = nacl.copy(false);
        assert_eq!(copy.num_sites(), nacl.num_sites());
        for (orig, copied) in nacl.frac_coords.iter().zip(&copy.frac_coords) {
            assert!((orig - copied).norm() < 1e-10);
        }

        // With sanitize: sorts by electronegativity (H < O)
        let s = Structure::new(
            Lattice::cubic(5.0),
            vec![Species::neutral(Element::O), Species::neutral(Element::H)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        let sanitized = s.copy(true);
        assert_eq!(sanitized.species()[0].element, Element::H);
        assert_eq!(sanitized.species()[1].element, Element::O);
    }

    #[test]
    fn test_copy_with_properties() {
        let s = make_nacl();
        let props = HashMap::from([
            ("energy".to_string(), serde_json::json!(-5.5)),
            ("source".to_string(), serde_json::json!("test")),
        ]);

        let copy = s.copy_with_properties(props);

        assert_eq!(
            copy.properties.get("energy"),
            Some(&serde_json::json!(-5.5))
        );
        assert_eq!(
            copy.properties.get("source"),
            Some(&serde_json::json!("test"))
        );
    }

    #[test]
    fn test_wrap_to_unit_cell() {
        // (1.5, -0.3, 2.7) -> (0.5, 0.7, 0.7)
        let mut s = make_cu_at(1.5, -0.3, 2.7);
        s.wrap_to_unit_cell();
        assert!((s.frac_coords[0] - Vector3::new(0.5, 0.7, 0.7)).norm() < 1e-10);

        // Already in [0,1) should be unchanged
        let mut s = make_cu_at(0.25, 0.5, 0.75);
        let orig = s.frac_coords[0];
        s.wrap_to_unit_cell();
        assert!((s.frac_coords[0] - orig).norm() < 1e-10);
    }

    #[test]
    fn test_sort_method_chaining() {
        let mut s = Structure::new(
            Lattice::cubic(5.0),
            vec![Species::neutral(Element::O), Species::neutral(Element::H)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        s.sort(false).wrap_to_unit_cell();

        assert_eq!(s.species()[0].element, Element::H);
        assert_eq!(s.species()[1].element, Element::O);
    }

    #[test]
    fn test_get_reduced_structure() {
        // Test LLL on cubic NaCl
        let nacl = make_nacl();
        let lll = nacl.get_reduced_structure(ReductionAlgo::LLL).unwrap();
        assert!((lll.lattice.volume() - nacl.lattice.volume()).abs() < 1e-6);
        assert_eq!(lll.num_sites(), nacl.num_sites());

        // Test Niggli on skewed lattice
        let skewed = Structure::new(
            Lattice::new(Matrix3::new(4.0, 2.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 4.0)),
            vec![Species::neutral(Element::Cu)],
            vec![Vector3::new(0.25, 0.25, 0.25)],
        );
        let niggli = skewed.get_reduced_structure(ReductionAlgo::Niggli).unwrap();
        assert!((niggli.lattice.volume() - skewed.lattice.volume()).abs() < 1e-6);
    }

    // =========================================================================
    // interpolate() tests
    // =========================================================================

    #[test]
    fn test_interpolate_identical_structures() {
        let s = make_nacl();
        let images = s.interpolate(&s, 5, false, true).unwrap();
        assert_eq!(images.len(), 6);

        for img in &images {
            for (orig, interp) in s.frac_coords.iter().zip(&img.frac_coords) {
                assert!(
                    (orig - interp).norm() < 1e-10,
                    "Identical structure interpolation should produce same coords"
                );
            }
        }
    }

    #[test]
    fn test_interpolate_linear_displacement() {
        let images = make_cu_at(0.0, 0.0, 0.0)
            .interpolate(&make_cu_at(0.5, 0.0, 0.0), 4, false, false)
            .unwrap();
        assert_eq!(images.len(), 5);
        for (idx, img) in images.iter().enumerate() {
            let expected = 0.5 * idx as f64 / 4.0;
            assert!(
                (img.frac_coords[0][0] - expected).abs() < 1e-10,
                "Image {idx}"
            );
        }
    }

    #[test]
    fn test_interpolate_pbc() {
        // 0.9→0.1 crosses boundary with PBC, goes through 0.5 without
        let (start, end) = (make_cu_at(0.9, 0.0, 0.0), make_cu_at(0.1, 0.0, 0.0));
        let mid_pbc = start.interpolate(&end, 4, false, true).unwrap()[2].frac_coords[0][0];
        let mid_no_pbc = start.interpolate(&end, 4, false, false).unwrap()[2].frac_coords[0][0];
        assert!(
            !(0.2..=0.8).contains(&mid_pbc),
            "PBC: middle should be near boundary"
        );
        assert!(
            (mid_no_pbc - 0.5).abs() < 0.1,
            "No PBC: middle should be ~0.5"
        );

        // 0.3→0.8 (diff=0.5) - distinguishes round() from floor()
        let mid = make_cu_at(0.3, 0.0, 0.0)
            .interpolate(&make_cu_at(0.8, 0.0, 0.0), 4, false, true)
            .unwrap()[2]
            .frac_coords[0][0];
        assert!(
            !(0.15..=0.85).contains(&mid),
            "0.3→0.8 with PBC should cross boundary"
        );
    }

    #[test]
    fn test_interpolate_errors() {
        let nacl = make_nacl();

        // Different site counts
        let cu_fcc = make_fcc_conventional(Element::Cu, 3.6);
        let err = nacl.interpolate(&cu_fcc, 5, false, true).unwrap_err();
        assert!(
            err.to_string().contains("different number"),
            "Expected site count error"
        );

        // Species mismatch (same site count, different elements)
        let kcl = make_rocksalt(Element::K, Element::Cl, 6.29);
        let err = nacl.interpolate(&kcl, 5, false, true).unwrap_err();
        assert!(
            err.to_string().contains("Species mismatch"),
            "Expected species error"
        );
    }

    #[test]
    fn test_interpolate_lattice() {
        let images = make_cu_cubic(4.0)
            .interpolate(&make_cu_cubic(5.0), 4, true, false)
            .unwrap();

        // Check endpoints and middle
        let get_a = |idx: usize| images[idx].lattice.lengths()[0];
        assert!((get_a(0) - 4.0).abs() < 1e-6, "First should be 4.0");
        assert!((get_a(2) - 4.5).abs() < 1e-6, "Middle should be 4.5");
        assert!((get_a(4) - 5.0).abs() < 1e-6, "Last should be 5.0");

        // Verify monotonic increase
        for idx in 1..images.len() {
            assert!(get_a(idx) >= get_a(idx - 1), "Lattice should increase");
        }
    }

    #[test]
    fn test_interpolate_edge_cases() {
        // n_images=0 returns just start structure
        let nacl = make_nacl();
        let images = nacl.interpolate(&nacl, 0, false, true).unwrap();
        assert_eq!(images.len(), 1);

        // Empty structures work
        let empty = Structure::new(Lattice::cubic(4.0), vec![], vec![]);
        let images = empty.interpolate(&empty, 5, false, true).unwrap();
        assert_eq!(images.len(), 6);
        assert!(images.iter().all(|img| img.num_sites() == 0));
    }

    // =========================================================================
    // matches() and matches_with() tests
    // =========================================================================

    #[test]
    fn test_matches() {
        let nacl = make_nacl();

        // Self-match (exact and anonymous)
        assert!(nacl.matches(&nacl, false), "Structure should match itself");
        assert!(nacl.matches(&nacl, true), "Anonymous self-match");

        // Different composition - no exact match
        let kcl = make_rocksalt(Element::K, Element::Cl, 6.29);
        assert!(
            !nacl.matches(&kcl, false),
            "Different compositions shouldn't match"
        );

        // Same prototype (rocksalt) - anonymous match
        let mgo = Structure::new(
            Lattice::cubic(4.21),
            vec![Species::neutral(Element::Mg), Species::neutral(Element::O)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert!(nacl.matches(&mgo, true), "NaCl/MgO same prototype");

        // BCC prototype: Fe vs W
        let fe_bcc = make_bcc(Element::Fe, 2.87);
        let w_bcc = make_bcc(Element::W, 3.16);
        assert!(!fe_bcc.matches(&w_bcc, false));
        assert!(fe_bcc.matches(&w_bcc, true), "BCC prototype match");

        // FCC prototype: Cu vs Al
        let cu_fcc = make_fcc_conventional(Element::Cu, 3.6);
        let al_fcc = make_fcc_conventional(Element::Al, 4.05);
        assert!(!cu_fcc.matches(&al_fcc, false));
        assert!(cu_fcc.matches(&al_fcc, true), "FCC prototype match");
    }

    // =========================================================================
    // Supercell Tests
    // =========================================================================

    #[test]
    fn test_supercell_scaling() {
        // Test various scaling methods: matrix, diag, and operators
        let nacl = make_nacl(); // 2 sites
        let orig_vol = nacl.lattice.volume();

        // (description, supercell, expected_sites, volume_factor)
        let cases: [(&str, Structure, usize, f64); 5] = [
            (
                "2x2x2 matrix",
                nacl.make_supercell([[2, 0, 0], [0, 2, 0], [0, 0, 2]])
                    .unwrap(),
                16,
                8.0,
            ),
            ("diag [2,3,1]", nacl.make_supercell_diag([2, 3, 1]), 12, 6.0),
            ("* 2 operator", &nacl * 2, 16, 8.0),
            ("* [3,1,2] operator", &nacl * [3, 1, 2], 12, 6.0),
            (
                "sheared [[2,1,0],[0,1,0],[0,0,1]]",
                nacl.make_supercell([[2, 1, 0], [0, 1, 0], [0, 0, 1]])
                    .unwrap(),
                4,
                2.0,
            ),
        ];

        for (desc, super_s, exp_sites, vol_factor) in cases {
            assert_eq!(super_s.num_sites(), exp_sites, "{desc}: wrong site count");
            assert!(
                (super_s.lattice.volume() - orig_vol * vol_factor).abs() < 1e-6,
                "{desc}: volume should scale by {vol_factor}"
            );
        }

        // Verify composition scales correctly (2x2x2)
        let super_nacl = &nacl * 2;
        assert_eq!(super_nacl.composition().get(Element::Na), 8.0);
        assert_eq!(super_nacl.composition().get(Element::Cl), 8.0);

        // FCC conventional: 4 atoms -> 2x2x2 = 32
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        assert_eq!(fcc.make_supercell_diag([2, 2, 2]).num_sites(), 32);

        // Verify coordinates are distinct (atoms distributed, not clustered at same positions)
        // For 16 sites in 2x2x2 supercell, all coords should be unique
        let fc = &super_nacl.frac_coords;
        let n_unique = fc
            .iter()
            .map(|c| format!("{:.6},{:.6},{:.6}", c[0], c[1], c[2]))
            .collect::<std::collections::HashSet<_>>()
            .len();
        assert_eq!(
            n_unique, 16,
            "2x2x2 supercell should have 16 unique positions, got {n_unique}"
        );
    }

    #[test]
    fn test_supercell_monoclinic_lattice_vectors() {
        // Verify matrix multiplication order with non-cubic lattice
        let mono = Structure::new(
            Lattice::from_parameters(3.0, 4.0, 5.0, 90.0, 100.0, 90.0),
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );
        let mono_super = mono
            .make_supercell([[2, 0, 0], [0, 1, 0], [0, 0, 1]])
            .unwrap();

        // 2x1x1: new a-vector should be 2x original
        let orig = mono.lattice.matrix().row(0);
        let new = mono_super.lattice.matrix().row(0);
        for idx in 0..3 {
            assert!(
                (new[idx] - 2.0 * orig[idx]).abs() < 1e-6,
                "a-vector[{idx}] mismatch"
            );
        }
    }

    #[test]
    fn test_supercell_zero_det_error() {
        let result = make_nacl().make_supercell([[1, 0, 0], [1, 0, 0], [0, 0, 1]]);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("zero determinant"));
    }

    #[test]
    fn test_supercell_negative_diagonal() {
        // Negative diagonal values create mirror transforms
        // The supercell should still have correct site count and volume
        let nacl = make_nacl();
        let orig_vol = nacl.lattice.volume();

        // Test negative scaling: -2 x 1 x 1 (mirror along a-axis, doubled)
        let super_neg = nacl
            .make_supercell([[-2, 0, 0], [0, 1, 0], [0, 0, 1]])
            .unwrap();
        assert_eq!(super_neg.num_sites(), 4, "Should have 4 sites");
        assert!(
            (super_neg.lattice.volume().abs() - orig_vol * 2.0).abs() < 1e-6,
            "Volume should double (may be negative for mirror)"
        );

        // Verify behavior matches general algorithm by comparing with non-diagonal
        // that produces same result: [[-2,0,0],[0,1,0],[0,0,1]] vs general path
        let super_gen = nacl
            .make_supercell([[-2, 0, 0], [0, 1, 0], [0, 0, 1]])
            .unwrap();
        assert_eq!(super_neg.num_sites(), super_gen.num_sites());
    }

    #[test]
    fn test_supercell_preserves_site_properties() {
        // Create a structure with site properties
        let lattice = Lattice::cubic(4.0);
        let species = Species::neutral(Element::Fe);

        let mut props = HashMap::new();
        props.insert("magmom".to_string(), serde_json::json!(2.5));
        props.insert("label".to_string(), serde_json::json!("Fe1"));

        let site_occ = SiteOccupancy::with_properties(vec![(species, 1.0)], props);
        let s = Structure::try_new_from_occupancies(
            lattice,
            vec![site_occ],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        )
        .unwrap();

        // Make 2x2x2 supercell
        let super_cell = s.make_supercell_diag([2, 2, 2]);
        assert_eq!(super_cell.num_sites(), 8);

        // Each site should have the original properties plus orig_site_idx
        for idx in 0..8 {
            let props = super_cell.site_properties(idx);

            // Original properties preserved
            assert_eq!(props.get("magmom").and_then(|v| v.as_f64()), Some(2.5));
            assert_eq!(props.get("label").and_then(|v| v.as_str()), Some("Fe1"));

            // orig_site_idx should be 0 (only one original site)
            assert_eq!(
                props.get("orig_site_idx").and_then(|v| v.as_u64()),
                Some(0),
                "Site {idx} missing orig_site_idx"
            );
        }
    }

    #[test]
    fn test_supercell_orig_site_idx_multiple_sites() {
        // Test with multiple original sites
        let nacl = make_nacl(); // 2 sites: Na at 0,0,0 and Cl at 0.5,0.5,0.5

        // Make 2x1x1 supercell
        let super_cell = nacl.make_supercell_diag([2, 1, 1]);
        assert_eq!(super_cell.num_sites(), 4);

        // Should have 2 sites from orig_site_idx 0 and 2 from orig_site_idx 1
        let orig_indices: Vec<u64> = (0..4)
            .map(|idx| {
                super_cell
                    .site_properties(idx)
                    .get("orig_site_idx")
                    .and_then(|v| v.as_u64())
                    .expect("Missing orig_site_idx")
            })
            .collect();

        assert_eq!(orig_indices.iter().filter(|&&x| x == 0).count(), 2);
        assert_eq!(orig_indices.iter().filter(|&&x| x == 1).count(), 2);
    }

    #[test]
    fn test_supercell_nested_preserves_orig_site_idx() {
        // Test that nested supercells preserve the original site index
        let lattice = Lattice::cubic(4.0);
        let species = Species::neutral(Element::Fe);
        let site_occ = SiteOccupancy::ordered(species);
        let s = Structure::try_new_from_occupancies(
            lattice,
            vec![site_occ],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        )
        .unwrap();

        // First supercell: 2x1x1
        let super1 = s.make_supercell_diag([2, 1, 1]);
        assert_eq!(super1.num_sites(), 2);

        // All sites should have orig_site_idx = 0 (from original structure)
        for idx in 0..2 {
            assert_eq!(
                super1
                    .site_properties(idx)
                    .get("orig_site_idx")
                    .and_then(|v| v.as_u64()),
                Some(0)
            );
        }

        // Second supercell of the first: 1x2x1
        let super2 = super1.make_supercell_diag([1, 2, 1]);
        assert_eq!(super2.num_sites(), 4);

        // All sites should STILL have orig_site_idx = 0 (preserved from first supercell)
        for idx in 0..4 {
            assert_eq!(
                super2
                    .site_properties(idx)
                    .get("orig_site_idx")
                    .and_then(|v| v.as_u64()),
                Some(0),
                "Site {idx} should preserve original orig_site_idx"
            );
        }
    }

    #[test]
    fn test_reduced_structure_wraps_coords() {
        let reduced = make_cu_at(1.5, -0.3, 0.8) // outside [0,1)
            .get_reduced_structure(ReductionAlgo::Niggli)
            .unwrap();
        for &c in reduced.frac_coords[0].iter() {
            assert!((0.0..1.0).contains(&c), "coord {c} not in [0,1)");
        }
    }

    // =========================================================================
    // Slab Generation Tests
    // =========================================================================

    #[test]
    fn test_reduce_miller_indices() {
        use super::reduce_miller_indices;

        let cases: [([i32; 3], [i32; 3]); 14] = [
            // Already reduced
            ([1, 0, 0], [1, 0, 0]),
            ([1, 1, 1], [1, 1, 1]),
            // Needs reduction
            ([2, 0, 0], [1, 0, 0]),
            ([2, 2, 2], [1, 1, 1]),
            ([4, 2, 6], [2, 1, 3]),
            ([6, 9, 12], [2, 3, 4]),
            // Negatives
            ([-2, 0, 0], [-1, 0, 0]),
            ([2, -4, 2], [1, -2, 1]),
            ([-3, -6, -9], [-1, -2, -3]),
            // Zeros
            ([0, 0, 0], [0, 0, 0]),
            ([0, 2, 0], [0, 1, 0]),
            ([0, 0, 4], [0, 0, 1]),
            // Mixed
            ([1, 2, 3], [1, 2, 3]),
            ([-1, 1, 0], [-1, 1, 0]),
        ];

        for (input, expected) in cases {
            assert_eq!(
                reduce_miller_indices(input),
                expected,
                "reduce({:?})",
                input
            );
        }
    }

    #[test]
    fn test_slab_transformation_nonsingular() {
        use super::get_slab_transformation;

        let det3 = |m: [[i32; 3]; 3]| {
            m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
                - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
        };

        let cubic = Lattice::cubic(4.0);
        for hkl in [
            [1, 0, 0],
            [0, 1, 0],
            [1, 1, 0],
            [1, 1, 1],
            [2, 1, 0],
            [3, 1, 1],
        ] {
            assert!(
                det3(get_slab_transformation(&cubic, hkl)) != 0,
                "{:?} singular",
                hkl
            );
        }
    }

    #[test]
    fn test_compute_d_spacing() {
        use super::compute_d_spacing;

        let a = 4.0;
        let cubic = Lattice::cubic(a);

        // d(hkl) = a / sqrt(h² + k² + l²)
        for (hkl, divisor) in [
            ([1, 0, 0], 1.0),
            ([1, 1, 0], 2.0_f64.sqrt()),
            ([1, 1, 1], 3.0_f64.sqrt()),
            ([2, 0, 0], 2.0),
            ([2, 1, 1], 6.0_f64.sqrt()),
        ] {
            let d = compute_d_spacing(&cubic, hkl);
            assert!((d - a / divisor).abs() < 1e-10, "d{:?}", hkl);
        }

        // Tetragonal: d(001)=c, d(100)=a
        let tetra = Lattice::tetragonal(4.0, 6.0);
        assert!((compute_d_spacing(&tetra, [0, 0, 1]) - 6.0).abs() < 1e-10);
        assert!((compute_d_spacing(&tetra, [1, 0, 0]) - 4.0).abs() < 1e-10);
    }

    #[test]
    fn test_identify_layer_positions() {
        use super::identify_layer_positions;

        // Empty
        assert!(identify_layer_positions(&[], 0.01).is_empty());

        // Single layer
        let single = vec![Vector3::new(0.0, 0.0, 0.5), Vector3::new(0.5, 0.5, 0.5)];
        let layers = identify_layer_positions(&single, 0.01);
        assert_eq!(layers.len(), 1);
        assert!((layers[0] - 0.5).abs() < 1e-10);

        // Multiple layers
        let multi = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 0.33),
            Vector3::new(0.0, 0.0, 0.67),
        ];
        assert_eq!(identify_layer_positions(&multi, 0.05).len(), 3);

        // Tolerance sensitivity: [0.0, 0.02, 0.04]
        let chain = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 0.02),
            Vector3::new(0.0, 0.0, 0.04),
        ];
        assert_eq!(identify_layer_positions(&chain, 0.05).len(), 1); // large tol = 1 layer
        assert_eq!(identify_layer_positions(&chain, 0.01).len(), 3); // small tol = 3 layers
    }

    #[test]
    fn test_slab_config() {
        // Default values
        let def = SlabConfig::default();
        assert_eq!(def.miller_index, [1, 0, 0]);
        assert_eq!(def.min_slab_size, 10.0);
        assert!(def.center_slab);

        // Builder
        let cfg = SlabConfig::new([1, 1, 0])
            .with_min_slab_size(15.0)
            .with_min_vacuum_size(20.0)
            .with_center_slab(false)
            .with_in_unit_planes(true)
            .with_symprec(0.001);

        assert_eq!(cfg.miller_index, [1, 1, 0]);
        assert_eq!(cfg.min_slab_size, 15.0);
        assert_eq!(cfg.min_vacuum_size, 20.0);
        assert!(!cfg.center_slab);
        assert!(cfg.in_unit_planes);
    }

    #[test]
    fn test_make_slab_basic() {
        let cubic = make_cu_cubic(4.0);
        let slab = cubic
            .make_slab(
                &SlabConfig::new([1, 0, 0])
                    .with_min_slab_size(8.0)
                    .with_min_vacuum_size(10.0),
            )
            .unwrap();

        assert_eq!(slab.lattice.pbc, [true, true, false]);
        assert!(slab.num_sites() >= 2);
        assert_eq!(
            slab.properties["miller_index"],
            serde_json::json!([1, 0, 0])
        );
        assert_eq!(slab.properties["termination_index"], serde_json::json!(0));
    }

    #[test]
    fn test_make_slab_various_surfaces() {
        let cubic = make_cu_cubic(4.0);

        for hkl in [[1, 0, 0], [1, 1, 0], [1, 1, 1], [2, 1, 0], [2, 1, 1]] {
            let slab = cubic
                .make_slab(
                    &SlabConfig::new(hkl)
                        .with_min_slab_size(8.0)
                        .with_min_vacuum_size(10.0),
                )
                .unwrap_or_else(|_| panic!("{:?} failed", hkl));

            assert_eq!(slab.lattice.pbc, [true, true, false]);
            assert!(slab.num_sites() > 0);

            // All coords approximately in [0,1) (allowing small floating point tolerance)
            for fc in &slab.frac_coords {
                assert!(fc.x >= -1e-10 && fc.x < 1.0 + 1e-10, "x={}", fc.x);
                assert!(fc.y >= -1e-10 && fc.y < 1.0 + 1e-10, "y={}", fc.y);
                assert!(fc.z >= -1e-10 && fc.z < 1.0 + 1e-10, "z={}", fc.z);
            }
        }
    }

    #[test]
    fn test_make_slab_in_unit_planes() {
        let cubic = make_cu_cubic(4.0);
        let slab = cubic
            .make_slab(
                &SlabConfig::new([1, 0, 0])
                    .with_min_slab_size(3.0)
                    .with_in_unit_planes(true)
                    .with_min_vacuum_size(10.0),
            )
            .unwrap();

        // 3 planes * 4Å + 10Å vacuum ≈ 22Å
        let c = slab.lattice.lengths().z;
        assert!((c - 22.0).abs() < 1.0, "c={}", c);
    }

    #[test]
    fn test_make_slab_centering() {
        let cubic = make_cu_cubic(4.0);
        let avg_z =
            |s: &Structure| s.frac_coords.iter().map(|c| c.z).sum::<f64>() / s.num_sites() as f64;

        let centered = cubic
            .make_slab(
                &SlabConfig::new([1, 0, 0])
                    .with_min_slab_size(4.0)
                    .with_min_vacuum_size(20.0)
                    .with_center_slab(true),
            )
            .unwrap();
        let bottom = cubic
            .make_slab(
                &SlabConfig::new([1, 0, 0])
                    .with_min_slab_size(4.0)
                    .with_min_vacuum_size(20.0)
                    .with_center_slab(false),
            )
            .unwrap();

        assert!(avg_z(&centered) > avg_z(&bottom));
        assert!(
            avg_z(&centered) > 0.3,
            "centered avg_z={}",
            avg_z(&centered)
        );
    }

    #[test]
    fn test_make_slab_errors() {
        let cubic = make_cu_cubic(4.0);
        let empty = Structure::new(Lattice::cubic(4.0), vec![], vec![]);

        // [0,0,0] rejected
        let err = cubic.make_slab(&SlabConfig::new([0, 0, 0])).unwrap_err();
        assert!(err.to_string().contains("zero"));

        // Negative vacuum rejected
        let err = cubic
            .make_slab(&SlabConfig::new([1, 0, 0]).with_min_vacuum_size(-5.0))
            .unwrap_err();
        assert!(err.to_string().contains("non-negative"));

        // NaN vacuum rejected
        let err = cubic
            .make_slab(&SlabConfig::new([1, 0, 0]).with_min_vacuum_size(f64::NAN))
            .unwrap_err();
        assert!(err.to_string().contains("finite"));

        // Empty structure rejected
        let err = empty.make_slab(&SlabConfig::new([1, 0, 0])).unwrap_err();
        assert!(err.to_string().contains("empty"));

        // Non-positive slab size rejected
        let err = cubic
            .make_slab(&SlabConfig::new([1, 0, 0]).with_min_slab_size(0.0))
            .unwrap_err();
        assert!(err.to_string().contains("positive"));

        // Invalid symprec rejected
        let err = cubic
            .make_slab(&SlabConfig::new([1, 0, 0]).with_symprec(0.0))
            .unwrap_err();
        assert!(err.to_string().contains("positive"));
    }

    #[test]
    fn test_generate_slabs_terminations() {
        let nacl = make_nacl();
        let slabs = nacl
            .generate_slabs(
                &SlabConfig::new([1, 0, 0])
                    .with_min_slab_size(10.0)
                    .with_min_vacuum_size(10.0),
            )
            .unwrap();

        assert!(!slabs.is_empty());

        for (idx, slab) in slabs.iter().enumerate() {
            assert_eq!(slab.lattice.pbc, [true, true, false]);
            assert_eq!(
                slab.properties["termination_index"].as_u64().unwrap(),
                idx as u64
            );
        }
    }
}
