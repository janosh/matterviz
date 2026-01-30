//! Coordination analysis for crystal structures.
//!
//! This module provides methods to calculate coordination numbers and analyze
//! local environments around atomic sites in crystal structures.
//!
//! # Coordination Number Methods
//!
//! - **Cutoff-based**: Count neighbors within a distance threshold
//! - **Voronoi-based**: Use solid angle weights from Voronoi tessellation
//!
//! # Limitations
//!
//! The Voronoi-based methods use a rectangular bounding box (via `meshless_voronoi`),
//! which is only geometrically correct for orthogonal lattices (cubic, tetragonal,
//! orthorhombic). For non-orthogonal cells (triclinic, monoclinic, rhombohedral),
//! the periodic boundary conditions will be incorrect, leading to wrong coordination
//! numbers. Use cutoff-based methods for non-orthogonal cells.
//!
//! # Examples
//!
//! ```rust,ignore
//! use ferrox::Structure;
//! use ferrox::coordination::{get_coordination_numbers, get_local_environment};
//!
//! let structure = Structure::from_json(json_str)?;
//!
//! // Cutoff-based coordination numbers
//! let cns = get_coordination_numbers(&structure, 3.0);
//!
//! // Local environment for site 0
//! let neighbors = get_local_environment(&structure, 0, 3.0);
//! for n in neighbors {
//!     println!("{} at {:.2} Å", n.element().symbol(), n.distance);
//! }
//! ```

use crate::element::Element;
use crate::species::Species;
use crate::structure::Structure;

// Tolerance for neighbor list distance comparisons
const NEIGHBOR_TOL: f64 = 1e-8;
// Tolerance for geometric comparisons (face area, distance)
const GEOM_TOL: f64 = 1e-10;

/// Information about a neighbor in the local environment of a site.
#[derive(Debug, Clone)]
pub struct LocalEnvNeighbor {
    /// The species at this neighbor site (element + optional oxidation state).
    pub species: Species,
    /// Distance from the central site in Angstroms.
    ///
    /// **Note**: For Voronoi-based methods, this is an approximation derived from
    /// face geometry (2× centroid distance). Use cutoff-based methods for exact distances.
    pub distance: f64,
    /// Periodic image offset [da, db, dc] in lattice vector units.
    pub image: [i32; 3],
    /// Index of the neighbor site in the structure.
    pub site_idx: usize,
    /// Solid angle fraction (only filled for Voronoi-based analysis).
    pub solid_angle: Option<f64>,
}

impl LocalEnvNeighbor {
    /// The chemical element at this neighbor site.
    pub fn element(&self) -> Element {
        self.species.element
    }
}

/// Helper to check site index bounds.
fn check_site_idx(structure: &Structure, site_idx: usize) {
    assert!(
        site_idx < structure.num_sites(),
        "site_idx {site_idx} out of bounds (num_sites={})",
        structure.num_sites()
    );
}

// ============================================================================
// Cutoff-Based Coordination Methods
// ============================================================================

/// Get coordination numbers for all sites using a distance cutoff.
///
/// Counts the number of neighbors within the specified cutoff distance for each site.
/// Uses periodic boundary conditions.
///
/// # Arguments
///
/// * `structure` - The crystal structure to analyze
/// * `cutoff` - Maximum distance (in Angstroms) to consider a site as a neighbor
///
/// # Returns
///
/// A vector of coordination numbers, one for each site in the structure.
///
/// # Example
///
/// ```rust,ignore
/// // FCC Cu has 12 nearest neighbors at ~2.55 Å
/// let cns = get_coordination_numbers(&fcc_cu, 3.0);
/// assert!(cns.iter().all(|&cn| cn == 12));
/// ```
pub fn get_coordination_numbers(structure: &Structure, cutoff: f64) -> Vec<usize> {
    if structure.num_sites() == 0 {
        return vec![];
    }
    if cutoff <= 0.0 {
        return vec![0; structure.num_sites()];
    }

    let (centers, _, _, _) = structure.get_neighbor_list(cutoff, NEIGHBOR_TOL, true);
    let mut counts = vec![0usize; structure.num_sites()];
    for center in centers {
        counts[center] += 1;
    }
    counts
}

/// Get coordination number for a single site using a distance cutoff.
///
/// # Panics
///
/// Panics if `site_idx` is out of bounds.
pub fn get_coordination_number(structure: &Structure, site_idx: usize, cutoff: f64) -> usize {
    check_site_idx(structure, site_idx);
    if cutoff <= 0.0 {
        return 0;
    }
    let (centers, _, _, _) = structure.get_neighbor_list(cutoff, NEIGHBOR_TOL, true);
    centers.iter().filter(|&&c| c == site_idx).count()
}

/// Get the local environment (detailed neighbor information) for a site.
///
/// Returns detailed information about each neighbor including species, distance,
/// and periodic image offset.
///
/// # Panics
///
/// Panics if `site_idx` is out of bounds.
pub fn get_local_environment(
    structure: &Structure,
    site_idx: usize,
    cutoff: f64,
) -> Vec<LocalEnvNeighbor> {
    check_site_idx(structure, site_idx);
    if cutoff <= 0.0 {
        return vec![];
    }

    let (centers, neighbors, images, distances) =
        structure.get_neighbor_list(cutoff, NEIGHBOR_TOL, true);

    let mut result: Vec<LocalEnvNeighbor> = centers
        .iter()
        .enumerate()
        .filter(|(_, center)| **center == site_idx)
        .map(|(idx, _)| {
            let neighbor_idx = neighbors[idx];
            let species = *structure.site_occupancies[neighbor_idx].dominant_species();
            LocalEnvNeighbor {
                species,
                distance: distances[idx],
                image: images[idx],
                site_idx: neighbor_idx,
                solid_angle: None,
            }
        })
        .collect();

    result.sort_by(|a, b| a.distance.total_cmp(&b.distance));
    result
}

/// Get neighbors for a site within cutoff as `(site_idx, distance, image)` tuples.
///
/// A simpler alternative to `get_local_environment` that returns only indices and distances.
pub fn get_neighbors(
    structure: &Structure,
    site_idx: usize,
    cutoff: f64,
) -> Vec<(usize, f64, [i32; 3])> {
    check_site_idx(structure, site_idx);
    if cutoff <= 0.0 {
        return vec![];
    }

    let (centers, neighbors, images, distances) =
        structure.get_neighbor_list(cutoff, NEIGHBOR_TOL, true);

    let mut result: Vec<_> = centers
        .iter()
        .enumerate()
        .filter(|(_, c)| **c == site_idx)
        .map(|(idx, _)| (neighbors[idx], distances[idx], images[idx]))
        .collect();

    result.sort_by(|a, b| a.1.total_cmp(&b.1));
    result
}

// ============================================================================
// Voronoi-Based Coordination Methods
// ============================================================================

use glam::DVec3;
use meshless_voronoi::{Dimensionality, Voronoi};

/// Configuration for Voronoi-based coordination analysis.
#[derive(Debug, Clone, Copy)]
pub struct VoronoiConfig {
    /// Minimum solid angle fraction to consider a neighbor (default: 0.01).
    pub min_solid_angle: f64,
}

impl Default for VoronoiConfig {
    fn default() -> Self {
        Self {
            min_solid_angle: 0.01,
        }
    }
}

impl VoronoiConfig {
    /// Validate config values are physically meaningful.
    ///
    /// # Panics
    ///
    /// Panics if `min_solid_angle` is negative or greater than 1.0.
    pub fn validate(&self) {
        assert!(
            (0.0..=1.0).contains(&self.min_solid_angle),
            "min_solid_angle must be in [0.0, 1.0], got {}",
            self.min_solid_angle
        );
    }
}

/// Get validated config, using default if None.
fn validated_config(config: Option<&VoronoiConfig>) -> VoronoiConfig {
    let cfg = config.copied().unwrap_or_default();
    cfg.validate();
    cfg
}

/// Check if a lattice is orthogonal (all angles ≈ 90°).
fn is_orthogonal(structure: &Structure) -> bool {
    const ANGLE_TOL: f64 = 1.0; // degrees
    let angles = structure.lattice.angles();
    (angles.x - 90.0).abs() < ANGLE_TOL
        && (angles.y - 90.0).abs() < ANGLE_TOL
        && (angles.z - 90.0).abs() < ANGLE_TOL
}

/// Build a Voronoi tessellation from a structure with periodic boundary conditions.
fn build_voronoi(structure: &Structure) -> Option<Voronoi> {
    if structure.num_sites() == 0 {
        return None;
    }

    // Warn about non-orthogonal lattices in debug builds
    #[cfg(debug_assertions)]
    if !is_orthogonal(structure) {
        eprintln!(
            "Warning: Voronoi coordination analysis on non-orthogonal lattice may be inaccurate. \
             Use cutoff-based methods for triclinic/monoclinic/rhombohedral cells."
        );
    }

    let cart_coords = structure.cart_coords();
    let positions: Vec<DVec3> = cart_coords
        .iter()
        .map(|v| DVec3::new(v.x, v.y, v.z))
        .collect();

    // Compute lattice vector lengths for box dimensions
    let matrix = structure.lattice.matrix();
    let width = DVec3::new(
        matrix.row(0).norm(),
        matrix.row(1).norm(),
        matrix.row(2).norm(),
    );

    Some(Voronoi::build(
        &positions,
        DVec3::ZERO,
        width,
        Dimensionality::ThreeD,
        true, // periodic
    ))
}

/// Helper to compute solid angle fraction from a face.
/// Returns (neighbor_idx, solid_angle_fraction, distance) or None if it's a boundary face.
fn compute_face_solid_angle(
    face: &meshless_voronoi::VoronoiFace,
    cell_idx: usize,
    cart_coords: &[nalgebra::Vector3<f64>],
    num_sites: usize,
) -> Option<(usize, f64, f64)> {
    // Determine if we're on the left or right side of this face
    let is_left = face.left() == cell_idx;

    // Get the neighbor index - right() returns None for boundary faces
    let neighbor_idx = if is_left { face.right()? } else { face.left() };

    // Handle periodic images: neighbor index might be >= num_sites
    let actual_neighbor_idx = neighbor_idx % num_sites;

    let face_area = face.area();
    if face_area < GEOM_TOL {
        return None;
    }

    // Compute distance using face centroid - this correctly handles periodic images
    // The centroid is in the geometric frame where the face exists
    let center_pos = &cart_coords[cell_idx];
    let face_centroid = face.centroid();
    let centroid_vec = nalgebra::Vector3::new(face_centroid.x, face_centroid.y, face_centroid.z);

    // Distance from cell center to face centroid, doubled to approximate neighbor distance
    // (face sits at midpoint between cell and neighbor in Voronoi tessellation)
    let dist_to_face = (centroid_vec - center_pos).norm();
    let dist = 2.0 * dist_to_face;
    let dist_sq = dist * dist;

    if dist_sq < GEOM_TOL {
        return None;
    }

    // Solid angle approximation: Ω ≈ A / r²
    // Solid angle fraction: Ω / (4π)
    let solid_angle_fraction = face_area / (4.0 * std::f64::consts::PI * dist_sq);

    Some((actual_neighbor_idx, solid_angle_fraction, dist))
}

/// Get Voronoi-weighted coordination number for a single site.
///
/// Counts Voronoi faces with solid angle fractions above the threshold.
///
/// # Panics
///
/// Panics if `site_idx` is out of bounds.
pub fn get_cn_voronoi(
    structure: &Structure,
    site_idx: usize,
    config: Option<&VoronoiConfig>,
) -> f64 {
    check_site_idx(structure, site_idx);
    let config = validated_config(config);
    let Some(voronoi) = build_voronoi(structure) else {
        return 0.0;
    };

    let cart_coords = structure.cart_coords();
    let num_sites = structure.num_sites();

    voronoi.cells()[site_idx]
        .faces(&voronoi)
        .filter_map(|face| compute_face_solid_angle(face, site_idx, &cart_coords, num_sites))
        .filter(|(_, solid_angle, _)| *solid_angle >= config.min_solid_angle)
        .count() as f64
}

/// Get Voronoi-weighted coordination numbers for all sites.
pub fn get_cn_voronoi_all(structure: &Structure, config: Option<&VoronoiConfig>) -> Vec<f64> {
    let config = validated_config(config);
    let Some(voronoi) = build_voronoi(structure) else {
        return vec![];
    };

    let cart_coords = structure.cart_coords();
    let num_sites = structure.num_sites();

    voronoi
        .cells()
        .iter()
        .enumerate()
        .map(|(site_idx, cell)| {
            cell.faces(&voronoi)
                .filter_map(|face| {
                    compute_face_solid_angle(face, site_idx, &cart_coords, num_sites)
                })
                .filter(|(_, solid_angle, _)| *solid_angle >= config.min_solid_angle)
                .count() as f64
        })
        .collect()
}

/// Get Voronoi neighbors with their solid angle fractions for a site.
///
/// Returns neighbors sorted by solid angle (largest first).
pub fn get_voronoi_neighbors(
    structure: &Structure,
    site_idx: usize,
    config: Option<&VoronoiConfig>,
) -> Vec<(usize, f64)> {
    check_site_idx(structure, site_idx);
    let config = validated_config(config);
    let Some(voronoi) = build_voronoi(structure) else {
        return vec![];
    };

    let cart_coords = structure.cart_coords();
    let num_sites = structure.num_sites();

    let mut neighbors: Vec<_> = voronoi.cells()[site_idx]
        .faces(&voronoi)
        .filter_map(|face| compute_face_solid_angle(face, site_idx, &cart_coords, num_sites))
        .filter(|(_, solid_angle, _)| *solid_angle >= config.min_solid_angle)
        .map(|(idx, solid_angle, _)| (idx, solid_angle))
        .collect();

    neighbors.sort_by(|a, b| b.1.total_cmp(&a.1));
    neighbors
}

/// Get local environment using Voronoi tessellation.
///
/// Uses Voronoi faces to determine neighbors instead of a distance cutoff.
/// Includes solid angle information.
pub fn get_local_environment_voronoi(
    structure: &Structure,
    site_idx: usize,
    config: Option<&VoronoiConfig>,
) -> Vec<LocalEnvNeighbor> {
    check_site_idx(structure, site_idx);
    let config = validated_config(config);
    let Some(voronoi) = build_voronoi(structure) else {
        return vec![];
    };

    let cart_coords = structure.cart_coords();
    let num_sites = structure.num_sites();

    let mut neighbors: Vec<LocalEnvNeighbor> = voronoi.cells()[site_idx]
        .faces(&voronoi)
        .filter_map(|face| compute_face_solid_angle(face, site_idx, &cart_coords, num_sites))
        .filter(|(_, solid_angle, _)| *solid_angle >= config.min_solid_angle)
        .map(|(neighbor_idx, solid_angle, distance)| {
            let species = *structure.site_occupancies[neighbor_idx].dominant_species();
            LocalEnvNeighbor {
                species,
                distance,
                image: [0, 0, 0], // Voronoi doesn't track periodic images
                site_idx: neighbor_idx,
                solid_angle: Some(solid_angle),
            }
        })
        .collect();

    // Sort by solid angle (largest first)
    neighbors.sort_by(|a, b| {
        let a_val = a.solid_angle.unwrap_or(0.0);
        let b_val = b.solid_angle.unwrap_or(0.0);
        b_val.total_cmp(&a_val)
    });
    neighbors
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lattice::Lattice;
    use nalgebra::Vector3;

    fn make_fcc(element: Element, a: f64) -> Structure {
        let lattice = Lattice::cubic(a);
        let species = vec![Species::neutral(element); 4];
        let frac_coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.0),
            Vector3::new(0.5, 0.0, 0.5),
            Vector3::new(0.0, 0.5, 0.5),
        ];
        Structure::new(lattice, species, frac_coords)
    }

    fn make_bcc(element: Element, a: f64) -> Structure {
        let lattice = Lattice::cubic(a);
        let species = vec![Species::neutral(element); 2];
        let frac_coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        Structure::new(lattice, species, frac_coords)
    }

    fn make_rocksalt(cation: Element, anion: Element, a: f64) -> Structure {
        let lattice = Lattice::cubic(a);
        let species = [
            vec![Species::neutral(cation); 4],
            vec![Species::neutral(anion); 4],
        ]
        .concat();
        let frac_coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.0),
            Vector3::new(0.5, 0.0, 0.5),
            Vector3::new(0.0, 0.5, 0.5),
            Vector3::new(0.5, 0.0, 0.0),
            Vector3::new(0.0, 0.5, 0.0),
            Vector3::new(0.0, 0.0, 0.5),
            Vector3::new(0.5, 0.5, 0.5),
        ];
        Structure::new(lattice, species, frac_coords)
    }

    // Helper to verify all CNs match expected value
    fn assert_all_cn(cns: &[usize], expected: usize) {
        assert!(
            cns.iter().all(|&cn| cn == expected),
            "Expected CN={expected}, got {cns:?}"
        );
    }

    #[test]
    fn test_coordination_numbers() {
        // FCC Cu: CN=12 with cutoff 3.0 Å
        let fcc = make_fcc(Element::Cu, 3.61);
        let cns = get_coordination_numbers(&fcc, 3.0);
        assert_eq!(cns.len(), 4);
        assert_all_cn(&cns, 12);

        // BCC Fe: CN=8 (first shell only at 2.6 Å), CN=14 (both shells at 3.0 Å)
        let bcc = make_bcc(Element::Fe, 2.87);
        assert_all_cn(&get_coordination_numbers(&bcc, 2.6), 8);
        assert_all_cn(&get_coordination_numbers(&bcc, 3.0), 14);

        // Rocksalt NaCl: CN=6
        let nacl = make_rocksalt(Element::Na, Element::Cl, 5.64);
        let cns = get_coordination_numbers(&nacl, 3.5);
        assert_eq!(cns.len(), 8);
        assert_all_cn(&cns, 6);
    }

    #[test]
    fn test_single_site_and_get_neighbors() {
        let fcc = make_fcc(Element::Cu, 3.61);
        assert_eq!(get_coordination_number(&fcc, 0, 3.0), 12);

        let bcc = make_bcc(Element::Fe, 2.87);
        let neighbors = get_neighbors(&bcc, 0, 2.6);
        assert_eq!(neighbors.len(), 8);
        assert!(neighbors.iter().all(|(_, d, _)| *d > 2.0 && *d < 2.7));
    }

    #[test]
    fn test_local_environment() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let neighbors = get_local_environment(&fcc, 0, 3.0);

        assert_eq!(neighbors.len(), 12);
        let expected_dist = 3.61 / 2.0_f64.sqrt();
        for n in &neighbors {
            assert_eq!(n.element(), Element::Cu);
            assert!((n.distance - expected_dist).abs() < 0.1);
        }

        // Verify sorted by distance
        let distances: Vec<f64> = neighbors.iter().map(|n| n.distance).collect();
        assert!(distances.windows(2).all(|w| w[0] <= w[1]));

        // Has periodic images
        assert!(neighbors.iter().any(|n| n.image != [0, 0, 0]));
    }

    #[test]
    fn test_rocksalt_element_types() {
        let nacl = make_rocksalt(Element::Na, Element::Cl, 5.64);

        // Na (site 0) neighbors are all Cl
        let na_neighbors = get_local_environment(&nacl, 0, 3.5);
        assert_eq!(na_neighbors.len(), 6);
        assert!(na_neighbors.iter().all(|n| n.element() == Element::Cl));

        // Cl (site 4) neighbors are all Na
        let cl_neighbors = get_local_environment(&nacl, 4, 3.5);
        assert_eq!(cl_neighbors.len(), 6);
        assert!(cl_neighbors.iter().all(|n| n.element() == Element::Na));

        // Voronoi should also correctly identify neighbor elements
        let na_voronoi = get_local_environment_voronoi(&nacl, 0, None);
        let cl_count = na_voronoi
            .iter()
            .filter(|n| n.element() == Element::Cl)
            .count();
        assert!(
            cl_count >= 5,
            "Na site should have mostly Cl neighbors via Voronoi, got {cl_count}"
        );
    }

    #[test]
    fn test_edge_cases() {
        let fcc = make_fcc(Element::Cu, 3.61);

        // Zero/negative cutoff both return zeros
        assert!(
            get_coordination_numbers(&fcc, 0.0)
                .iter()
                .all(|&cn| cn == 0)
        );
        assert!(
            get_coordination_numbers(&fcc, -1.0)
                .iter()
                .all(|&cn| cn == 0)
        );

        // Empty structure
        let empty = Structure::new(Lattice::cubic(5.0), vec![], vec![]);
        assert!(get_coordination_numbers(&empty, 3.0).is_empty());
    }

    #[test]
    fn test_voronoi_fcc() {
        let fcc = make_fcc(Element::Cu, 3.61);

        // All sites should have ~12 Voronoi neighbors
        let cns = get_cn_voronoi_all(&fcc, None);
        assert_eq!(cns.len(), 4);
        for cn in cns {
            assert!(
                (10.0..=14.0).contains(&cn),
                "FCC Voronoi CN={cn}, expected ~12"
            );
        }

        // Single site
        let cn = get_cn_voronoi(&fcc, 0, None);
        assert!(
            (10.0..=14.0).contains(&cn),
            "FCC Voronoi CN={cn}, expected ~12"
        );
    }

    #[test]
    fn test_voronoi_neighbors() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let neighbors = get_voronoi_neighbors(&fcc, 0, None);

        assert!(!neighbors.is_empty());
        // Valid solid angles, sorted descending
        let angles: Vec<f64> = neighbors.iter().map(|(_, sa)| *sa).collect();
        assert!(angles.iter().all(|&sa| (0.0..=1.0).contains(&sa)));
        assert!(angles.windows(2).all(|w| w[0] >= w[1]));
    }

    #[test]
    fn test_voronoi_local_environment() {
        let fcc = make_fcc(Element::Cu, 3.61);
        let neighbors = get_local_environment_voronoi(&fcc, 0, None);

        assert!(!neighbors.is_empty());
        for n in &neighbors {
            assert_eq!(n.element(), Element::Cu);
            assert!(n.solid_angle.is_some());
        }

        // min_solid_angle filter: higher threshold = fewer neighbors
        let low = get_voronoi_neighbors(
            &fcc,
            0,
            Some(&VoronoiConfig {
                min_solid_angle: 0.0,
            }),
        );
        let high = get_voronoi_neighbors(
            &fcc,
            0,
            Some(&VoronoiConfig {
                min_solid_angle: 0.5,
            }),
        );
        assert!(low.len() >= high.len());
    }

    #[test]
    fn test_simple_cubic_voronoi() {
        // Simple cubic: 1 atom, CN=6, all neighbors at lattice parameter distance
        let sc = Structure::new(
            Lattice::cubic(3.0),
            vec![Species::neutral(Element::Cu)],
            vec![Vector3::zeros()],
        );

        // CN = 6 (cube faces)
        assert_eq!(get_cn_voronoi(&sc, 0, None), 6.0);

        // Distance = lattice parameter
        let neighbors = get_local_environment_voronoi(&sc, 0, None);
        assert_eq!(neighbors.len(), 6);
        assert!(neighbors.iter().all(|n| (n.distance - 3.0).abs() < 0.1));

        // Boundary condition: >= includes exact matches
        let exact_angle = get_voronoi_neighbors(&sc, 0, None)[0].1;
        let cn = get_cn_voronoi(
            &sc,
            0,
            Some(&VoronoiConfig {
                min_solid_angle: exact_angle,
            }),
        );
        assert_eq!(cn, 6.0, ">= should include exact matches");
    }

    #[test]
    #[should_panic(expected = "out of bounds")]
    fn test_site_bounds_cutoff() {
        get_coordination_number(&make_fcc(Element::Cu, 3.61), 100, 3.0);
    }

    #[test]
    #[should_panic(expected = "out of bounds")]
    fn test_site_bounds_voronoi() {
        get_cn_voronoi(&make_fcc(Element::Cu, 3.61), 100, None);
    }
}
