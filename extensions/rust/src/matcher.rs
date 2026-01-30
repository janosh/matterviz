//! Structure matching algorithm.
//!
//! This module provides `StructureMatcher` for comparing crystal structures,
//! implementing the same algorithm as pymatgen's StructureMatcher.

use crate::element::Element;
use crate::error::OnError;
use crate::lattice::Lattice;
use crate::pbc::{is_coord_subset_pbc, pbc_shortest_vectors, wrap_frac_coords};
use crate::species::Species;
use crate::structure::Structure;
use itertools::Itertools;
use nalgebra::{Matrix3, Vector3};
use pathfinding::kuhn_munkres::kuhn_munkres_min;
use pathfinding::matrix::Matrix as PathMatrix;
use std::collections::HashMap;
use std::f64::consts::PI;

/// Type of comparator to use for species matching.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ComparatorType {
    /// Exact species match (element + oxidation state).
    #[default]
    Species,
    /// Element-only matching (ignores oxidation state).
    Element,
}

/// Configuration and state for structure matching.
#[derive(Debug, Clone)]
pub struct StructureMatcher {
    /// Fractional length tolerance for lattice vectors.
    pub latt_len_tol: f64,
    /// Site position tolerance (normalized).
    pub site_pos_tol: f64,
    /// Angle tolerance in degrees.
    pub angle_tol: f64,
    /// Whether to reduce to primitive cell first.
    pub primitive_cell: bool,
    /// Whether to scale volumes to match.
    pub scale: bool,
    /// Whether to attempt supercell matching.
    pub attempt_supercell: bool,
    /// The comparator type to use for species matching.
    pub comparator_type: ComparatorType,
    /// Error handling behavior.
    pub on_error: OnError,
}

impl Default for StructureMatcher {
    fn default() -> Self {
        Self {
            latt_len_tol: 0.2,
            site_pos_tol: 0.3,
            angle_tol: 5.0,
            // Match pymatgen's default: reduce to primitive cell before matching
            primitive_cell: true,
            scale: true,
            attempt_supercell: false,
            comparator_type: ComparatorType::Species,
            on_error: OnError::Skip,
        }
    }
}

impl StructureMatcher {
    /// Create a new StructureMatcher with default settings.
    pub fn new() -> Self {
        Self::default()
    }

    /// Builder method to set lattice length tolerance.
    pub fn with_latt_len_tol(mut self, latt_len_tol: f64) -> Self {
        self.latt_len_tol = latt_len_tol;
        self
    }

    /// Builder method to set site position tolerance.
    pub fn with_site_pos_tol(mut self, site_pos_tol: f64) -> Self {
        self.site_pos_tol = site_pos_tol;
        self
    }

    /// Builder method to set angle tolerance.
    pub fn with_angle_tol(mut self, angle_tol: f64) -> Self {
        self.angle_tol = angle_tol;
        self
    }

    /// Builder method to set primitive cell reduction.
    pub fn with_primitive_cell(mut self, primitive_cell: bool) -> Self {
        self.primitive_cell = primitive_cell;
        self
    }

    /// Builder method to set volume scaling.
    pub fn with_scale(mut self, scale: bool) -> Self {
        self.scale = scale;
        self
    }

    /// Builder method to set supercell matching.
    pub fn with_attempt_supercell(mut self, attempt_supercell: bool) -> Self {
        self.attempt_supercell = attempt_supercell;
        self
    }

    /// Builder method to set the comparator type.
    pub fn with_comparator(mut self, comparator_type: ComparatorType) -> Self {
        self.comparator_type = comparator_type;
        self
    }

    /// Builder method to set error handling.
    pub fn with_on_error(mut self, on_error: OnError) -> Self {
        self.on_error = on_error;
        self
    }

    /// Check if two species are equal according to the comparator.
    fn species_equal(&self, sp1: &Species, sp2: &Species) -> bool {
        match self.comparator_type {
            ComparatorType::Species => sp1 == sp2,
            ComparatorType::Element => sp1.element == sp2.element,
        }
    }

    /// Get composition hash for prefiltering, aligned with comparator semantics.
    ///
    /// For `ComparatorType::Element`, oxidation states are ignored.
    /// For `ComparatorType::Species`, full species information is used.
    pub fn composition_hash(&self, structure: &Structure) -> u64 {
        match self.comparator_type {
            ComparatorType::Element => structure.composition().formula_hash(),
            ComparatorType::Species => structure.species_composition().species_hash(),
        }
    }

    /// Get reduced structure (Niggli reduced, optionally primitive).
    ///
    /// Matches pymatgen's `_get_reduced_structure` behavior:
    /// 1. Niggli reduction on the lattice
    /// 2. If `primitive_cell` is true, reduce to primitive cell via symmetry analysis
    ///
    /// Properties from the original structure are preserved.
    fn get_reduced_structure(&self, structure: &Structure) -> Structure {
        let mut result = structure.clone();

        // Do Niggli reduction on the lattice
        if let Ok(niggli) = result.lattice.get_niggli_reduced(1e-5) {
            // Transform coordinates to new lattice
            let old_cart = result.cart_coords();
            result.lattice = niggli;
            result.frac_coords = result.lattice.get_fractional_coords(&old_cart);
            // Wrap to [0, 1)
            for coord in &mut result.frac_coords {
                *coord = wrap_frac_coords(coord);
            }
        }

        // Reduce to primitive cell if requested (skip empty structures)
        if self.primitive_cell
            && result.num_sites() > 0
            && let Ok(mut prim) = result.get_primitive(1e-4)
        {
            // Preserve properties from original structure
            prim.properties = result.properties.clone();
            result = prim;
        }

        result
    }

    /// Preprocess structures for matching (reduces then prepares pair).
    ///
    /// Returns (struct1, struct2, supercell_factor, s1_supercell)
    fn preprocess(
        &self,
        struct1: &Structure,
        struct2: &Structure,
    ) -> (Structure, Structure, usize, bool) {
        let s1 = self.get_reduced_structure(struct1);
        let s2 = self.get_reduced_structure(struct2);
        self.preprocess_pair(s1, s2)
    }

    /// Prepare already-reduced structures for matching.
    ///
    /// Computes supercell factor and scales volumes. Use when structures have
    /// already been reduced via `reduce_structure`.
    ///
    /// Returns (struct1, struct2, supercell_factor, s1_supercell)
    fn preprocess_pair(
        &self,
        mut s1: Structure,
        mut s2: Structure,
    ) -> (Structure, Structure, usize, bool) {
        // Determine supercell factor with bounds checking
        // Maximum supercell factor to prevent extremely expensive computations
        const MAX_SUPERCELL_FACTOR: usize = 10;

        let (supercell_factor, s1_supercell) = if self.attempt_supercell {
            // Guard against division by zero
            if s1.num_sites() == 0 || s2.num_sites() == 0 {
                (1, true)
            } else {
                let ratio = s2.num_sites() as f64 / s1.num_sites() as f64;
                if ratio < 2.0 / 3.0 {
                    // Clamp to valid range [1, MAX_SUPERCELL_FACTOR]
                    let factor = (1.0 / ratio).round() as usize;
                    (factor.clamp(1, MAX_SUPERCELL_FACTOR), false)
                } else {
                    let factor = ratio.round() as usize;
                    (factor.clamp(1, MAX_SUPERCELL_FACTOR), true)
                }
            }
        } else {
            (1, true)
        };

        let mult = if s1_supercell {
            supercell_factor as f64
        } else {
            1.0 / supercell_factor as f64
        };

        // Scale lattices to same volume (skip if empty or degenerate to avoid division by zero)
        let v1 = s1.lattice.volume();
        let v2 = s2.lattice.volume();
        if self.scale && v1 > f64::EPSILON && v2 > f64::EPSILON {
            // PBC consistency check - prevents silent drift when scaling overwrites pbc
            debug_assert_eq!(
                s1.lattice.pbc, s2.lattice.pbc,
                "PBC mismatch in preprocess_pair"
            );
            let pbc = s1.lattice.pbc;
            let ratio = (v2 / (v1 * mult)).powf(1.0 / 6.0);
            s1.lattice = Lattice::new(*s1.lattice.matrix() * ratio);
            s1.lattice.pbc = pbc;
            s2.lattice = Lattice::new(*s2.lattice.matrix() / ratio);
            s2.lattice.pbc = pbc;
        }

        (s1, s2, supercell_factor, s1_supercell)
    }

    /// Create a mask for species matching.
    ///
    /// mask[i][j] = true means s2[i] cannot match s1[j]
    fn get_mask(&self, struct1: &Structure, struct2: &Structure) -> Vec<Vec<bool>> {
        let n1 = struct1.num_sites();
        let n2 = struct2.num_sites();
        let mut mask = vec![vec![false; n1]; n2];

        let species1 = struct1.species();
        let species2 = struct2.species();
        for (idx2, sp2) in species2.iter().enumerate() {
            for (idx1, sp1) in species1.iter().enumerate() {
                mask[idx2][idx1] = !self.species_equal(sp1, sp2);
            }
        }

        mask
    }

    /// Find translation indices for matching.
    fn get_translation_indices(&self, mask: &[Vec<bool>]) -> (Vec<usize>, usize) {
        if mask.is_empty() {
            return (vec![], 0);
        }

        // Find the row with the most masked (incompatible) entries
        // Note: mask is guaranteed non-empty (checked at line 230), so unwrap is safe
        let (best_row, _) = mask
            .iter()
            .enumerate()
            .max_by_key(|(_, row)| row.iter().filter(|&&x| x).count())
            .unwrap();

        // Find unmasked indices in struct1 for this row
        let s1_inds: Vec<usize> = mask[best_row]
            .iter()
            .enumerate()
            .filter(|&(_, &masked)| !masked)
            .map(|(idx, _)| idx)
            .collect();

        (s1_inds, best_row)
    }

    /// Get lattice mappings for matching.
    fn get_lattices(
        &self,
        target_lattice: &Lattice,
        source: &Structure,
        supercell_size: usize,
    ) -> Vec<(Lattice, Matrix3<i32>)> {
        let all_mappings = source.lattice.find_all_mappings(
            target_lattice,
            self.latt_len_tol,
            self.angle_tol,
            true,
        );

        all_mappings
            .into_iter()
            .filter(|(_, _, scale_m)| {
                let det = scale_m.map(|x| x as f64).determinant().abs();
                (det - supercell_size as f64).abs() < 0.5
            })
            .map(|(latt, _, scale_m)| (latt, scale_m))
            .collect()
    }

    /// Compute average lattice from two lattices.
    fn average_lattice(l1: &Lattice, l2: &Lattice) -> Lattice {
        let params1 = l1.lengths();
        let params2 = l2.lengths();
        let angles1 = l1.angles();
        let angles2 = l2.angles();

        Lattice::from_parameters(
            (params1[0] + params2[0]) / 2.0,
            (params1[1] + params2[1]) / 2.0,
            (params1[2] + params2[2]) / 2.0,
            (angles1[0] + angles2[0]) / 2.0,
            (angles1[1] + angles2[1]) / 2.0,
            (angles1[2] + angles2[2]) / 2.0,
        )
    }

    /// Compute Cartesian distances using Hungarian algorithm.
    ///
    /// Returns (distances, translation, mapping)
    fn cart_dists(
        &self,
        s1_fc: &[Vector3<f64>],
        s2_fc: &[Vector3<f64>],
        avg_lattice: &Lattice,
        mask: &[Vec<bool>],
        normalization: f64,
    ) -> Option<(Vec<f64>, Vector3<f64>, Vec<usize>)> {
        let n1 = s1_fc.len();
        let n2 = s2_fc.len();

        if n2 > n1 || n2 == 0 {
            return None;
        }

        // Get shortest vectors
        let (vecs, d2, _) = pbc_shortest_vectors(avg_lattice, s2_fc, s1_fc, Some(mask), None);

        // Solve linear assignment problem
        // Convert to integer costs (multiply by large factor for precision)
        let scale = 1e10;
        let mut cost_matrix = PathMatrix::new(n2, n1, i64::MAX / 2);

        for idx in 0..n2 {
            for jdx in 0..n1 {
                if !mask[idx][jdx] {
                    // Clamp to avoid overflow (masked cells already have i64::MAX / 2)
                    cost_matrix[(idx, jdx)] =
                        (d2[idx][jdx] * scale).min(i64::MAX as f64 / 2.0) as i64;
                }
            }
        }

        let (_total_cost, assignment) = kuhn_munkres_min(&cost_matrix);
        let mapping: Vec<usize> = assignment.to_vec();

        // Compute translation and distances
        let mut short_vecs = Vec::with_capacity(n2);
        for (idx, &jdx) in mapping.iter().enumerate() {
            if jdx < vecs[idx].len() {
                short_vecs.push(vecs[idx][jdx]);
            } else {
                return None;
            }
        }

        // Translation is mean of short vectors (guard against empty vector)
        if short_vecs.is_empty() {
            return None;
        }
        let translation: Vector3<f64> =
            short_vecs.iter().fold(Vector3::zeros(), |acc, v| acc + v) / short_vecs.len() as f64;

        // Distances after translation adjustment
        let distances: Vec<f64> = short_vecs
            .iter()
            .map(|v| (v - translation).norm() * normalization)
            .collect();

        let f_translation = avg_lattice.get_fractional_coords(&[translation])[0];

        Some((distances, f_translation, mapping))
    }

    /// Check if two fractional coordinate sets match within tolerance.
    fn cmp_fstruct(
        s1_fc: &[Vector3<f64>],
        s2_fc: &[Vector3<f64>],
        frac_tol: [f64; 3],
        mask: &[Vec<bool>],
    ) -> bool {
        is_coord_subset_pbc(s2_fc, s1_fc, frac_tol, mask, [true, true, true])
    }

    /// Strict matching - s1 should contain all sites in s2.
    fn strict_match(
        &self,
        struct1: &Structure,
        struct2: &Structure,
        supercell_factor: usize,
        break_on_match: bool,
        use_rms: bool,
    ) -> Option<(f64, Vec<f64>, Vec<usize>)> {
        let mask = self.get_mask(struct1, struct2);

        if mask.is_empty() {
            return None;
        }

        let (struct1_translation_indices, struct2_translation_idx) =
            self.get_translation_indices(&mask);

        // Check dimensions
        if struct2.num_sites() > struct1.num_sites() {
            return None;
        }

        // Check that a valid matching is possible
        for row in &mask {
            if row.iter().all(|&x| x) {
                return None;
            }
        }

        let mut best_match: Option<(f64, Vec<f64>, Vec<usize>)> = None;

        // Get all lattice mappings
        let lattices = self.get_lattices(&struct2.lattice, struct1, supercell_factor);

        if lattices.is_empty() {
            return None;
        }

        // Loop over all lattice mappings
        for (latt, _scale_m) in &lattices {
            let avg_lattice = Self::average_lattice(latt, &struct2.lattice);

            // Compute fractional coordinate tolerance
            let normalization = (struct1.num_sites() as f64 / avg_lattice.volume()).powf(1.0 / 3.0);
            let recip_lengths = avg_lattice.reciprocal().lengths();
            let scale = self.site_pos_tol / (PI * normalization);
            let frac_coord_tol = [
                recip_lengths[0] * scale,
                recip_lengths[1] * scale,
                recip_lengths[2] * scale,
            ];

            // Get fractional coords in the aligned lattice
            let s1_cart = struct1.cart_coords();
            let mut s1_fc = latt.get_fractional_coords(&s1_cart);
            // Wrap to [0, 1)
            for coord in &mut s1_fc {
                *coord = wrap_frac_coords(coord);
            }

            let s2_fc = &struct2.frac_coords;

            // Try different translations
            for &s1i in &struct1_translation_indices {
                if s1i >= s1_fc.len() || struct2_translation_idx >= s2_fc.len() {
                    continue;
                }

                let translation = s1_fc[s1i] - s2_fc[struct2_translation_idx];
                let translated_s2_fc: Vec<Vector3<f64>> =
                    s2_fc.iter().map(|frac| frac + translation).collect();

                // Check if fractional coords match
                if Self::cmp_fstruct(&s1_fc, &translated_s2_fc, frac_coord_tol, &mask) {
                    // Compute distances
                    if let Some((distances, _adjusted_translation, mapping)) = self.cart_dists(
                        &s1_fc,
                        &translated_s2_fc,
                        &avg_lattice,
                        &mask,
                        normalization,
                    ) {
                        let val = if use_rms {
                            let sum_sq: f64 = distances.iter().map(|d| d * d).sum();
                            (sum_sq / distances.len() as f64).sqrt()
                        } else {
                            distances.iter().copied().fold(0.0, f64::max)
                        };

                        if best_match.as_ref().is_none_or(|m| val < m.0) {
                            best_match = Some((val, distances.clone(), mapping));

                            if (break_on_match || val < 1e-5) && val < self.site_pos_tol {
                                return best_match;
                            }
                        }
                    }
                }
            }
        }

        best_match.filter(|m| m.0 < self.site_pos_tol)
    }

    /// Internal match function.
    fn match_internal(
        &self,
        struct1: &Structure,
        struct2: &Structure,
        supercell_factor: usize,
        s1_supercell: bool,
        break_on_match: bool,
        use_rms: bool,
    ) -> Option<(f64, Vec<f64>, Vec<usize>)> {
        let ratio = if s1_supercell {
            supercell_factor as f64
        } else {
            1.0 / supercell_factor as f64
        };

        if (struct1.num_sites() as f64 * ratio) >= struct2.num_sites() as f64 {
            self.strict_match(struct1, struct2, supercell_factor, break_on_match, use_rms)
        } else {
            self.strict_match(struct2, struct1, supercell_factor, break_on_match, use_rms)
        }
    }

    /// Check if two structures match.
    ///
    /// # Returns
    ///
    /// `true` if the structures are equivalent within the specified tolerances.
    ///
    /// # Note
    ///
    /// Empty structures (with no sites) always return `false` since there are no
    /// atoms to compare for structural equivalence.
    pub fn fit(&self, struct1: &Structure, struct2: &Structure) -> bool {
        // Reduce structures then delegate to fit_preprocessed
        self.fit_preprocessed(
            &self.get_reduced_structure(struct1),
            &self.get_reduced_structure(struct2),
        )
    }

    /// Get the RMS distance between two structures.
    ///
    /// # Returns
    ///
    /// `Some((rms, max_dist))` if structures match, `None` otherwise.
    pub fn get_rms_dist(&self, struct1: &Structure, struct2: &Structure) -> Option<(f64, f64)> {
        let (s1, s2, supercell_factor, s1_supercell) = self.preprocess(struct1, struct2);
        self.match_internal(&s1, &s2, supercell_factor, s1_supercell, false, true)
            .map(|(rms, distances, _)| {
                let max_dist = distances.iter().cloned().fold(0.0, f64::max);
                (rms, max_dist)
            })
    }

    /// Check if two structures match under any species permutation.
    ///
    /// This is useful for comparing structures where the identity of species
    /// is not important, only the arrangement. For example, NaCl and MgO both
    /// have the rocksalt structure, so `fit_anonymous` would return true.
    ///
    /// # Algorithm (matches pymatgen's fit_anonymous)
    ///
    /// 1. Get unique elements from both structures in order of first appearance
    /// 2. If different number of unique elements, return false
    /// 3. For each permutation of struct2's elements:
    ///    - Create mapping: struct1.elements[i] -> permuted_elements[i]
    ///    - Compute mapped composition from struct1
    ///    - If mapped composition hash != struct2 composition hash, skip (fast pruning)
    ///    - Otherwise, remap struct1's species and call fit()
    /// 4. Return true on first match
    ///
    /// # Note
    ///
    /// This method always uses element-only matching (ignores oxidation states),
    /// regardless of the matcher's `comparator_type` setting. This matches pymatgen's
    /// behavior where anonymous matching only considers elemental identity.
    pub fn fit_anonymous(&self, struct1: &Structure, struct2: &Structure) -> bool {
        // Get unique elements in order of first appearance
        let elements1 = struct1.unique_elements();
        let elements2 = struct2.unique_elements();

        // Different number of unique elements -> no match possible
        if elements1.len() != elements2.len() {
            return false;
        }

        // Handle empty structures
        if elements1.is_empty() {
            return false;
        }

        // Get compositions for fast pruning (compute once, outside loop)
        // Use element_composition() since fit_anonymous ignores oxidation states
        let comp1 = struct1.composition();
        let comp2 = struct2.composition();
        let comp2_hash = comp2.element_composition().formula_hash();

        // Create element-only matcher once (used for all permutations)
        let element_matcher = Self {
            comparator_type: ComparatorType::Element,
            ..self.clone()
        };

        // Try all permutations of elements2
        for perm in elements2.iter().permutations(elements2.len()) {
            // Create mapping: elements1[i] -> perm[i]
            let mapping: HashMap<Element, Element> = elements1
                .iter()
                .zip(perm.iter())
                .map(|(&e1, &&e2)| (e1, e2))
                .collect();

            // Fast composition hash check before expensive structure matching
            let mapped_comp = comp1.remap_elements(&mapping);
            if mapped_comp.element_composition().formula_hash() != comp2_hash {
                continue;
            }

            // Composition matches - do full structure comparison
            let remapped_struct1 = struct1.remap_species(&mapping);
            if element_matcher.fit(&remapped_struct1, struct2) {
                return true;
            }
        }

        false
    }

    /// Check if two already-reduced structures match.
    ///
    /// This is an optimization for batch operations where structures have already
    /// been preprocessed with `reduce_structure`. Skips redundant Niggli reduction
    /// and primitive cell reduction.
    ///
    /// # Arguments
    ///
    /// * `reduced1` - First structure (already Niggli reduced + primitive cell if enabled)
    /// * `reduced2` - Second structure (already preprocessed)
    ///
    /// # Note
    ///
    /// Use this when you've already called `reduce_structure` on both inputs.
    /// For general use, prefer `fit` which handles preprocessing automatically.
    pub fn fit_preprocessed(&self, reduced1: &Structure, reduced2: &Structure) -> bool {
        // Use preprocess_pair to handle supercell factor and volume scaling
        let (s1, s2, supercell_factor, s1_supercell) =
            self.preprocess_pair(reduced1.clone(), reduced2.clone());

        // Composition check
        if s1.composition() != s2.composition() {
            return false;
        }

        // Site count check (without supercell)
        if !self.attempt_supercell && s1.num_sites() != s2.num_sites() {
            return false;
        }

        self.match_internal(&s1, &s2, supercell_factor, s1_supercell, true, false)
            .is_some_and(|(val, _, _)| val <= self.site_pos_tol)
    }

    /// Apply Niggli reduction and optionally primitive cell reduction.
    ///
    /// Use this to preprocess structures before calling `fit_preprocessed`.
    pub fn reduce_structure(&self, structure: &Structure) -> Structure {
        self.get_reduced_structure(structure)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;

    // Helper: single atom at origin in cubic cell
    fn make_simple_cubic(element: Element, a: f64) -> Structure {
        Structure::new(
            Lattice::cubic(a),
            vec![Species::neutral(element)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        )
    }

    // Helper: two atoms in BCC-like positions
    fn make_bcc(element: Element, a: f64) -> Structure {
        Structure::new(
            Lattice::cubic(a),
            vec![Species::neutral(element), Species::neutral(element)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        )
    }

    fn make_nacl() -> Structure {
        Structure::new(
            Lattice::cubic(5.64),
            vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        )
    }

    fn make_nacl_shifted() -> Structure {
        Structure::new(
            Lattice::cubic(5.64),
            vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
            vec![Vector3::new(0.01, 0.0, 0.0), Vector3::new(0.51, 0.5, 0.5)],
        )
    }

    #[test]
    fn test_builder() {
        let matcher = StructureMatcher::new()
            .with_latt_len_tol(0.1)
            .with_site_pos_tol(0.2)
            .with_angle_tol(3.0);

        assert!((matcher.latt_len_tol - 0.1).abs() < 1e-10);
        assert!((matcher.site_pos_tol - 0.2).abs() < 1e-10);
        assert!((matcher.angle_tol - 3.0).abs() < 1e-10);
    }

    #[test]
    fn test_fit_identical() {
        let s = make_nacl();
        let matcher = StructureMatcher::new();
        assert!(matcher.fit(&s, &s));
    }

    #[test]
    fn test_fit_shifted() {
        let s1 = make_nacl();
        let s2 = make_nacl_shifted();
        let matcher = StructureMatcher::new();
        // Should match within default tolerance
        assert!(matcher.fit(&s1, &s2));
    }

    #[test]
    fn test_fit_different_composition() {
        let s1 = make_nacl();
        // KCl instead of NaCl
        let lattice = Lattice::cubic(5.64);
        let species = vec![Species::neutral(Element::K), Species::neutral(Element::Cl)];
        let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        let s2 = Structure::new(lattice, species, frac_coords);

        let matcher = StructureMatcher::new();
        // Different composition should not match
        assert!(!matcher.fit(&s1, &s2));
    }

    #[test]
    fn test_get_rms_dist() {
        let s1 = make_nacl();
        let s2 = make_nacl_shifted();
        let matcher = StructureMatcher::new();

        let result = matcher.get_rms_dist(&s1, &s2);
        assert!(result.is_some());

        let (rms, max_dist) = result.unwrap();
        // RMS should be small for slightly shifted structure
        assert!(rms < 0.1, "RMS {rms} too large");
        assert!(max_dist < 0.2, "max_dist {max_dist} too large");
    }

    #[test]
    fn test_fit_different_sites() {
        // Different number of sites
        let lattice = Lattice::cubic(5.64);
        let s1 = Structure::new(
            lattice.clone(),
            vec![Species::neutral(Element::Na)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        );
        let s2 = Structure::new(
            lattice,
            vec![Species::neutral(Element::Na), Species::neutral(Element::Na)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        let matcher = StructureMatcher::new();
        // Different number of sites should not match (without supercell)
        assert!(!matcher.fit(&s1, &s2));
    }

    #[test]
    fn test_fit_with_scale_true() {
        // Structures with same shape but different volumes should match with scale=true
        let s1 = make_simple_cubic(Element::Fe, 4.0);
        let s2 = make_simple_cubic(Element::Fe, 6.0); // 50% larger

        let matcher = StructureMatcher::new().with_scale(true);
        assert!(
            matcher.fit(&s1, &s2),
            "Same structure at different scales should match"
        );
    }

    #[test]
    fn test_fit_with_scale_false() {
        // With scale=false and tight ltol, very different volumes should not match
        let s1 = make_simple_cubic(Element::Fe, 4.0);
        let s2 = make_simple_cubic(Element::Fe, 6.0); // 50% larger, ratio=1.5 well outside ltol=0.2

        let matcher = StructureMatcher::new().with_scale(false);
        assert!(
            !matcher.fit(&s1, &s2),
            "Very different volumes should not match with scale=false"
        );
    }

    // Helper: single atom at origin with custom lattice
    fn make_single_site(lattice: Lattice, element: Element) -> Structure {
        Structure::new(
            lattice,
            vec![Species::neutral(element)],
            vec![Vector3::new(0.0, 0.0, 0.0)],
        )
    }

    // Helper: FCC conventional cell (4 atoms)
    fn make_fcc_conventional(element: Element, a: f64) -> Structure {
        Structure::new(
            Lattice::cubic(a),
            vec![
                Species::neutral(element),
                Species::neutral(element),
                Species::neutral(element),
                Species::neutral(element),
            ],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.5, 0.0),
                Vector3::new(0.5, 0.0, 0.5),
                Vector3::new(0.0, 0.5, 0.5),
            ],
        )
    }

    #[test]
    fn test_fit_angle_tolerance() {
        let s1 = make_single_site(
            Lattice::from_parameters(5.0, 5.0, 5.0, 90.0, 90.0, 90.0),
            Element::Si,
        );
        let matcher = StructureMatcher::new().with_angle_tol(5.0);
        // (gamma, should_match)
        for (gamma, should_match) in [(93.0, true), (110.0, false)] {
            let s2 = make_single_site(
                Lattice::from_parameters(5.0, 5.0, 5.0, 90.0, 90.0, gamma),
                Element::Si,
            );
            assert_eq!(matcher.fit(&s1, &s2), should_match, "gamma={gamma}");
        }
    }

    #[test]
    fn test_fit_site_tolerance_strict() {
        // Use multi-atom structure where relative positions matter
        // Disable primitive_cell since BCC (2 atoms) reduces to primitive (1 atom),
        // which would make the displaced structure also 1 atom and they'd trivially match
        let s1 = make_bcc(Element::Fe, 5.0);
        // Displace second atom significantly (relative to first)
        let s2 = Structure::new(
            Lattice::cubic(5.0),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.8)], // z displaced by 0.3
        );

        let matcher_strict = StructureMatcher::new()
            .with_site_pos_tol(0.01)
            .with_primitive_cell(false);
        assert!(
            !matcher_strict.fit(&s1, &s2),
            "Large relative displacement should fail with strict site_pos_tol"
        );

        let matcher_lenient = StructureMatcher::new()
            .with_site_pos_tol(0.5)
            .with_primitive_cell(false);
        assert!(
            matcher_lenient.fit(&s1, &s2),
            "Large relative displacement should pass with lenient site_pos_tol"
        );
    }

    #[test]
    fn test_get_rms_dist_no_match() {
        // Completely different structures
        let s1 = make_simple_cubic(Element::Na, 5.0);
        let s2 = make_simple_cubic(Element::Cl, 5.0); // Different element

        let matcher = StructureMatcher::new();
        let result = matcher.get_rms_dist(&s1, &s2);
        assert!(
            result.is_none(),
            "Different compositions should return None for RMS"
        );
    }

    #[test]
    fn test_matcher_builder_chain() {
        let matcher = StructureMatcher::new()
            .with_latt_len_tol(0.1)
            .with_site_pos_tol(0.2)
            .with_angle_tol(3.0)
            .with_scale(true)
            .with_attempt_supercell(false)
            .with_comparator(ComparatorType::Element);

        assert!((matcher.latt_len_tol - 0.1).abs() < 1e-10);
        assert!((matcher.site_pos_tol - 0.2).abs() < 1e-10);
        assert!((matcher.angle_tol - 3.0).abs() < 1e-10);
        assert!(matcher.scale);
        assert!(!matcher.attempt_supercell);
    }

    #[test]
    fn test_group_edge_cases() {
        let matcher = StructureMatcher::new();
        // Empty input
        assert!(matcher.group(&[]).unwrap().is_empty());
        // Single structure
        let s = make_simple_cubic(Element::Fe, 5.0);
        let groups = matcher.group(&[s]).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[&0], vec![0]);
    }

    #[test]
    fn test_group_identical_structures() {
        let s = make_simple_cubic(Element::Fe, 5.0);
        let structures = vec![s.clone(), s.clone(), s.clone()];
        let matcher = StructureMatcher::new();
        let groups = matcher.group(&structures).unwrap();

        // All three should be in one group
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[&0].len(), 3);
    }

    #[test]
    fn test_group_different_compositions() {
        let structures = vec![
            make_simple_cubic(Element::Fe, 5.0),
            make_simple_cubic(Element::Cu, 5.0),
            make_simple_cubic(Element::Ni, 5.0),
        ];

        let matcher = StructureMatcher::new();
        let groups = matcher.group(&structures).unwrap();

        // Each should be its own group
        assert_eq!(
            groups.len(),
            3,
            "Different compositions should be in different groups"
        );
    }

    #[test]
    fn test_deduplicate_preserves_order() {
        let s1 = make_simple_cubic(Element::Fe, 5.0);
        let s2 = make_simple_cubic(Element::Cu, 5.0);

        // s1, s2, s1_copy, s2_copy
        let structures = vec![s1.clone(), s2.clone(), s1.clone(), s2.clone()];
        let matcher = StructureMatcher::new();
        let mapping = matcher.deduplicate(&structures).unwrap();

        // Index 0 -> 0 (first Fe)
        // Index 1 -> 1 (first Cu)
        // Index 2 -> 0 (maps to first Fe)
        // Index 3 -> 1 (maps to first Cu)
        assert_eq!(mapping[0], 0);
        assert_eq!(mapping[1], 1);
        assert_eq!(mapping[2], 0);
        assert_eq!(mapping[3], 1);
    }

    #[test]
    fn test_fit_triclinic_structures() {
        let lattice = Lattice::from_parameters(3.0, 4.0, 5.0, 75.0, 85.0, 95.0);
        let s1 = Structure::new(
            lattice.clone(),
            vec![Species::neutral(Element::Ca), Species::neutral(Element::O)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        let s2 = s1.clone();

        let matcher = StructureMatcher::new();
        assert!(
            matcher.fit(&s1, &s2),
            "Identical triclinic structures should match"
        );
    }

    #[test]
    fn test_fit_hexagonal_structures() {
        let lattice = Lattice::hexagonal(3.0, 5.0);
        let s1 = Structure::new(
            lattice.clone(),
            vec![Species::neutral(Element::Ti), Species::neutral(Element::Ti)],
            vec![
                Vector3::new(1.0 / 3.0, 2.0 / 3.0, 0.25),
                Vector3::new(2.0 / 3.0, 1.0 / 3.0, 0.75),
            ],
        );
        let s2 = s1.clone();

        let matcher = StructureMatcher::new();
        assert!(
            matcher.fit(&s1, &s2),
            "Identical hexagonal structures should match"
        );
    }

    #[test]
    fn test_fit_anonymous_identical() {
        let s = make_nacl();
        let matcher = StructureMatcher::new();
        assert!(matcher.fit_anonymous(&s, &s));
    }

    #[test]
    fn test_fit_anonymous_swapped_species() {
        // NaCl with swapped species order should match
        let nacl = make_nacl();
        let clna = Structure::new(
            Lattice::cubic(5.64),
            vec![Species::neutral(Element::Cl), Species::neutral(Element::Na)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert!(StructureMatcher::new().fit_anonymous(&nacl, &clna));
    }

    #[test]
    fn test_fit_anonymous_same_prototype() {
        // NaCl and MgO have the same rocksalt prototype
        let nacl = make_nacl();
        let mgo = Structure::new(
            Lattice::cubic(4.21),
            vec![Species::neutral(Element::Mg), Species::neutral(Element::O)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        assert!(StructureMatcher::new().fit_anonymous(&nacl, &mgo));
    }

    #[test]
    fn test_fit_anonymous_different_stoichiometry() {
        // AB vs A2B3 stoichiometry should not match
        let nacl = make_nacl();
        let a2b3 = Structure::new(
            Lattice::cubic(5.0),
            vec![
                Species::neutral(Element::Fe),
                Species::neutral(Element::Fe),
                Species::neutral(Element::O),
                Species::neutral(Element::O),
                Species::neutral(Element::O),
            ],
            vec![
                Vector3::new(0.0, 0.0, 0.0),
                Vector3::new(0.5, 0.5, 0.5),
                Vector3::new(0.25, 0.25, 0.25),
                Vector3::new(0.75, 0.75, 0.75),
                Vector3::new(0.25, 0.75, 0.25),
            ],
        );
        assert!(!StructureMatcher::new().fit_anonymous(&nacl, &a2b3));
    }

    #[test]
    fn test_fit_anonymous_single_element() {
        let fe = make_simple_cubic(Element::Fe, 4.0);
        let cu = make_simple_cubic(Element::Cu, 4.0);
        let matcher = StructureMatcher::new();
        assert!(matcher.fit_anonymous(&fe, &cu));
    }

    #[test]
    fn test_fit_anonymous_different_num_elements() {
        let nacl = make_nacl();
        let fe = make_simple_cubic(Element::Fe, 4.0);
        let matcher = StructureMatcher::new();
        assert!(!matcher.fit_anonymous(&nacl, &fe));
    }

    #[test]
    fn test_empty_structures() {
        let lattice = Lattice::cubic(4.0);
        let s1 = Structure::new(lattice.clone(), vec![], vec![]);
        let s2 = Structure::new(lattice, vec![], vec![]);

        let matcher = StructureMatcher::new();
        // Empty structures don't match (early exit when n_sites == 0)
        assert!(!matcher.fit(&s1, &s2));
    }

    #[test]
    fn test_single_site_structure() {
        let s1 = make_simple_cubic(Element::Cu, 4.0);
        let s2 = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Cu)],
            vec![Vector3::new(0.01, 0.01, 0.01)], // slightly shifted
        );

        let matcher = StructureMatcher::new();
        assert!(matcher.fit(&s1, &s2));
    }

    #[test]
    fn test_fit_with_primitive_cell_option() {
        // Two conventional FCC cells at slightly different scales
        let fcc_conv1 = make_fcc_conventional(Element::Cu, 3.6);
        let fcc_conv2 = make_fcc_conventional(Element::Cu, 3.65); // 1.4% larger

        // Without primitive_cell, both have 4 atoms so they can match (with scale=true)
        let matcher_no_prim = StructureMatcher::new().with_primitive_cell(false);
        assert!(
            matcher_no_prim.fit(&fcc_conv1, &fcc_conv2),
            "Same FCC at different scales should match with scale=true"
        );

        // With primitive_cell=true (default), reduction happens first then matching
        let matcher_with_prim = StructureMatcher::new().with_primitive_cell(true);
        assert!(
            matcher_with_prim.fit(&fcc_conv1, &fcc_conv2),
            "Same FCC at different scales should match with primitive_cell=true"
        );

        // Verify that primitive_cell=true reduces site count
        // (implicitly tested by the get_primitive tests in structure.rs)

        // Same structure should always match
        assert!(
            matcher_no_prim.fit(&fcc_conv1, &fcc_conv1),
            "Same structure should match"
        );
    }

    #[test]
    fn test_primitive_cell_reduces_conventional_to_primitive() {
        // Create FCC conventional (4 atoms) and get its moyo-produced primitive (1 atom)
        let fcc_conv = make_fcc_conventional(Element::Cu, 3.6);
        let fcc_prim = fcc_conv.get_primitive(1e-4).unwrap();

        assert_eq!(fcc_conv.num_sites(), 4);
        assert_eq!(fcc_prim.num_sites(), 1);

        // Without primitive_cell, different site counts means no match
        let matcher_no_prim = StructureMatcher::new().with_primitive_cell(false);
        assert!(
            !matcher_no_prim.fit(&fcc_conv, &fcc_prim),
            "4 sites vs 1 site should not match without primitive_cell"
        );

        // With primitive_cell=true, conventional reduces to primitive and should match
        let matcher_with_prim = StructureMatcher::new().with_primitive_cell(true);
        assert!(
            matcher_with_prim.fit(&fcc_conv, &fcc_prim),
            "FCC conventional and its primitive should match with primitive_cell=true"
        );
    }

    #[test]
    fn test_on_error_behavior() {
        // Test that on_error setting is stored correctly
        let matcher_fail = StructureMatcher::new().with_on_error(crate::error::OnError::Fail);
        assert!(matcher_fail.on_error.should_fail());

        let matcher_skip = StructureMatcher::new().with_on_error(crate::error::OnError::Skip);
        assert!(!matcher_skip.on_error.should_fail());
    }

    #[test]
    fn test_comparator_type_element() {
        // Test that element comparator ignores oxidation states
        // Use primitive_cell=false to preserve oxidation states (moyo strips them)
        let s1 = Structure::new(
            Lattice::cubic(5.64),
            vec![
                Species::new(Element::Fe, Some(2)),
                Species::new(Element::O, Some(-2)),
            ],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        let s2 = Structure::new(
            Lattice::cubic(5.64),
            vec![
                Species::new(Element::Fe, Some(3)), // different oxidation state
                Species::new(Element::O, Some(-2)),
            ],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        // Species comparator should NOT match (different oxidation states)
        // Use primitive_cell=false since moyo's primitive reduction loses oxidation states
        let matcher_species = StructureMatcher::new()
            .with_comparator(ComparatorType::Species)
            .with_primitive_cell(false);
        assert!(!matcher_species.fit(&s1, &s2));

        // Element comparator should match (same elements)
        let matcher_element = StructureMatcher::new()
            .with_comparator(ComparatorType::Element)
            .with_primitive_cell(false);
        assert!(matcher_element.fit(&s1, &s2));
    }

    #[test]
    fn test_large_perturbation_no_match() {
        let s1 = make_nacl();
        let s2 = Structure::new(
            Lattice::cubic(5.64),
            vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)],
            vec![
                Vector3::new(0.3, 0.3, 0.3), // large shift
                Vector3::new(0.5, 0.5, 0.5),
            ],
        );

        let matcher = StructureMatcher::new().with_site_pos_tol(0.1);
        assert!(
            !matcher.fit(&s1, &s2),
            "Large perturbation should not match"
        );
    }

    // =========================================================================
    // Degenerate lattice tests
    // =========================================================================

    #[test]
    fn test_fit_degenerate_lattice_zero_volume() {
        // Coplanar vectors - zero volume (degenerate)
        let lattice = Lattice::new(Matrix3::new(
            1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, // third vector in same plane
        ));
        let s = Structure::new(
            lattice,
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::zeros()],
        );
        let matcher = StructureMatcher::new();

        // Should return false gracefully (not panic) for degenerate lattice
        assert!(
            !matcher.fit(&s, &s),
            "Degenerate lattice (zero volume) should return false"
        );
    }

    #[test]
    fn test_fit_near_degenerate_lattice() {
        // Very flat lattice (small c parameter)
        let lattice = Lattice::from_parameters(5.0, 5.0, 0.1, 90.0, 90.0, 90.0);
        let s = Structure::new(
            lattice,
            vec![Species::neutral(Element::C)],
            vec![Vector3::zeros()],
        );
        let matcher = StructureMatcher::new().with_primitive_cell(false);

        // Should handle gracefully without panicking (returns false for pathological lattice)
        let _ = matcher.fit(&s, &s);
    }

    // =========================================================================
    // fit_preprocessed() direct tests
    // =========================================================================

    #[test]
    fn test_fit_preprocessed_skips_reduction() {
        let s1 = make_fcc_conventional(Element::Cu, 3.6);
        let s2 = make_fcc_conventional(Element::Cu, 3.65);
        let matcher = StructureMatcher::new();

        // Manually reduce
        let r1 = matcher.reduce_structure(&s1);
        let r2 = matcher.reduce_structure(&s2);

        // fit_preprocessed should work on already-reduced structures
        assert!(
            matcher.fit_preprocessed(&r1, &r2),
            "Preprocessed FCC structures should match"
        );
    }

    #[test]
    fn test_reduce_structure_produces_niggli_cell() {
        let fcc = make_fcc_conventional(Element::Cu, 3.6);
        let matcher = StructureMatcher::new();
        let reduced = matcher.reduce_structure(&fcc);

        // Reduced cell should have fewer or equal sites (FCC -> primitive)
        assert!(
            reduced.num_sites() <= fcc.num_sites(),
            "Reduced structure should have <= sites"
        );
        // Volume should be preserved or reduced by integer factor
        let vol_ratio = fcc.lattice.volume() / reduced.lattice.volume();
        assert!(
            (vol_ratio.round() - vol_ratio).abs() < 0.01,
            "Volume ratio should be close to integer: {vol_ratio}"
        );
    }

    #[test]
    fn test_reduce_structure_idempotent() {
        let s = make_bcc(Element::Fe, 2.87);
        let matcher = StructureMatcher::new();
        let r1 = matcher.reduce_structure(&s);
        let r2 = matcher.reduce_structure(&r1);

        // Reducing twice should give same result
        assert_eq!(
            r1.num_sites(),
            r2.num_sites(),
            "Reducing twice should preserve site count"
        );
        assert!(
            (r1.lattice.volume() - r2.lattice.volume()).abs() < 1e-6,
            "Reducing twice should preserve volume"
        );
    }

    // =========================================================================
    // Extreme tolerance tests
    // =========================================================================

    #[test]
    fn test_fit_very_small_site_tolerance_strict() {
        // Use multi-atom structure (BCC) so relative positions matter
        let s1 = make_bcc(Element::Fe, 4.0);
        // Create perturbed structure with significant relative shift
        let s2 = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.7)], // shifted from 0.5
        );
        let matcher = StructureMatcher::new()
            .with_site_pos_tol(0.01)
            .with_primitive_cell(false); // keep multi-atom structure

        // Small tolerance should reject significant perturbation
        assert!(
            !matcher.fit(&s1, &s2),
            "Small tolerance should reject perturbation"
        );
        // Identical should still match
        assert!(
            matcher.fit(&s1, &s1),
            "Identical structures should match with small tolerance"
        );
    }

    #[test]
    fn test_fit_very_large_tolerance_permissive() {
        let s1 = make_simple_cubic(Element::Fe, 4.0);
        let s2 = make_simple_cubic(Element::Fe, 6.0); // 50% larger

        let matcher = StructureMatcher::new()
            .with_site_pos_tol(1.0)
            .with_latt_len_tol(0.5)
            .with_scale(false); // Don't scale volumes

        // Very large tolerance might match very different structures - tests boundary behavior
        let _ = matcher.fit(&s1, &s2);
    }

    #[test]
    fn test_fit_zero_angle_tolerance() {
        let s1 = make_simple_cubic(Element::Fe, 4.0);
        let s2 = Structure::new(
            Lattice::from_parameters(4.0, 4.0, 4.0, 90.0, 90.0, 91.0), // 1° off
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::zeros()],
        );
        let matcher = StructureMatcher::new().with_angle_tol(0.0);

        // Zero angle tolerance should reject 1° deviation
        assert!(
            !matcher.fit(&s1, &s2),
            "Zero angle tolerance should reject 1° deviation"
        );
    }

    // =========================================================================
    // fit_anonymous() edge cases
    // =========================================================================

    #[test]
    fn test_fit_anonymous_many_elements_stress() {
        // 7 elements = 5040 permutations (moderate stress test)
        let lattice = Lattice::cubic(14.0);
        let elements = [
            Element::Li,
            Element::Na,
            Element::K,
            Element::Rb,
            Element::Cs,
            Element::Fr,
            Element::Be,
        ];
        let species: Vec<_> = elements.iter().map(|&e| Species::neutral(e)).collect();
        let coords: Vec<_> = (0..7)
            .map(|i| Vector3::new(i as f64 * 0.14, 0.0, 0.0))
            .collect();
        let s1 = Structure::new(lattice.clone(), species.clone(), coords.clone());

        // Same structure with elements reversed (permuted)
        let species2: Vec<_> = elements
            .iter()
            .rev()
            .map(|&e| Species::neutral(e))
            .collect();
        let s2 = Structure::new(lattice, species2, coords);

        let matcher = StructureMatcher::new().with_primitive_cell(false);
        // Should find a matching permutation within reasonable time
        assert!(
            matcher.fit_anonymous(&s1, &s2),
            "fit_anonymous should handle 7 elements (5040 permutations)"
        );
    }

    #[test]
    fn test_fit_anonymous_works_with_any_comparator() {
        // fit_anonymous should work regardless of matcher's comparator_type setting
        let s = make_simple_cubic(Element::Fe, 4.0);

        // Works with default Species comparator
        let matcher_species = StructureMatcher::new();
        assert!(matcher_species.fit_anonymous(&s, &s));

        // Works with Element comparator too
        let matcher_element = StructureMatcher::new().with_comparator(ComparatorType::Element);
        assert!(matcher_element.fit_anonymous(&s, &s));
    }

    #[test]
    fn test_fit_anonymous_ignores_oxidation_states() {
        // fit_anonymous should ignore oxidation states and match based on elements only
        // Use primitive_cell=false to preserve oxidation states through processing
        let s1 = Structure::new(
            Lattice::cubic(5.64),
            vec![
                Species::new(Element::Na, Some(1)),
                Species::new(Element::Cl, Some(-1)),
            ],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        let s2 = Structure::new(
            Lattice::cubic(5.64),
            vec![
                Species::new(Element::Mg, Some(2)), // Different oxidation state
                Species::new(Element::O, Some(-2)), // Different oxidation state
            ],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        // Should match anonymously (same rocksalt prototype)
        let matcher = StructureMatcher::new().with_primitive_cell(false);
        assert!(
            matcher.fit_anonymous(&s1, &s2),
            "fit_anonymous should ignore oxidation states and match NaCl with MgO"
        );
    }

    // =========================================================================
    // Pymatgen Edge Case Tests (ported from pymatgen test suite)
    // =========================================================================

    #[test]
    fn test_matching_edge_cases() {
        let matcher = StructureMatcher::new().with_primitive_cell(false);

        // Out-of-cell sites: 0.98 ≈ -0.02 (wrapped)
        let s1 = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::new(0.98, 0.0, 0.0)],
        );
        let s2 = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::new(-0.02, 0.0, 0.0)],
        );
        assert!(matcher.fit(&s1, &s2), "Wrapped coords should match");

        // Site shuffling: order shouldn't matter
        let s3 = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::O)],
            vec![Vector3::zeros(), Vector3::new(0.5, 0.5, 0.5)],
        );
        let s4 = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::O), Species::neutral(Element::Fe)],
            vec![Vector3::new(0.5, 0.5, 0.5), Vector3::zeros()],
        );
        assert!(matcher.fit(&s3, &s4), "Site order shouldn't matter");

        // Large translation should fail
        let s5 = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::zeros(), Vector3::new(0.5, 0.5, 0.5)],
        );
        let s6 = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)],
            vec![Vector3::zeros(), Vector3::new(0.9, 0.9, 0.7)],
        );
        assert!(
            !matcher.with_site_pos_tol(0.3).fit(&s5, &s6),
            "Large shift should fail"
        );
    }

    #[test]
    fn test_scaling_and_comparators() {
        // scale=false is more restrictive
        let s1 = make_simple_cubic(Element::Fe, 4.0);
        let s2 = make_simple_cubic(Element::Fe, 4.5);
        let fit_scale = StructureMatcher::new().fit(&s1, &s2);
        let fit_no_scale = StructureMatcher::new().with_scale(false).fit(&s1, &s2);
        assert!(!fit_no_scale || fit_scale, "no_scale more restrictive");

        // Element comparator ignores oxidation states
        let s3 = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::new(Element::Fe, Some(2))],
            vec![Vector3::zeros()],
        );
        let s4 = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::new(Element::Fe, Some(3))],
            vec![Vector3::zeros()],
        );
        let m_species = StructureMatcher::new().with_primitive_cell(false);
        let m_elem = m_species.clone().with_comparator(ComparatorType::Element);
        assert!(
            !m_species.fit(&s3, &s4),
            "Species comparator rejects diff oxi"
        );
        assert!(m_elem.fit(&s3, &s4), "Element comparator accepts same elem");
    }

    #[test]
    fn test_supercell_matching() {
        let s1 = make_simple_cubic(Element::Fe, 4.0);
        let coords: Vec<_> = (0..8)
            .map(|i| {
                Vector3::new(
                    (i & 1) as f64 * 0.5,
                    ((i >> 1) & 1) as f64 * 0.5,
                    ((i >> 2) & 1) as f64 * 0.5,
                )
            })
            .collect();
        let s2 = Structure::new(
            Lattice::cubic(8.0),
            vec![Species::neutral(Element::Fe); 8],
            coords,
        );

        assert!(
            !StructureMatcher::new()
                .with_primitive_cell(false)
                .fit(&s1, &s2)
        );
        assert!(
            StructureMatcher::new()
                .with_primitive_cell(true)
                .fit(&s1, &s2)
        );
    }

    #[test]
    fn test_rms_distance() {
        let s = make_simple_cubic(Element::Fe, 4.0);
        let matcher = StructureMatcher::new().with_primitive_cell(false);
        // Identical → RMS ≈ 0
        if let Some((rms, _)) = matcher.get_rms_dist(&s, &s) {
            assert!(rms < 1e-10);
        }
        // Small perturbation → small RMS
        let s2 = Structure::new(
            Lattice::cubic(4.0),
            vec![Species::neutral(Element::Fe)],
            vec![Vector3::new(0.01, 0.0, 0.0)],
        );
        if let Some((rms, _)) = matcher.with_site_pos_tol(0.5).get_rms_dist(&s, &s2) {
            assert!(rms < 0.1);
        }
    }

    #[test]
    fn test_composition_hash_respects_comparator_type() {
        // Create two structures: same elements, different oxidation states
        let fe2 = Species::new(Element::Fe, Some(2));
        let fe3 = Species::new(Element::Fe, Some(3));
        let o2 = Species::new(Element::O, Some(-2));

        // FeO with Fe2+
        let s1 = Structure::new(
            Lattice::cubic(4.0),
            vec![fe2, o2],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );
        // FeO with Fe3+
        let s2 = Structure::new(
            Lattice::cubic(4.0),
            vec![fe3, o2],
            vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)],
        );

        // Element comparator: same hash (oxidation states ignored)
        let elem_matcher = StructureMatcher::new().with_comparator(ComparatorType::Element);
        assert_eq!(
            elem_matcher.composition_hash(&s1),
            elem_matcher.composition_hash(&s2),
            "Element comparator should give same hash for same elements"
        );

        // Species comparator: different hash (oxidation states matter)
        let species_matcher = StructureMatcher::new().with_comparator(ComparatorType::Species);
        assert_ne!(
            species_matcher.composition_hash(&s1),
            species_matcher.composition_hash(&s2),
            "Species comparator should give different hash for different oxidation states"
        );
    }
}
