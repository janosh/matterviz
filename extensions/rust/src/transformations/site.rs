//! Site-level structure transformations.
//!
//! This module contains transformations that operate on specific sites:
//!
//! - `InsertSitesTransform`: Add new sites to a structure
//! - `RemoveSitesTransform`: Remove sites by index
//! - `ReplaceSiteSpeciesTransform`: Replace species at specific sites
//! - `TranslateSitesTransform`: Translate specific sites
//! - `RadialDistortionTransform`: Apply radial distortion around a site

use crate::error::{FerroxError, Result};
use crate::species::{SiteOccupancy, Species};
use crate::structure::Structure;
use crate::transformations::Transform;
use nalgebra::Vector3;
use std::collections::HashMap;

/// Insert new sites into a structure.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::InsertSitesTransform;
/// use ferrox::species::Species;
/// use ferrox::element::Element;
/// use nalgebra::Vector3;
///
/// // Insert a lithium atom at (0.25, 0.25, 0.25)
/// let transform = InsertSitesTransform::new(
///     vec![Species::neutral(Element::Li)],
///     vec![Vector3::new(0.25, 0.25, 0.25)],
///     true, // fractional coordinates
/// );
/// transform.apply(&mut structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct InsertSitesTransform {
    /// Species to insert at each site
    pub species: Vec<Species>,
    /// Coordinates of new sites
    pub coords: Vec<Vector3<f64>>,
    /// Whether coordinates are fractional (true) or Cartesian (false)
    pub fractional: bool,
}

impl InsertSitesTransform {
    /// Create a new insert sites transform.
    ///
    /// # Arguments
    ///
    /// * `species` - Species for each new site
    /// * `coords` - Coordinates of each new site
    /// * `fractional` - Whether coordinates are fractional or Cartesian
    ///
    /// # Panics
    ///
    /// Panics if the lengths of `species` and `coords` don't match.
    pub fn new(species: Vec<Species>, coords: Vec<Vector3<f64>>, fractional: bool) -> Self {
        assert_eq!(
            species.len(),
            coords.len(),
            "species and coords must have same length"
        );
        Self {
            species,
            coords,
            fractional,
        }
    }

    /// Insert a single site.
    pub fn single(species: Species, coord: Vector3<f64>, fractional: bool) -> Self {
        Self::new(vec![species], vec![coord], fractional)
    }
}

impl Transform for InsertSitesTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        // Validate lengths match (guards against mismatched public fields)
        if self.species.len() != self.coords.len() {
            return Err(FerroxError::InvalidStructure {
                index: 0,
                reason: format!(
                    "species and coords must have same length ({} vs {})",
                    self.species.len(),
                    self.coords.len()
                ),
            });
        }

        for (species, coord) in self.species.iter().zip(self.coords.iter()) {
            let frac_coord = if self.fractional {
                *coord
            } else {
                structure.lattice.get_fractional_coord(coord)
            };
            structure
                .site_occupancies
                .push(SiteOccupancy::ordered(*species));
            structure.frac_coords.push(frac_coord);
        }
        Ok(())
    }
}

/// Remove sites by index.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::RemoveSitesTransform;
///
/// // Remove the first and third sites
/// let transform = RemoveSitesTransform::new(vec![0, 2]);
/// transform.apply(&mut structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct RemoveSitesTransform {
    /// Indices of sites to remove
    pub indices: Vec<usize>,
}

impl RemoveSitesTransform {
    /// Create a new remove sites transform.
    pub fn new(indices: Vec<usize>) -> Self {
        Self { indices }
    }

    /// Remove a single site.
    pub fn single(index: usize) -> Self {
        Self::new(vec![index])
    }
}

impl Transform for RemoveSitesTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        // Validate indices
        let n_sites = structure.num_sites();
        for &idx in &self.indices {
            if idx >= n_sites {
                return Err(FerroxError::InvalidStructure {
                    index: idx,
                    reason: format!("Site index {} out of bounds (num_sites={})", idx, n_sites),
                });
            }
        }

        // Create a set of indices to remove for O(1) lookup
        let remove_set: std::collections::HashSet<usize> = self.indices.iter().copied().collect();

        // Keep sites not in the removal set
        let (new_occupancies, new_coords): (Vec<_>, Vec<_>) = structure
            .site_occupancies
            .iter()
            .zip(structure.frac_coords.iter())
            .enumerate()
            .filter(|(idx, _)| !remove_set.contains(idx))
            .map(|(_, (occ, coord))| (occ.clone(), *coord))
            .unzip();

        structure.site_occupancies = new_occupancies;
        structure.frac_coords = new_coords;

        Ok(())
    }
}

/// Replace species at specific site indices.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::ReplaceSiteSpeciesTransform;
/// use ferrox::species::Species;
/// use ferrox::element::Element;
///
/// // Replace species at sites 0 and 2
/// let mut replacements = HashMap::new();
/// replacements.insert(0, Species::neutral(Element::Li));
/// replacements.insert(2, Species::neutral(Element::Na));
/// let transform = ReplaceSiteSpeciesTransform::new(replacements);
/// transform.apply(&mut structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct ReplaceSiteSpeciesTransform {
    /// Map from site index to new species
    pub replacements: HashMap<usize, Species>,
}

impl ReplaceSiteSpeciesTransform {
    /// Create a new replace site species transform.
    pub fn new(replacements: HashMap<usize, Species>) -> Self {
        Self { replacements }
    }

    /// Replace species at a single site.
    pub fn single(index: usize, species: Species) -> Self {
        let mut replacements = HashMap::new();
        replacements.insert(index, species);
        Self::new(replacements)
    }
}

impl Transform for ReplaceSiteSpeciesTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        let n_sites = structure.num_sites();

        for (&idx, &species) in &self.replacements {
            if idx >= n_sites {
                return Err(FerroxError::InvalidStructure {
                    index: idx,
                    reason: format!("Site index {} out of bounds (num_sites={})", idx, n_sites),
                });
            }
            structure.site_occupancies[idx] = SiteOccupancy::ordered(species);
        }

        Ok(())
    }
}

/// Translate specific sites by a vector.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::TranslateSitesTransform;
/// use nalgebra::Vector3;
///
/// // Translate sites 0 and 1 by 0.1 in fractional coordinates
/// let transform = TranslateSitesTransform::new(
///     vec![0, 1],
///     Vector3::new(0.1, 0.0, 0.0),
///     true, // fractional
/// );
/// transform.apply(&mut structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct TranslateSitesTransform {
    /// Indices of sites to translate
    pub indices: Vec<usize>,
    /// Translation vector
    pub vector: Vector3<f64>,
    /// Whether vector is in fractional (true) or Cartesian (false) coordinates
    pub fractional: bool,
}

impl TranslateSitesTransform {
    /// Create a new translate sites transform.
    pub fn new(indices: Vec<usize>, vector: Vector3<f64>, fractional: bool) -> Self {
        Self {
            indices,
            vector,
            fractional,
        }
    }

    /// Translate all sites.
    pub fn all_sites(n_sites: usize, vector: Vector3<f64>, fractional: bool) -> Self {
        Self::new((0..n_sites).collect(), vector, fractional)
    }
}

impl Transform for TranslateSitesTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        let n_sites = structure.num_sites();

        // Deduplicate indices to avoid translating the same site multiple times
        let mut unique_indices = self.indices.clone();
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
        let frac_vector = if self.fractional {
            self.vector
        } else {
            structure.lattice.get_fractional_coord(&self.vector)
        };

        // Apply translation
        for &idx in &unique_indices {
            structure.frac_coords[idx] += frac_vector;
        }

        Ok(())
    }
}

/// Apply radial distortion around a center site.
///
/// Displaces neighboring sites radially outward (positive displacement)
/// or inward (negative displacement) from a center site. Useful for
/// modeling defects and local relaxation effects.
///
/// # Example
///
/// ```rust,ignore
/// use ferrox::transformations::RadialDistortionTransform;
///
/// // Push neighbors 0.1 Å away from site 0, affecting only nearest neighbors
/// let transform = RadialDistortionTransform::new(0, 0.1, Some(3.0));
/// transform.apply(&mut structure)?;
/// ```
#[derive(Debug, Clone)]
pub struct RadialDistortionTransform {
    /// Index of the center site
    pub center_idx: usize,
    /// Radial displacement in Angstroms (positive = outward, negative = inward)
    pub displacement: f64,
    /// Cutoff radius in Angstroms (None = only nearest neighbors)
    pub cutoff: Option<f64>,
}

impl RadialDistortionTransform {
    /// Create a new radial distortion transform.
    pub fn new(center_idx: usize, displacement: f64, cutoff: Option<f64>) -> Self {
        Self {
            center_idx,
            displacement,
            cutoff,
        }
    }
}

impl Transform for RadialDistortionTransform {
    fn apply(&self, structure: &mut Structure) -> Result<()> {
        let n_sites = structure.num_sites();

        if self.center_idx >= n_sites {
            return Err(FerroxError::InvalidStructure {
                index: self.center_idx,
                reason: format!(
                    "Center site index {} out of bounds (num_sites={})",
                    self.center_idx, n_sites
                ),
            });
        }

        // Get the center position in Cartesian coordinates
        let center_frac = structure.frac_coords[self.center_idx];
        let center_cart = structure.lattice.get_cartesian_coord(&center_frac);

        // Determine cutoff (if None, find nearest neighbor distance)
        let cutoff = match self.cutoff {
            Some(r) => r,
            None => {
                // Find minimum non-zero distance to center
                let mut min_dist = f64::INFINITY;
                for (idx, _fc) in structure.frac_coords.iter().enumerate() {
                    if idx == self.center_idx {
                        continue;
                    }
                    let dist = structure.get_distance(self.center_idx, idx);
                    if dist > 1e-8 && dist < min_dist {
                        min_dist = dist;
                    }
                }
                // Add small tolerance to include nearest neighbors
                min_dist + 0.1
            }
        };

        // Apply radial displacement to sites within cutoff
        for (idx, fc) in structure.frac_coords.iter_mut().enumerate() {
            if idx == self.center_idx {
                continue;
            }

            let cart = structure.lattice.get_cartesian_coord(fc);
            let diff = cart - center_cart;
            let dist = diff.norm();

            if dist > 1e-8 && dist <= cutoff {
                // Compute unit radial vector
                let radial_unit = diff / dist;
                // Apply displacement
                let new_cart = cart + radial_unit * self.displacement;
                *fc = structure.lattice.get_fractional_coord(&new_cart);
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;
    use crate::lattice::Lattice;
    use approx::assert_relative_eq;
    use nalgebra::Matrix3;

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

    #[test]
    fn test_insert_sites() {
        let mut structure = nacl_structure();
        let original_n = structure.num_sites();

        let transform = InsertSitesTransform::single(
            Species::neutral(Element::Li),
            Vector3::new(0.25, 0.25, 0.25),
            true,
        );
        transform.apply(&mut structure).unwrap();

        assert_eq!(structure.num_sites(), original_n + 1);
        assert_eq!(
            structure
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
        let mut structure = nacl_structure();
        let a = structure.lattice.lengths()[0];

        // Insert at Cartesian (a/4, a/4, a/4)
        let transform = InsertSitesTransform::single(
            Species::neutral(Element::Li),
            Vector3::new(a / 4.0, a / 4.0, a / 4.0),
            false,
        );
        transform.apply(&mut structure).unwrap();

        // Should be at fractional (0.25, 0.25, 0.25)
        let fc = structure.frac_coords.last().unwrap();
        assert_relative_eq!(fc.x, 0.25, epsilon = 1e-10);
        assert_relative_eq!(fc.y, 0.25, epsilon = 1e-10);
        assert_relative_eq!(fc.z, 0.25, epsilon = 1e-10);
    }

    #[test]
    fn test_remove_sites() {
        let mut structure = nacl_structure();
        let transform = RemoveSitesTransform::single(0);
        transform.apply(&mut structure).unwrap();

        assert_eq!(structure.num_sites(), 1);
        assert_eq!(
            structure.site_occupancies[0].dominant_species().element,
            Element::Cl
        );
    }

    #[test]
    fn test_remove_sites_multiple() {
        let mut structure = nacl_structure();

        // Add some more sites first
        let insert = InsertSitesTransform::new(
            vec![Species::neutral(Element::Li), Species::neutral(Element::K)],
            vec![
                Vector3::new(0.25, 0.25, 0.25),
                Vector3::new(0.75, 0.75, 0.75),
            ],
            true,
        );
        insert.apply(&mut structure).unwrap();
        assert_eq!(structure.num_sites(), 4);

        // Remove first and third
        let remove = RemoveSitesTransform::new(vec![0, 2]);
        remove.apply(&mut structure).unwrap();

        assert_eq!(structure.num_sites(), 2);
    }

    #[test]
    fn test_remove_sites_invalid_index() {
        let mut structure = nacl_structure();
        let transform = RemoveSitesTransform::single(10);
        let result = transform.apply(&mut structure);
        assert!(result.is_err());
    }

    #[test]
    fn test_replace_site_species() {
        let mut structure = nacl_structure();
        let transform = ReplaceSiteSpeciesTransform::single(0, Species::neutral(Element::Li));
        transform.apply(&mut structure).unwrap();

        assert_eq!(
            structure.site_occupancies[0].dominant_species().element,
            Element::Li
        );
        // Cl should be unchanged
        assert_eq!(
            structure.site_occupancies[1].dominant_species().element,
            Element::Cl
        );
    }

    #[test]
    fn test_replace_site_species_multiple() {
        let mut structure = nacl_structure();
        let mut replacements = HashMap::new();
        replacements.insert(0, Species::neutral(Element::K));
        replacements.insert(1, Species::neutral(Element::Br));

        let transform = ReplaceSiteSpeciesTransform::new(replacements);
        transform.apply(&mut structure).unwrap();

        assert_eq!(
            structure.site_occupancies[0].dominant_species().element,
            Element::K
        );
        assert_eq!(
            structure.site_occupancies[1].dominant_species().element,
            Element::Br
        );
    }

    #[test]
    fn test_replace_site_species_invalid_index() {
        let mut structure = nacl_structure();
        let transform = ReplaceSiteSpeciesTransform::single(999, Species::neutral(Element::Li));
        let result = transform.apply(&mut structure);

        assert!(result.is_err());
    }

    #[test]
    fn test_translate_sites() {
        let mut structure = nacl_structure();
        let original_fc = structure.frac_coords[0];

        let transform = TranslateSitesTransform::new(vec![0], Vector3::new(0.1, 0.2, 0.3), true);
        transform.apply(&mut structure).unwrap();

        let new_fc = structure.frac_coords[0];
        assert_relative_eq!(new_fc.x, original_fc.x + 0.1, epsilon = 1e-10);
        assert_relative_eq!(new_fc.y, original_fc.y + 0.2, epsilon = 1e-10);
        assert_relative_eq!(new_fc.z, original_fc.z + 0.3, epsilon = 1e-10);
    }

    #[test]
    fn test_translate_sites_cartesian() {
        let mut structure = nacl_structure();
        let original_cart = structure
            .lattice
            .get_cartesian_coord(&structure.frac_coords[0]);

        // Translate by 1 Angstrom in each direction
        let transform = TranslateSitesTransform::new(vec![0], Vector3::new(1.0, 1.0, 1.0), false);
        transform.apply(&mut structure).unwrap();

        let new_cart = structure
            .lattice
            .get_cartesian_coord(&structure.frac_coords[0]);
        assert_relative_eq!(new_cart.x, original_cart.x + 1.0, epsilon = 1e-10);
        assert_relative_eq!(new_cart.y, original_cart.y + 1.0, epsilon = 1e-10);
        assert_relative_eq!(new_cart.z, original_cart.z + 1.0, epsilon = 1e-10);
    }

    #[test]
    fn test_translate_sites_multiple() {
        let mut structure = nacl_structure();
        let original_fc0 = structure.frac_coords[0];
        let original_fc1 = structure.frac_coords[1];

        let transform = TranslateSitesTransform::new(vec![0, 1], Vector3::new(0.1, 0.0, 0.0), true);
        transform.apply(&mut structure).unwrap();

        // Both sites should have moved
        assert_relative_eq!(
            structure.frac_coords[0].x,
            original_fc0.x + 0.1,
            epsilon = 1e-10
        );
        assert_relative_eq!(
            structure.frac_coords[1].x,
            original_fc1.x + 0.1,
            epsilon = 1e-10
        );
    }

    #[test]
    fn test_translate_sites_large_translation() {
        let mut structure = nacl_structure();

        // Translate by a large vector
        let transform = TranslateSitesTransform::new(vec![1], Vector3::new(0.6, 0.6, 0.6), true);
        transform.apply(&mut structure).unwrap();

        // Site was at (0.5, 0.5, 0.5), now at (1.1, 1.1, 1.1)
        // Note: wrap_to_unit_cell can be called separately if needed
        let fc = structure.frac_coords[1];
        assert_relative_eq!(fc.x, 1.1, epsilon = 1e-10);
        assert_relative_eq!(fc.y, 1.1, epsilon = 1e-10);
        assert_relative_eq!(fc.z, 1.1, epsilon = 1e-10);
    }

    #[test]
    fn test_translate_sites_with_wrap() {
        let mut structure = nacl_structure();

        // Translate beyond unit cell boundary
        let transform = TranslateSitesTransform::new(vec![1], Vector3::new(0.6, 0.6, 0.6), true);
        transform.apply(&mut structure).unwrap();

        // Now wrap to unit cell
        structure.wrap_to_unit_cell();

        // After wrapping, should be at (0.1, 0.1, 0.1)
        let fc = structure.frac_coords[1];
        assert_relative_eq!(fc.x, 0.1, epsilon = 1e-10);
        assert_relative_eq!(fc.y, 0.1, epsilon = 1e-10);
        assert_relative_eq!(fc.z, 0.1, epsilon = 1e-10);
    }

    #[test]
    fn test_radial_distortion() {
        let mut structure = nacl_structure();

        // Get positions before transform
        let fc_before = structure.frac_coords[1];

        // Push Cl away from Na by 0.1 Å
        let transform = RadialDistortionTransform::new(0, 0.1, Some(5.0));
        transform.apply(&mut structure).unwrap();

        // Get positions after transform
        let fc_after = structure.frac_coords[1];

        // The fractional coords should have changed
        assert_ne!(fc_before, fc_after, "Position should have changed");

        // The displacement should be outward (away from origin at (0,0,0))
        // For a site at (0.5, 0.5, 0.5), moving outward means coords increase
        // Since the displacement is 0.1 Å and the lattice is 5.64 Å,
        // the fractional change should be about 0.1/5.64 ~ 0.0177 along the diagonal
        let delta = fc_after - fc_before;
        assert!(
            delta.x > 0.0 && delta.y > 0.0 && delta.z > 0.0,
            "Displacement should be outward: delta = {:?}",
            delta
        );
    }

    #[test]
    fn test_radial_distortion_inward() {
        let mut structure = nacl_structure();
        let fc_before = structure.frac_coords[1];

        // Negative displacement = inward
        let transform = RadialDistortionTransform::new(0, -0.1, Some(5.0));
        transform.apply(&mut structure).unwrap();

        let fc_after = structure.frac_coords[1];
        let delta = fc_after - fc_before;

        // Should move inward (toward center)
        assert!(
            delta.x < 0.0 && delta.y < 0.0 && delta.z < 0.0,
            "Displacement should be inward: delta = {:?}",
            delta
        );
    }

    #[test]
    fn test_radial_distortion_cutoff_excludes() {
        let mut structure = nacl_structure();
        let fc_before = structure.frac_coords[1];

        // Very small cutoff should exclude the Cl atom (distance is ~4.88 Å)
        let transform = RadialDistortionTransform::new(0, 0.5, Some(1.0));
        transform.apply(&mut structure).unwrap();

        let fc_after = structure.frac_coords[1];

        // Position should be unchanged
        assert_relative_eq!(fc_before.x, fc_after.x, epsilon = 1e-10);
        assert_relative_eq!(fc_before.y, fc_after.y, epsilon = 1e-10);
        assert_relative_eq!(fc_before.z, fc_after.z, epsilon = 1e-10);
    }

    #[test]
    fn test_radial_distortion_invalid_center() {
        let mut structure = nacl_structure();
        let transform = RadialDistortionTransform::new(999, 0.1, Some(5.0));
        let result = transform.apply(&mut structure);

        assert!(result.is_err());
    }

    #[test]
    fn test_radial_distortion_auto_cutoff() {
        let mut structure = nacl_structure();
        let fc_before = structure.frac_coords[1];

        // None cutoff should auto-detect nearest neighbor distance
        let transform = RadialDistortionTransform::new(0, 0.1, None);
        transform.apply(&mut structure).unwrap();

        let fc_after = structure.frac_coords[1];

        // Should have moved
        assert_ne!(fc_before, fc_after);
    }

    // ========== Insert/Remove Sites Integration Tests ==========

    #[test]
    fn test_insert_then_remove() {
        let original = nacl_structure();
        let mut structure = original.clone();

        // Insert a Li atom
        let insert = InsertSitesTransform::single(
            Species::neutral(Element::Li),
            Vector3::new(0.25, 0.25, 0.25),
            true,
        );
        insert.apply(&mut structure).unwrap();
        assert_eq!(structure.num_sites(), 3);

        // Remove it
        let remove = RemoveSitesTransform::new(vec![2]); // Li is at index 2
        remove.apply(&mut structure).unwrap();
        assert_eq!(structure.num_sites(), 2);
    }

    #[test]
    fn test_remove_all_sites() {
        let mut structure = nacl_structure();
        let transform = RemoveSitesTransform::new(vec![0, 1]);
        transform.apply(&mut structure).unwrap();

        assert_eq!(structure.num_sites(), 0);
    }

    #[test]
    fn test_remove_sites_order_independent() {
        // Removing [0, 1] should give same result as [1, 0]
        let original = nacl_structure();

        let mut s1 = original.clone();
        RemoveSitesTransform::new(vec![0, 1])
            .apply(&mut s1)
            .unwrap();

        let mut s2 = original.clone();
        RemoveSitesTransform::new(vec![1, 0])
            .apply(&mut s2)
            .unwrap();

        assert_eq!(s1.num_sites(), s2.num_sites());
    }

    #[test]
    fn test_insert_sites_bulk() {
        let mut structure = nacl_structure();
        let original_sites = structure.num_sites();

        // Insert multiple sites at once
        let transform = InsertSitesTransform::new(
            vec![Species::neutral(Element::Li), Species::neutral(Element::Li)],
            vec![
                Vector3::new(0.25, 0.25, 0.25),
                Vector3::new(0.75, 0.75, 0.75),
            ],
            true,
        );
        transform.apply(&mut structure).unwrap();

        assert_eq!(structure.num_sites(), original_sites + 2);
    }

    // ========== Edge Cases ==========

    #[test]
    fn test_translate_empty_site_list() {
        let original = nacl_structure();
        let mut structure = original.clone();

        // Translating no sites should do nothing
        let transform = TranslateSitesTransform::new(vec![], Vector3::new(0.5, 0.5, 0.5), true);
        transform.apply(&mut structure).unwrap();

        // Should be unchanged
        for (orig, new) in original
            .frac_coords
            .iter()
            .zip(structure.frac_coords.iter())
        {
            assert_relative_eq!(orig.x, new.x, epsilon = 1e-10);
            assert_relative_eq!(orig.y, new.y, epsilon = 1e-10);
            assert_relative_eq!(orig.z, new.z, epsilon = 1e-10);
        }
    }

    #[test]
    fn test_radial_distortion_zero_displacement() {
        let original = nacl_structure();
        let mut structure = original.clone();

        let transform = RadialDistortionTransform::new(0, 0.0, Some(5.0));
        transform.apply(&mut structure).unwrap();

        // Should be unchanged
        for (orig, new) in original
            .frac_coords
            .iter()
            .zip(structure.frac_coords.iter())
        {
            assert_relative_eq!(orig.x, new.x, epsilon = 1e-10);
            assert_relative_eq!(orig.y, new.y, epsilon = 1e-10);
            assert_relative_eq!(orig.z, new.z, epsilon = 1e-10);
        }
    }
}
