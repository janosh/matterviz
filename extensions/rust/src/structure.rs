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
use std::collections::{BTreeMap, HashMap};

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

    /// Get the composition of the structure (weighted by occupancy for disordered sites).
    pub fn composition(&self) -> Composition {
        let mut counts: BTreeMap<Element, f64> = BTreeMap::new();
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
    pub fn get_distance(&self, i: usize, j: usize) -> f64 {
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
        let (_, d2) =
            crate::pbc::pbc_shortest_vectors(&self.lattice, &fcoords_i, &fcoords_j, None, None);
        d2[0][0].sqrt()
    }

    /// Get the full distance matrix between all sites under PBC.
    pub fn distance_matrix(&self) -> Vec<Vec<f64>> {
        let num_sites = self.num_sites();
        if num_sites == 0 {
            return vec![];
        }

        let (_, d2) = crate::pbc::pbc_shortest_vectors(
            &self.lattice,
            &self.frac_coords,
            &self.frac_coords,
            None,
            None,
        );

        d2.into_iter()
            .map(|row| row.into_iter().map(|d| d.sqrt()).collect())
            .collect()
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
                thread_rng = rand::rng();
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
// Random Vector Generation for Perturbation
// =============================================================================

/// Generate a random vector with magnitude uniformly distributed in [min_dist, max_dist].
///
/// Direction is uniformly distributed on the unit sphere using rejection sampling.
fn get_random_vector(rng: &mut dyn rand::RngCore, min_dist: f64, max_dist: f64) -> Vector3<f64> {
    use rand::Rng;

    loop {
        // Generate point in cube [-1, 1]^3
        let x: f64 = rng.random_range(-1.0..1.0);
        let y: f64 = rng.random_range(-1.0..1.0);
        let z: f64 = rng.random_range(-1.0..1.0);
        let norm_sq = x * x + y * y + z * z;

        // Rejection sampling: accept if inside unit sphere and not at origin
        if norm_sq > 0.01 && norm_sq <= 1.0 {
            let norm = norm_sq.sqrt();
            let magnitude = rng.random_range(min_dist..=max_dist);
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
}
