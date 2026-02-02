//! Point defect generation for crystal structures.
//!
//! This module provides functionality for creating and analyzing point defects
//! in crystal structures, including vacancies, substitutions, interstitials,
//! and antisite pairs.

use crate::error::{FerroxError, Result, check_site_bounds, check_sites_different};
use crate::lattice::Lattice;
use crate::oxidation::{ChargeStateGuess, guess_defect_charge_states};
use crate::pbc::wrap_frac_coords;
use crate::species::{SiteOccupancy, Species};
use crate::structure::{Structure, WyckoffSite};
use nalgebra::Vector3;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

// === Defect Types ===

/// Type of point defect in a crystal structure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DefectType {
    /// Vacancy: missing atom at a lattice site.
    Vacancy,
    /// Interstitial: extra atom at a non-lattice position.
    Interstitial,
    /// Substitution: atom of different species at a lattice site.
    Substitution,
    /// Antisite: two atoms swapped between their normal sites.
    Antisite,
}

impl DefectType {
    /// Convert defect type to string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            DefectType::Vacancy => "vacancy",
            DefectType::Interstitial => "interstitial",
            DefectType::Substitution => "substitution",
            DefectType::Antisite => "antisite",
        }
    }
}

impl std::fmt::Display for DefectType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.as_str())
    }
}

/// A point defect in a crystal structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointDefect {
    /// Type of defect.
    pub defect_type: DefectType,
    /// Index of the defect site (for vacancy/substitution) or -1 for interstitial.
    pub site_idx: Option<usize>,
    /// Position of the defect in fractional coordinates.
    pub position: Vector3<f64>,
    /// Species at the defect site (new species for substitution/interstitial).
    pub species: Option<Species>,
    /// Original species before defect formation (for vacancy/substitution).
    pub original_species: Option<Species>,
    /// Charge state of the defect.
    pub charge: i32,
}

impl PointDefect {
    /// Create a new vacancy defect.
    pub fn vacancy(site_idx: usize, position: Vector3<f64>, original_species: Species) -> Self {
        Self {
            defect_type: DefectType::Vacancy,
            site_idx: Some(site_idx),
            position,
            species: None,
            original_species: Some(original_species),
            charge: 0,
        }
    }

    /// Create a new substitution defect.
    pub fn substitution(
        site_idx: usize,
        position: Vector3<f64>,
        new_species: Species,
        original_species: Species,
    ) -> Self {
        Self {
            defect_type: DefectType::Substitution,
            site_idx: Some(site_idx),
            position,
            species: Some(new_species),
            original_species: Some(original_species),
            charge: 0,
        }
    }

    /// Create a new interstitial defect.
    pub fn interstitial(position: Vector3<f64>, species: Species) -> Self {
        Self {
            defect_type: DefectType::Interstitial,
            site_idx: None,
            position,
            species: Some(species),
            original_species: None,
            charge: 0,
        }
    }

    /// Set the charge state of the defect.
    pub fn with_charge(mut self, charge: i32) -> Self {
        self.charge = charge;
        self
    }

    /// Generate a doped-compatible name for this point defect.
    ///
    /// Naming conventions:
    /// - Vacancy: `v_{element}` or `v_{element}_{wyckoff}` (e.g., "v_O", "v_O_4a")
    /// - Substitution: `{new}_on_{original}` (e.g., "Fe_on_Ni")
    /// - Interstitial: `{element}_i` or `{element}_i_{site_type}` (e.g., "Li_i", "Li_i_oct")
    /// - Antisite: `{A}_{B}` swap notation (e.g., "Fe_Ni" for Fe on Ni site)
    ///
    /// # Arguments
    ///
    /// * `wyckoff` - Optional Wyckoff label for the defect site (e.g., "4a", "8c")
    /// * `site_type` - Optional site type for interstitials (e.g., "oct", "tet")
    ///
    /// # Returns
    ///
    /// A string name following doped naming conventions.
    pub fn name(&self, wyckoff: Option<&str>, site_type: Option<&str>) -> String {
        match self.defect_type {
            DefectType::Vacancy => {
                let element = self
                    .original_species
                    .as_ref()
                    .map(|sp| sp.element.symbol())
                    .unwrap_or("X");
                match wyckoff {
                    Some(wyk) => format!("v_{element}_{wyk}"),
                    None => format!("v_{element}"),
                }
            }
            DefectType::Substitution => {
                let new_elem = self
                    .species
                    .as_ref()
                    .map(|sp| sp.element.symbol())
                    .unwrap_or("X");
                let orig_elem = self
                    .original_species
                    .as_ref()
                    .map(|sp| sp.element.symbol())
                    .unwrap_or("X");
                format!("{new_elem}_on_{orig_elem}")
            }
            DefectType::Interstitial => {
                let element = self
                    .species
                    .as_ref()
                    .map(|sp| sp.element.symbol())
                    .unwrap_or("X");
                match site_type {
                    Some(st) => format!("{element}_i_{st}"),
                    None => format!("{element}_i"),
                }
            }
            DefectType::Antisite => {
                // For antisite, species is the new one, original_species is what was there
                let new_elem = self
                    .species
                    .as_ref()
                    .map(|sp| sp.element.symbol())
                    .unwrap_or("X");
                let orig_elem = self
                    .original_species
                    .as_ref()
                    .map(|sp| sp.element.symbol())
                    .unwrap_or("X");
                format!("{new_elem}_{orig_elem}")
            }
        }
    }
}

/// Generate a doped-compatible name for a point defect.
///
/// This is a convenience function that calls `PointDefect::name()`.
/// See that method for full documentation on naming conventions.
///
/// # Arguments
///
/// * `defect` - The point defect to name
/// * `wyckoff` - Optional Wyckoff label for the defect site
/// * `site_type` - Optional site type for interstitials (e.g., "oct", "tet")
///
/// # Returns
///
/// A string name following doped naming conventions.
pub fn generate_defect_name(
    defect: &PointDefect,
    wyckoff: Option<&str>,
    site_type: Option<&str>,
) -> String {
    defect.name(wyckoff, site_type)
}

/// Result of creating a defect structure.
#[derive(Debug, Clone)]
pub struct DefectStructure {
    /// The defective structure.
    pub structure: Structure,
    /// Information about the defect.
    pub defect: PointDefect,
}

// === Defect Creation Functions ===

/// Create a vacancy by removing an atom at the specified site index.
///
/// # Arguments
///
/// * `structure` - The original structure.
/// * `site_idx` - Index of the site to remove.
///
/// # Returns
///
/// A `DefectStructure` containing the structure with the vacancy and defect info.
///
/// # Errors
///
/// Returns an error if the site index is out of bounds.
pub fn create_vacancy(structure: &Structure, site_idx: usize) -> Result<DefectStructure> {
    check_site_bounds(site_idx, structure.num_sites(), "site_idx")?;

    // Get the original species and position before removal
    let original_species = *structure.site_occupancies[site_idx].dominant_species();
    let position = structure.frac_coords[site_idx];

    // Create new structure without the site
    let new_structure = structure.remove_sites(&[site_idx])?;

    let defect = PointDefect::vacancy(site_idx, position, original_species);

    Ok(DefectStructure {
        structure: new_structure,
        defect,
    })
}

/// Create a substitutional defect by replacing the species at a site.
///
/// # Arguments
///
/// * `structure` - The original structure.
/// * `site_idx` - Index of the site to substitute.
/// * `new_species` - The species to place at the site.
///
/// # Returns
///
/// A `DefectStructure` containing the structure with the substitution.
///
/// # Errors
///
/// Returns an error if the site index is out of bounds.
pub fn create_substitution(
    structure: &Structure,
    site_idx: usize,
    new_species: Species,
) -> Result<DefectStructure> {
    check_site_bounds(site_idx, structure.num_sites(), "site_idx")?;

    // Get the original species and position
    let original_species = *structure.site_occupancies[site_idx].dominant_species();
    let position = structure.frac_coords[site_idx];

    // Create new site occupancies with the substituted species
    let mut new_occupancies = structure.site_occupancies.clone();
    new_occupancies[site_idx] = SiteOccupancy::ordered(new_species);

    let new_structure = Structure::try_new_from_occupancies(
        structure.lattice.clone(),
        new_occupancies,
        structure.frac_coords.clone(),
    )?;

    let defect = PointDefect::substitution(site_idx, position, new_species, original_species);

    Ok(DefectStructure {
        structure: new_structure,
        defect,
    })
}

/// Create an antisite pair by swapping species at two sites.
///
/// # Arguments
///
/// * `structure` - The original structure.
/// * `site_a_idx` - Index of the first site.
/// * `site_b_idx` - Index of the second site.
///
/// # Returns
///
/// The structure with swapped species at the two sites.
///
/// # Errors
///
/// Returns an error if either site index is out of bounds or if the sites have
/// the same species (no antisite possible).
pub fn create_antisite_pair(
    structure: &Structure,
    site_a_idx: usize,
    site_b_idx: usize,
) -> Result<Structure> {
    let num_sites = structure.num_sites();
    check_site_bounds(site_a_idx, num_sites, "site_a_idx")?;
    check_site_bounds(site_b_idx, num_sites, "site_b_idx")?;
    check_sites_different(site_a_idx, site_b_idx)?;

    // Check that sites have different species (otherwise antisite is meaningless)
    let occ_a = &structure.site_occupancies[site_a_idx];
    let occ_b = &structure.site_occupancies[site_b_idx];
    if occ_a == occ_b {
        return Err(FerroxError::InvalidStructure {
            index: site_a_idx,
            reason: format!(
                "sites {} and {} have identical species, cannot create antisite",
                site_a_idx, site_b_idx
            ),
        });
    }

    // Swap site occupancies
    let mut new_occupancies = structure.site_occupancies.clone();
    new_occupancies.swap(site_a_idx, site_b_idx);

    Structure::try_new_from_occupancies(
        structure.lattice.clone(),
        new_occupancies,
        structure.frac_coords.clone(),
    )
}

/// Create an interstitial by adding an atom at a fractional position.
///
/// # Arguments
///
/// * `structure` - The original structure.
/// * `position` - Fractional coordinates for the interstitial.
/// * `species` - The species to add.
///
/// # Returns
///
/// A `DefectStructure` containing the structure with the interstitial.
pub fn create_interstitial(
    structure: &Structure,
    position: Vector3<f64>,
    species: Species,
) -> Result<DefectStructure> {
    // Append new site to the structure, wrapping coords to [0,1) for normalization
    let wrapped_position = wrap_frac_coords(&position);
    let mut new_occupancies = structure.site_occupancies.clone();
    let mut new_coords = structure.frac_coords.clone();

    new_occupancies.push(SiteOccupancy::ordered(species));
    new_coords.push(wrapped_position);

    let new_structure = Structure::try_new_from_occupancies(
        structure.lattice.clone(),
        new_occupancies,
        new_coords,
    )?;

    let defect = PointDefect::interstitial(wrapped_position, species);

    Ok(DefectStructure {
        structure: new_structure,
        defect,
    })
}

// === Interstitial Site Finding ===

/// Classification of interstitial site geometry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InterstitialSiteType {
    /// Trigonal site (3 neighbors).
    Trigonal,
    /// Tetrahedral site (4 neighbors).
    Tetrahedral,
    /// Square pyramidal site (5 neighbors).
    SquarePyramidal,
    /// Octahedral site (6 neighbors).
    Octahedral,
    /// Cubic site (8 neighbors).
    Cubic,
    /// Cuboctahedral site (12 neighbors).
    Cuboctahedral,
    /// Other coordination environment.
    Other,
}

impl InterstitialSiteType {
    /// Convert to string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            InterstitialSiteType::Trigonal => "trigonal",
            InterstitialSiteType::Tetrahedral => "tetrahedral",
            InterstitialSiteType::SquarePyramidal => "square_pyramidal",
            InterstitialSiteType::Octahedral => "octahedral",
            InterstitialSiteType::Cubic => "cubic",
            InterstitialSiteType::Cuboctahedral => "cuboctahedral",
            InterstitialSiteType::Other => "other",
        }
    }
}

impl std::fmt::Display for InterstitialSiteType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.as_str())
    }
}

/// Classify an interstitial site based on its coordination number.
///
/// # Arguments
///
/// * `coordination` - The coordination number of the site.
///
/// # Returns
///
/// The classified site type.
pub fn classify_interstitial_site(coordination: usize) -> InterstitialSiteType {
    match coordination {
        3 => InterstitialSiteType::Trigonal,
        4 => InterstitialSiteType::Tetrahedral,
        5 => InterstitialSiteType::SquarePyramidal,
        6 => InterstitialSiteType::Octahedral,
        8 => InterstitialSiteType::Cubic,
        12 => InterstitialSiteType::Cuboctahedral,
        _ => InterstitialSiteType::Other,
    }
}

// === Voronoi-Based Interstitial Site Finding ===

use glam::DVec3;
use meshless_voronoi::{Dimensionality, VoronoiIntegrator};

/// Enhanced interstitial site information from Voronoi analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoronoiInterstitial {
    /// Position in fractional coordinates.
    pub frac_coords: Vector3<f64>,
    /// Position in Cartesian coordinates.
    pub cart_coords: Vector3<f64>,
    /// Distance to the nearest atom.
    pub min_distance: f64,
    /// Number of nearest neighbors (vertices of Voronoi cell).
    pub coordination: usize,
    /// Classification of the site geometry.
    pub site_type: InterstitialSiteType,
    /// Wyckoff label if symmetry analysis was performed.
    pub wyckoff_label: Option<String>,
    /// Number of symmetry-equivalent sites.
    pub multiplicity: usize,
}

/// Find interstitial sites using Voronoi tessellation.
///
/// This method identifies potential interstitial positions as vertices
/// of the Voronoi tessellation of the atomic positions. Sites are filtered
/// by minimum distance and optionally reduced by symmetry.
///
/// # Arguments
///
/// * `structure` - The structure to analyze
/// * `min_dist` - Minimum distance to nearest atom (default: 0.5 Å if None)
/// * `symprec` - Symmetry precision for equivalent site detection
///
/// # Returns
///
/// Vector of `VoronoiInterstitial` sites, sorted by decreasing min_distance.
///
/// # Note
///
/// For non-orthogonal lattices, accuracy may be reduced due to the rectangular
/// bounding box used by the Voronoi algorithm.
pub fn find_voronoi_interstitials(
    structure: &Structure,
    min_dist: Option<f64>,
    symprec: f64,
) -> Vec<VoronoiInterstitial> {
    // Handle empty structure
    if structure.num_sites() == 0 {
        return Vec::new();
    }

    let lattice = &structure.lattice;
    let num_sites = structure.num_sites();

    // Default minimum distance
    let min_distance_threshold = min_dist.unwrap_or(0.5);

    // Build 3x3x3 supercell positions to handle PBC correctly
    // The Voronoi algorithm uses a rectangular box, so we need to ensure
    // periodic images are included
    let mut supercell_positions: Vec<DVec3> = Vec::with_capacity(num_sites * 27);
    let mut original_cart_coords: Vec<Vector3<f64>> = Vec::with_capacity(num_sites);

    for frac in &structure.frac_coords {
        let cart = lattice.get_cartesian_coord(frac);
        original_cart_coords.push(cart);

        // Add 3x3x3 periodic images
        for img_a in -1..=1_i32 {
            for img_b in -1..=1_i32 {
                for img_c in -1..=1_i32 {
                    let shift = lattice.get_cartesian_coord(&Vector3::new(
                        img_a as f64,
                        img_b as f64,
                        img_c as f64,
                    ));
                    let pos = cart + shift;
                    supercell_positions.push(DVec3::new(pos.x, pos.y, pos.z));
                }
            }
        }
    }

    // Compute bounding box for the supercell
    let matrix = lattice.matrix();
    let lattice_vectors: [Vector3<f64>; 3] = [
        matrix.row(0).transpose(),
        matrix.row(1).transpose(),
        matrix.row(2).transpose(),
    ];

    // Compute min/max extent of the 3x3x3 supercell
    let (anchor, width) = compute_supercell_bounds(&lattice_vectors);

    // Build Voronoi tessellation using VoronoiIntegrator to get vertices
    let voronoi_integrator = VoronoiIntegrator::build(
        &supercell_positions,
        None, // no mask - compute all cells
        anchor,
        width,
        Dimensionality::ThreeD,
        false, // not periodic - we handle PBC via supercell
    );

    // Convert to get face/vertex information
    let voronoi_with_faces = voronoi_integrator.with_faces();

    // Collect all unique vertices
    let mut unique_vertices: Vec<Vector3<f64>> = Vec::new();

    for cell in voronoi_with_faces.cells_iter() {
        for vertex in &cell.vertices {
            let pos = Vector3::new(vertex.loc.x, vertex.loc.y, vertex.loc.z);

            // Check if this vertex is inside or near the central unit cell
            let frac = lattice.get_fractional_coord(&pos);
            if !is_near_unit_cell(&frac, 0.1) {
                continue;
            }

            // Check if vertex is unique (not already in list)
            let is_duplicate = unique_vertices.iter().any(|existing| {
                let sep = find_min_separation(lattice, &pos, existing);
                sep < symprec
            });

            if !is_duplicate {
                unique_vertices.push(pos);
            }
        }
    }

    // Process each unique vertex to create interstitial sites
    let mut interstitials: Vec<VoronoiInterstitial> = Vec::new();

    for cart_pos in unique_vertices {
        // Calculate minimum distance to any atom
        let min_atom_dist = find_min_distance_to_atoms(lattice, &cart_pos, &original_cart_coords);

        // Filter by minimum distance threshold
        if min_atom_dist < min_distance_threshold {
            continue;
        }

        // Map to unit cell [0, 1)
        let frac = lattice.get_fractional_coord(&cart_pos);
        let wrapped_frac = wrap_frac_coords(&frac);
        let wrapped_cart = lattice.get_cartesian_coord(&wrapped_frac);

        // Check if this wrapped position is a duplicate
        let is_duplicate = interstitials.iter().any(|existing| {
            let sep = find_min_separation(lattice, &wrapped_cart, &existing.cart_coords);
            sep < symprec
        });

        if is_duplicate {
            continue;
        }

        // Count coordination (atoms at approximately the same distance)
        let coordination = count_neighbors_at_distance(
            lattice,
            &wrapped_cart,
            &original_cart_coords,
            min_atom_dist,
            0.3,
        );

        // Classify site type
        let site_type = classify_interstitial_site(coordination);

        interstitials.push(VoronoiInterstitial {
            frac_coords: wrapped_frac,
            cart_coords: wrapped_cart,
            min_distance: min_atom_dist,
            coordination,
            site_type,
            wyckoff_label: None, // To be filled by symmetry analysis
            multiplicity: 1,     // To be updated by symmetry reduction
        });
    }

    // Sort by min_distance (largest first - most spacious sites)
    interstitials.sort_by(|site_a, site_b| {
        site_b
            .min_distance
            .partial_cmp(&site_a.min_distance)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    interstitials
}

/// Compute bounding box for a 3x3x3 supercell.
fn compute_supercell_bounds(lattice_vectors: &[Vector3<f64>; 3]) -> (DVec3, DVec3) {
    let mut min_corner = Vector3::new(f64::MAX, f64::MAX, f64::MAX);
    let mut max_corner = Vector3::new(f64::MIN, f64::MIN, f64::MIN);

    // Check all 8 corners of the 3x3x3 supercell (from -1 to 2 in each direction)
    for corner_a in [-1, 2] {
        for corner_b in [-1, 2] {
            for corner_c in [-1, 2] {
                let corner = lattice_vectors[0] * corner_a as f64
                    + lattice_vectors[1] * corner_b as f64
                    + lattice_vectors[2] * corner_c as f64;
                min_corner.x = min_corner.x.min(corner.x);
                min_corner.y = min_corner.y.min(corner.y);
                min_corner.z = min_corner.z.min(corner.z);
                max_corner.x = max_corner.x.max(corner.x);
                max_corner.y = max_corner.y.max(corner.y);
                max_corner.z = max_corner.z.max(corner.z);
            }
        }
    }

    // Add small padding to avoid edge effects
    let padding = 0.1;
    let anchor = DVec3::new(
        min_corner.x - padding,
        min_corner.y - padding,
        min_corner.z - padding,
    );
    let width = DVec3::new(
        max_corner.x - min_corner.x + 2.0 * padding,
        max_corner.y - min_corner.y + 2.0 * padding,
        max_corner.z - min_corner.z + 2.0 * padding,
    );

    (anchor, width)
}

/// Check if fractional coordinates are near the unit cell [0, 1).
fn is_near_unit_cell(frac: &Vector3<f64>, tolerance: f64) -> bool {
    let lower = -tolerance;
    let upper = 1.0 + tolerance;
    frac.x >= lower
        && frac.x < upper
        && frac.y >= lower
        && frac.y < upper
        && frac.z >= lower
        && frac.z < upper
}

/// Find the minimum distance from a point to any atom, considering PBC.
fn find_min_distance_to_atoms(
    lattice: &Lattice,
    point: &Vector3<f64>,
    atom_coords: &[Vector3<f64>],
) -> f64 {
    let mut min_dist = f64::MAX;

    for atom in atom_coords {
        // Check distance considering periodic images
        for img_a in -1..=1_i32 {
            for img_b in -1..=1_i32 {
                for img_c in -1..=1_i32 {
                    let image_offset = lattice.get_cartesian_coord(&Vector3::new(
                        img_a as f64,
                        img_b as f64,
                        img_c as f64,
                    ));
                    let atom_image = atom + image_offset;
                    let dist = (point - atom_image).norm();
                    if dist < min_dist {
                        min_dist = dist;
                    }
                }
            }
        }
    }

    min_dist
}

/// Count neighbors at approximately the given distance.
fn count_neighbors_at_distance(
    lattice: &Lattice,
    point: &Vector3<f64>,
    atom_coords: &[Vector3<f64>],
    target_dist: f64,
    tolerance: f64,
) -> usize {
    let mut count = 0;

    for atom in atom_coords {
        for img_a in -1..=1_i32 {
            for img_b in -1..=1_i32 {
                for img_c in -1..=1_i32 {
                    let image_offset = lattice.get_cartesian_coord(&Vector3::new(
                        img_a as f64,
                        img_b as f64,
                        img_c as f64,
                    ));
                    let atom_image = atom + image_offset;
                    let dist = (point - atom_image).norm();
                    if (dist - target_dist).abs() < tolerance {
                        count += 1;
                    }
                }
            }
        }
    }

    count
}

/// Find minimum separation between two points considering PBC.
fn find_min_separation(lattice: &Lattice, point_a: &Vector3<f64>, point_b: &Vector3<f64>) -> f64 {
    let mut min_dist = f64::MAX;

    for img_a in -1..=1_i32 {
        for img_b in -1..=1_i32 {
            for img_c in -1..=1_i32 {
                let image_offset = lattice.get_cartesian_coord(&Vector3::new(
                    img_a as f64,
                    img_b as f64,
                    img_c as f64,
                ));
                let b_image = point_b + image_offset;
                let dist = (point_a - b_image).norm();
                if dist < min_dist {
                    min_dist = dist;
                }
            }
        }
    }

    min_dist
}

// === Supercell for Defect Calculations ===

/// Configuration for finding optimal defect supercells.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefectSupercellConfig {
    /// Minimum distance between periodic images of the defect (Angstrom).
    pub min_distance: f64,
    /// Maximum number of atoms allowed in the supercell.
    pub max_atoms: usize,
    /// Preference for cubic supercells (0.0 = none, 1.0 = strong).
    pub cubic_preference: f64,
}

impl Default for DefectSupercellConfig {
    fn default() -> Self {
        Self {
            min_distance: 10.0,
            max_atoms: 200,
            cubic_preference: 0.5,
        }
    }
}

/// Find an optimal supercell matrix for dilute defect calculations.
///
/// This function finds a supercell transformation matrix that:
/// 1. Ensures periodic images of the defect are at least `min_distance` apart.
/// 2. Keeps the total number of atoms below `max_atoms`.
/// 3. Optionally prefers more cubic supercells.
///
/// # Arguments
///
/// * `structure` - The structure to create a supercell for.
/// * `config` - Configuration specifying constraints.
///
/// # Returns
///
/// A 3x3 integer transformation matrix for creating the supercell.
pub fn find_defect_supercell(
    structure: &Structure,
    config: &DefectSupercellConfig,
) -> Result<[[i32; 3]; 3]> {
    let lattice = &structure.lattice;
    let lengths = lattice.lengths();
    let num_sites = structure.num_sites();

    if num_sites == 0 {
        return Err(FerroxError::InvalidStructure {
            index: 0,
            reason: "Cannot create supercell for empty structure".to_string(),
        });
    }

    // Calculate perpendicular distances (heights of the parallelepiped)
    let perp_dists = calculate_perpendicular_distances(lattice);

    // Check for degenerate lattice (zero perpendicular distance in any direction)
    if perp_dists.x <= 0.0 || perp_dists.y <= 0.0 || perp_dists.z <= 0.0 {
        return Err(FerroxError::InvalidStructure {
            index: 0,
            reason: format!(
                "Degenerate lattice with zero perpendicular distance: {:?}",
                perp_dists
            ),
        });
    }

    // Minimum scaling factors needed for each direction
    // Safe division since we verified perp_dists are positive
    let min_scale_a = (config.min_distance / perp_dists.x).ceil().max(1.0) as i32;
    let min_scale_b = (config.min_distance / perp_dists.y).ceil().max(1.0) as i32;
    let min_scale_c = (config.min_distance / perp_dists.z).ceil().max(1.0) as i32;

    // Start with minimum diagonal supercell
    let mut best_matrix = [
        [min_scale_a, 0, 0],
        [0, min_scale_b, 0],
        [0, 0, min_scale_c],
    ];
    let mut best_score = f64::MAX;

    // Search for better supercell matrices
    let max_scale = ((config.max_atoms as f64 / num_sites as f64).cbrt().ceil() as i32 + 1)
        .max(min_scale_a.max(min_scale_b).max(min_scale_c));

    for scale_a in min_scale_a..=max_scale {
        for scale_b in min_scale_b..=max_scale {
            for scale_c in min_scale_c..=max_scale {
                let matrix = [[scale_a, 0, 0], [0, scale_b, 0], [0, 0, scale_c]];

                // Check atom count
                let det = scale_a * scale_b * scale_c;
                let n_atoms = num_sites * det.unsigned_abs() as usize;
                if n_atoms > config.max_atoms {
                    continue;
                }

                // Check perpendicular distances in supercell
                let super_lengths = Vector3::new(
                    lengths.x * scale_a as f64,
                    lengths.y * scale_b as f64,
                    lengths.z * scale_c as f64,
                );
                let super_perp = Vector3::new(
                    perp_dists.x * scale_a as f64,
                    perp_dists.y * scale_b as f64,
                    perp_dists.z * scale_c as f64,
                );

                if super_perp.min() < config.min_distance {
                    continue;
                }

                // Score: prefer smaller cells with good cubicity
                let size_score = n_atoms as f64;
                let cubicity_score = if config.cubic_preference > 0.0 {
                    let avg_len = (super_lengths.x + super_lengths.y + super_lengths.z) / 3.0;
                    let deviation = ((super_lengths.x - avg_len).powi(2)
                        + (super_lengths.y - avg_len).powi(2)
                        + (super_lengths.z - avg_len).powi(2))
                        / 3.0;
                    deviation.sqrt() * config.cubic_preference
                } else {
                    0.0
                };

                let score = size_score + cubicity_score;

                if score < best_score {
                    best_score = score;
                    best_matrix = matrix;
                }
            }
        }
    }

    Ok(best_matrix)
}

/// Calculate perpendicular distances (heights) of the lattice parallelepiped.
fn calculate_perpendicular_distances(lattice: &Lattice) -> Vector3<f64> {
    let matrix = lattice.matrix();
    let vol = lattice.volume().abs();

    let vec_a = matrix.row(0).transpose();
    let vec_b = matrix.row(1).transpose();
    let vec_c = matrix.row(2).transpose();

    // Perpendicular distance along a = V / |b x c|
    // Use epsilon to avoid division by near-zero for degenerate lattices
    const EPS: f64 = 1e-10;

    let cross_bc = vec_b.cross(&vec_c).norm();
    let cross_ca = vec_c.cross(&vec_a).norm();
    let cross_ab = vec_a.cross(&vec_b).norm();

    let perp_a = if cross_bc > EPS { vol / cross_bc } else { 0.0 };
    let perp_b = if cross_ca > EPS { vol / cross_ca } else { 0.0 };
    let perp_c = if cross_ab > EPS { vol / cross_ab } else { 0.0 };

    Vector3::new(perp_a, perp_b, perp_c)
}

// === DefectEntry and Generator ===

/// Complete information about a defect for JSON serialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefectEntry {
    /// Name following doped convention (e.g., "v_O_4a", "Fe_on_Ni").
    pub name: String,
    /// Type of defect.
    pub defect_type: DefectType,
    /// Index of the defect site in the original structure (None for interstitials).
    pub site_idx: Option<usize>,
    /// Fractional coordinates of the defect site.
    pub frac_coords: Vector3<f64>,
    /// Element symbol of the new species (for interstitials/substitutions).
    pub species: Option<String>,
    /// Element symbol of the original species (for vacancies/substitutions).
    pub original_species: Option<String>,
    /// Wyckoff label of the site.
    pub wyckoff: Option<String>,
    /// Site symmetry (point group).
    pub site_symmetry: Option<String>,
    /// Predicted charge states with probabilities.
    pub charge_states: Vec<ChargeStateGuess>,
    /// Number of symmetry-equivalent sites.
    pub equivalent_sites: usize,
}

/// Configuration for the defects generator.
#[derive(Debug, Clone)]
pub struct DefectsGeneratorConfig {
    /// Elements to consider as substitutional dopants.
    pub extrinsic: Vec<String>,
    /// Whether to generate vacancies.
    pub include_vacancies: bool,
    /// Whether to generate substitutions.
    pub include_substitutions: bool,
    /// Whether to generate interstitials.
    pub include_interstitials: bool,
    /// Whether to generate antisites.
    pub include_antisites: bool,
    /// Minimum image distance for supercell (Å).
    pub supercell_min_dist: f64,
    /// Maximum atoms in supercell.
    pub supercell_max_atoms: usize,
    /// Minimum distance for interstitial sites (Å).
    pub interstitial_min_dist: Option<f64>,
    /// Symmetry precision for site equivalence.
    pub symprec: f64,
    /// Maximum charge state magnitude.
    pub max_charge: i32,
}

impl Default for DefectsGeneratorConfig {
    fn default() -> Self {
        Self {
            extrinsic: vec![],
            include_vacancies: true,
            include_substitutions: true,
            include_interstitials: true,
            include_antisites: true,
            supercell_min_dist: 10.0,
            supercell_max_atoms: 200,
            interstitial_min_dist: None,
            symprec: 0.01,
            max_charge: 4,
        }
    }
}

/// Result of the defects generator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefectsGeneratorResult {
    /// Supercell transformation matrix.
    pub supercell_matrix: [[i32; 3]; 3],
    /// All generated vacancy defects.
    pub vacancies: Vec<DefectEntry>,
    /// All generated substitution defects.
    pub substitutions: Vec<DefectEntry>,
    /// All generated interstitial defects.
    pub interstitials: Vec<DefectEntry>,
    /// All generated antisite defects.
    pub antisites: Vec<DefectEntry>,
    /// Space group of the structure.
    pub spacegroup: Option<String>,
    /// Total number of unique defects.
    pub n_defects: usize,
}

/// Generate all point defects for a structure.
///
/// This is the main workflow function that mirrors doped's DefectsGenerator.
/// It analyzes the structure's symmetry, finds unique sites, and generates
/// all requested defect types with charge state predictions.
///
/// # Arguments
///
/// * `structure` - The primitive/conventional cell to generate defects for
/// * `config` - Configuration options
///
/// # Returns
///
/// A `DefectsGeneratorResult` containing all generated defects organized by type.
pub fn generate_all_defects(
    structure: &Structure,
    config: &DefectsGeneratorConfig,
) -> Result<DefectsGeneratorResult> {
    // Get symmetry info including Wyckoff sites
    let wyckoff_sites = structure.get_wyckoff_sites(config.symprec).ok();

    // Get space group if available
    let spacegroup = structure
        .get_symmetry_dataset(config.symprec)
        .ok()
        .map(|ds| ds.hm_symbol.clone());

    // Find unique sites by Wyckoff position to avoid duplicate defects
    // Group site indices by their orbit (representative index)
    let unique_sites = find_unique_sites(structure, &wyckoff_sites);

    // Find supercell matrix for defect calculations
    let supercell_config = DefectSupercellConfig {
        min_distance: config.supercell_min_dist,
        max_atoms: config.supercell_max_atoms,
        cubic_preference: 0.5,
    };
    let supercell_matrix = find_defect_supercell(structure, &supercell_config)?;

    // Collect elements present in the structure
    let elements_in_structure: HashSet<String> = structure
        .site_occupancies
        .iter()
        .map(|occ| occ.dominant_species().element.symbol().to_string())
        .collect();

    // Generate defects
    let vacancies = if config.include_vacancies {
        generate_vacancies(structure, &unique_sites, config)
    } else {
        vec![]
    };

    let substitutions = if config.include_substitutions {
        generate_substitutions(structure, &unique_sites, config)
    } else {
        vec![]
    };

    let interstitials = if config.include_interstitials {
        generate_interstitials(structure, config)
    } else {
        vec![]
    };

    let antisites = if config.include_antisites && elements_in_structure.len() >= 2 {
        generate_antisites(structure, &unique_sites, config)
    } else {
        vec![]
    };

    let n_defects = vacancies.len() + substitutions.len() + interstitials.len() + antisites.len();

    Ok(DefectsGeneratorResult {
        supercell_matrix,
        vacancies,
        substitutions,
        interstitials,
        antisites,
        spacegroup,
        n_defects,
    })
}

/// Information about a unique site in the structure.
#[derive(Debug, Clone)]
struct UniqueSite {
    /// Index of a representative site in this equivalence class.
    representative_idx: usize,
    /// Element at this site.
    element: String,
    /// Wyckoff information if available.
    wyckoff: Option<WyckoffSite>,
    /// Number of equivalent sites.
    multiplicity: usize,
}

/// Find unique sites grouped by Wyckoff position.
fn find_unique_sites(
    structure: &Structure,
    wyckoff_sites: &Option<Vec<WyckoffSite>>,
) -> Vec<UniqueSite> {
    let mut unique_sites: Vec<UniqueSite> = Vec::new();

    if let Some(wyckoffs) = wyckoff_sites {
        // Group sites by Wyckoff label and element
        let mut seen: HashSet<(String, String)> = HashSet::new();

        for (idx, wyckoff) in wyckoffs.iter().enumerate() {
            let element = structure.site_occupancies[idx]
                .dominant_species()
                .element
                .symbol()
                .to_string();
            let key = (wyckoff.label.clone(), element.clone());

            if seen.insert(key) {
                unique_sites.push(UniqueSite {
                    representative_idx: idx,
                    element,
                    wyckoff: Some(wyckoff.clone()),
                    multiplicity: wyckoff.multiplicity,
                });
            }
        }
    } else {
        // No symmetry info: treat each element type as unique
        let mut seen_elements: HashSet<String> = HashSet::new();

        for (idx, occ) in structure.site_occupancies.iter().enumerate() {
            let element = occ.dominant_species().element.symbol().to_string();
            if seen_elements.insert(element.clone()) {
                let count = structure
                    .site_occupancies
                    .iter()
                    .filter(|o| o.dominant_species().element.symbol() == element)
                    .count();
                unique_sites.push(UniqueSite {
                    representative_idx: idx,
                    element,
                    wyckoff: None,
                    multiplicity: count,
                });
            }
        }
    }

    unique_sites
}

/// Generate vacancy defects for unique sites.
fn generate_vacancies(
    structure: &Structure,
    unique_sites: &[UniqueSite],
    config: &DefectsGeneratorConfig,
) -> Vec<DefectEntry> {
    let mut vacancies: Vec<DefectEntry> = Vec::new();

    for site in unique_sites {
        let frac_coords = structure.frac_coords[site.representative_idx];
        let wyckoff_label = site.wyckoff.as_ref().map(|wyk| wyk.label.clone());
        let site_symmetry = site.wyckoff.as_ref().map(|wyk| wyk.site_symmetry.clone());

        // Generate name following doped convention
        let name = match &wyckoff_label {
            Some(wyk) => format!("v_{}_{}", site.element, wyk),
            None => format!("v_{}", site.element),
        };

        // Get charge states for vacancy (removing the species)
        let charge_states = guess_defect_charge_states(
            DefectType::Vacancy,
            Some(&site.element),
            None,
            None,
            config.max_charge,
        );

        vacancies.push(DefectEntry {
            name,
            defect_type: DefectType::Vacancy,
            site_idx: Some(site.representative_idx),
            frac_coords,
            species: None,
            original_species: Some(site.element.clone()),
            wyckoff: wyckoff_label,
            site_symmetry,
            charge_states,
            equivalent_sites: site.multiplicity,
        });
    }

    vacancies
}

/// Generate substitution defects for unique sites.
fn generate_substitutions(
    structure: &Structure,
    unique_sites: &[UniqueSite],
    config: &DefectsGeneratorConfig,
) -> Vec<DefectEntry> {
    let mut substitutions: Vec<DefectEntry> = Vec::new();

    // If no extrinsic dopants specified, return empty
    if config.extrinsic.is_empty() {
        return substitutions;
    }

    for site in unique_sites {
        let frac_coords = structure.frac_coords[site.representative_idx];
        let wyckoff_label = site.wyckoff.as_ref().map(|wyk| wyk.label.clone());
        let site_symmetry = site.wyckoff.as_ref().map(|wyk| wyk.site_symmetry.clone());

        for dopant in &config.extrinsic {
            // Skip if dopant is the same as the host element
            if dopant == &site.element {
                continue;
            }

            // Generate name following doped convention
            let name = format!("{}_on_{}", dopant, site.element);

            // Get charge states for substitution
            let charge_states = guess_defect_charge_states(
                DefectType::Substitution,
                None,
                Some(dopant),
                Some(&site.element),
                config.max_charge,
            );

            substitutions.push(DefectEntry {
                name,
                defect_type: DefectType::Substitution,
                site_idx: Some(site.representative_idx),
                frac_coords,
                species: Some(dopant.clone()),
                original_species: Some(site.element.clone()),
                wyckoff: wyckoff_label.clone(),
                site_symmetry: site_symmetry.clone(),
                charge_states,
                equivalent_sites: site.multiplicity,
            });
        }
    }

    substitutions
}

/// Generate interstitial defects from Voronoi analysis.
fn generate_interstitials(
    structure: &Structure,
    config: &DefectsGeneratorConfig,
) -> Vec<DefectEntry> {
    let mut interstitials: Vec<DefectEntry> = Vec::new();

    // Find Voronoi interstitial sites
    let voronoi_sites =
        find_voronoi_interstitials(structure, config.interstitial_min_dist, config.symprec);

    // Collect elements to create interstitials for
    // Use both host elements and extrinsic dopants
    let mut interstitial_species: HashSet<String> = structure
        .site_occupancies
        .iter()
        .map(|occ| occ.dominant_species().element.symbol().to_string())
        .collect();
    for dopant in &config.extrinsic {
        interstitial_species.insert(dopant.clone());
    }

    for (site_idx, voronoi_site) in voronoi_sites.iter().enumerate() {
        for species in &interstitial_species {
            // Generate name with site type
            let site_type_str = voronoi_site.site_type.as_str();
            let name = if site_type_str != "other" {
                format!("{}_i_{}", species, site_type_str)
            } else {
                format!("{}_i_{}", species, site_idx)
            };

            // Get charge states for interstitial
            let charge_states = guess_defect_charge_states(
                DefectType::Interstitial,
                None,
                Some(species),
                None,
                config.max_charge,
            );

            interstitials.push(DefectEntry {
                name,
                defect_type: DefectType::Interstitial,
                site_idx: None,
                frac_coords: voronoi_site.frac_coords,
                species: Some(species.clone()),
                original_species: None,
                wyckoff: voronoi_site.wyckoff_label.clone(),
                site_symmetry: None,
                charge_states,
                equivalent_sites: voronoi_site.multiplicity,
            });
        }
    }

    interstitials
}

/// Generate antisite defects for structures with multiple elements.
fn generate_antisites(
    structure: &Structure,
    unique_sites: &[UniqueSite],
    config: &DefectsGeneratorConfig,
) -> Vec<DefectEntry> {
    let mut antisites: Vec<DefectEntry> = Vec::new();

    // Get all unique elements in the structure
    let elements: Vec<String> = unique_sites
        .iter()
        .map(|site| site.element.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    // Need at least 2 elements for antisites
    if elements.len() < 2 {
        return antisites;
    }

    for site in unique_sites {
        let frac_coords = structure.frac_coords[site.representative_idx];
        let wyckoff_label = site.wyckoff.as_ref().map(|wyk| wyk.label.clone());
        let site_symmetry = site.wyckoff.as_ref().map(|wyk| wyk.site_symmetry.clone());

        // Generate antisite for each other element type
        for other_element in &elements {
            if other_element == &site.element {
                continue;
            }

            // Generate name: new_element on old_element site (e.g., "Fe_Ni")
            let name = format!("{}_{}", other_element, site.element);

            // Get charge states for antisite
            let charge_states = guess_defect_charge_states(
                DefectType::Antisite,
                Some(&site.element),
                Some(other_element),
                None,
                config.max_charge,
            );

            antisites.push(DefectEntry {
                name,
                defect_type: DefectType::Antisite,
                site_idx: Some(site.representative_idx),
                frac_coords,
                species: Some(other_element.clone()),
                original_species: Some(site.element.clone()),
                wyckoff: wyckoff_label.clone(),
                site_symmetry: site_symmetry.clone(),
                charge_states,
                equivalent_sites: site.multiplicity,
            });
        }
    }

    antisites
}

// === Tests ===

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

    fn make_fcc_cu() -> Structure {
        let lattice = Lattice::cubic(3.6);
        let species = vec![
            Species::neutral(Element::Cu),
            Species::neutral(Element::Cu),
            Species::neutral(Element::Cu),
            Species::neutral(Element::Cu),
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
    fn test_create_vacancy() {
        let structure = make_nacl();
        assert_eq!(structure.num_sites(), 2);

        let defect = create_vacancy(&structure, 0).unwrap();
        assert_eq!(defect.structure.num_sites(), 1);
        assert_eq!(defect.defect.defect_type, DefectType::Vacancy);
        assert_eq!(defect.defect.original_species.unwrap().element, Element::Na);
    }

    #[test]
    fn test_create_substitution() {
        let structure = make_nacl();
        let new_species = Species::neutral(Element::K);

        let defect = create_substitution(&structure, 0, new_species).unwrap();
        assert_eq!(defect.structure.num_sites(), 2);
        assert_eq!(defect.defect.defect_type, DefectType::Substitution);
        assert_eq!(defect.defect.species.unwrap().element, Element::K);
        assert_eq!(defect.defect.original_species.unwrap().element, Element::Na);

        // Verify the species was actually changed
        assert_eq!(
            defect.structure.site_occupancies[0]
                .dominant_species()
                .element,
            Element::K
        );
    }

    #[test]
    fn test_create_antisite() {
        let structure = make_nacl();

        let swapped = create_antisite_pair(&structure, 0, 1).unwrap();
        assert_eq!(swapped.num_sites(), 2);

        // Na and Cl should be swapped
        assert_eq!(
            swapped.site_occupancies[0].dominant_species().element,
            Element::Cl
        );
        assert_eq!(
            swapped.site_occupancies[1].dominant_species().element,
            Element::Na
        );
    }

    #[test]
    fn test_create_interstitial() {
        let structure = make_nacl();
        let species = Species::neutral(Element::Li);
        let position = Vector3::new(0.25, 0.25, 0.25);

        let defect = create_interstitial(&structure, position, species).unwrap();
        assert_eq!(defect.structure.num_sites(), 3);
        assert_eq!(defect.defect.defect_type, DefectType::Interstitial);
    }

    #[test]
    fn test_classify_interstitial_site() {
        assert_eq!(
            classify_interstitial_site(3),
            InterstitialSiteType::Trigonal
        );
        assert_eq!(
            classify_interstitial_site(4),
            InterstitialSiteType::Tetrahedral
        );
        assert_eq!(
            classify_interstitial_site(5),
            InterstitialSiteType::SquarePyramidal
        );
        assert_eq!(
            classify_interstitial_site(6),
            InterstitialSiteType::Octahedral
        );
        assert_eq!(classify_interstitial_site(8), InterstitialSiteType::Cubic);
        assert_eq!(
            classify_interstitial_site(12),
            InterstitialSiteType::Cuboctahedral
        );
        assert_eq!(classify_interstitial_site(7), InterstitialSiteType::Other);
    }

    #[test]
    fn test_find_defect_supercell() {
        let structure = make_nacl();
        let config = DefectSupercellConfig {
            min_distance: 10.0,
            max_atoms: 200,
            cubic_preference: 0.5,
        };

        let matrix = find_defect_supercell(&structure, &config).unwrap();

        // Should be at least 2x2x2 to satisfy min_distance for NaCl (a=5.64)
        let det = matrix[0][0] * matrix[1][1] * matrix[2][2];
        assert!(det >= 8);

        // Check perpendicular distances
        let super_lattice = Lattice::cubic(5.64 * matrix[0][0] as f64);
        let perp = calculate_perpendicular_distances(&super_lattice);
        assert!(perp.min() >= config.min_distance);
    }

    #[test]
    fn test_vacancy_out_of_bounds() {
        let structure = make_nacl();
        let result = create_vacancy(&structure, 10);
        assert!(result.is_err());
    }

    #[test]
    fn test_find_defect_supercell_degenerate_lattice() {
        // Create a degenerate lattice with one zero-length axis
        use nalgebra::Matrix3;
        let degenerate_matrix = Matrix3::new(5.0, 0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 0.0);
        let lattice = Lattice::new(degenerate_matrix);
        let species = vec![Species::neutral(Element::Fe)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0)];
        let structure = Structure::new(lattice, species, coords);

        let config = DefectSupercellConfig {
            min_distance: 10.0,
            max_atoms: 100,
            cubic_preference: 0.0,
        };

        let result = find_defect_supercell(&structure, &config);
        assert!(result.is_err(), "Should fail for degenerate lattice");
    }

    #[test]
    fn test_antisite_same_site_error() {
        let structure = make_nacl();
        let result = create_antisite_pair(&structure, 0, 0);
        assert!(result.is_err());
    }

    #[test]
    fn test_find_voronoi_interstitials_empty_structure() {
        let lattice = Lattice::cubic(5.0);
        let structure = Structure::new(lattice, vec![], vec![]);
        let sites = find_voronoi_interstitials(&structure, None, 0.01);
        assert!(sites.is_empty());
    }

    #[test]
    fn test_find_voronoi_interstitials_fcc() {
        let structure = make_fcc_cu();
        let sites = find_voronoi_interstitials(&structure, Some(0.5), 0.1);

        // FCC should have octahedral (at 0.5, 0.5, 0.5) and tetrahedral sites
        assert!(!sites.is_empty(), "FCC should have interstitial sites");

        // All sites should have positive min_distance
        for site in &sites {
            assert!(site.min_distance > 0.0);
            assert!(site.coordination > 0);
        }

        // Sites should be sorted by min_distance (descending)
        for idx in 1..sites.len() {
            assert!(
                sites[idx - 1].min_distance >= sites[idx].min_distance,
                "Sites should be sorted by min_distance descending"
            );
        }
    }

    #[test]
    fn test_find_voronoi_interstitials_bcc() {
        // BCC structure (Fe)
        let lattice = Lattice::cubic(2.87);
        let species = vec![Species::neutral(Element::Fe), Species::neutral(Element::Fe)];
        let coords = vec![
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(0.5, 0.5, 0.5), // body center
        ];
        let structure = Structure::new(lattice, species, coords);

        let sites = find_voronoi_interstitials(&structure, Some(0.5), 0.1);

        // BCC should have octahedral sites at face centers and edge centers
        assert!(!sites.is_empty(), "BCC should have interstitial sites");

        for site in &sites {
            assert!(site.min_distance > 0.0);
            // All fractional coords should be in [0, 1)
            assert!(site.frac_coords.x >= 0.0 && site.frac_coords.x < 1.0);
            assert!(site.frac_coords.y >= 0.0 && site.frac_coords.y < 1.0);
            assert!(site.frac_coords.z >= 0.0 && site.frac_coords.z < 1.0);
        }
    }

    #[test]
    fn test_voronoi_interstitial_site_type_classification() {
        let structure = make_fcc_cu();
        let sites = find_voronoi_interstitials(&structure, Some(0.3), 0.1);

        // Check that sites have valid classifications
        for site in &sites {
            match site.coordination {
                3 => assert_eq!(site.site_type, InterstitialSiteType::Trigonal),
                4 => assert_eq!(site.site_type, InterstitialSiteType::Tetrahedral),
                5 => assert_eq!(site.site_type, InterstitialSiteType::SquarePyramidal),
                6 => assert_eq!(site.site_type, InterstitialSiteType::Octahedral),
                8 => assert_eq!(site.site_type, InterstitialSiteType::Cubic),
                12 => assert_eq!(site.site_type, InterstitialSiteType::Cuboctahedral),
                _ => assert_eq!(site.site_type, InterstitialSiteType::Other),
            }
        }
    }

    // === Defect Naming Tests ===

    #[test]
    fn test_defect_name_vacancy() {
        let defect = PointDefect::vacancy(0, Vector3::zeros(), Species::neutral(Element::O));
        assert_eq!(defect.name(None, None), "v_O");
        assert_eq!(defect.name(Some("4a"), None), "v_O_4a");
        assert_eq!(defect.name(Some("8c"), None), "v_O_8c");
    }

    #[test]
    fn test_defect_name_substitution() {
        let defect = PointDefect::substitution(
            0,
            Vector3::zeros(),
            Species::neutral(Element::Fe),
            Species::neutral(Element::Ni),
        );
        assert_eq!(defect.name(None, None), "Fe_on_Ni");
    }

    #[test]
    fn test_defect_name_interstitial() {
        let defect = PointDefect::interstitial(
            Vector3::new(0.25, 0.25, 0.25),
            Species::neutral(Element::Li),
        );
        assert_eq!(defect.name(None, None), "Li_i");
        assert_eq!(defect.name(None, Some("oct")), "Li_i_oct");
        assert_eq!(defect.name(None, Some("tet")), "Li_i_tet");
    }

    #[test]
    fn test_defect_name_antisite() {
        // Antisite: Fe on Ni site
        let defect = PointDefect {
            defect_type: DefectType::Antisite,
            site_idx: Some(0),
            position: Vector3::zeros(),
            species: Some(Species::neutral(Element::Fe)),
            original_species: Some(Species::neutral(Element::Ni)),
            charge: 0,
        };
        assert_eq!(defect.name(None, None), "Fe_Ni");
    }

    #[test]
    fn test_generate_defect_name_function() {
        let defect = PointDefect::vacancy(0, Vector3::zeros(), Species::neutral(Element::Na));
        assert_eq!(generate_defect_name(&defect, None, None), "v_Na");
        assert_eq!(generate_defect_name(&defect, Some("2a"), None), "v_Na_2a");
    }

    // === DefectsGenerator Tests ===

    #[test]
    fn test_defects_generator_config_default() {
        let config = DefectsGeneratorConfig::default();
        assert!(config.include_vacancies);
        assert!(config.include_substitutions);
        assert!(config.include_interstitials);
        assert!(config.include_antisites);
        assert_eq!(config.supercell_min_dist, 10.0);
        assert_eq!(config.supercell_max_atoms, 200);
        assert_eq!(config.symprec, 0.01);
        assert_eq!(config.max_charge, 4);
    }

    #[test]
    fn test_generate_all_defects_nacl() {
        let structure = make_nacl();
        let config = DefectsGeneratorConfig::default();

        let result = generate_all_defects(&structure, &config).unwrap();

        // Should have vacancies for Na and Cl
        assert_eq!(result.vacancies.len(), 2);

        // Should have antisites since there are 2 elements
        assert_eq!(result.antisites.len(), 2); // Na on Cl, Cl on Na

        // No extrinsic dopants, so no substitutions
        assert!(result.substitutions.is_empty());

        // Should have interstitials for both Na and Cl
        assert!(!result.interstitials.is_empty());

        // Total defects should be sum of all types
        assert_eq!(
            result.n_defects,
            result.vacancies.len()
                + result.substitutions.len()
                + result.interstitials.len()
                + result.antisites.len()
        );

        // Check vacancy naming
        let vacancy_names: Vec<&str> = result.vacancies.iter().map(|d| d.name.as_str()).collect();
        assert!(vacancy_names.iter().any(|n| n.starts_with("v_Na")));
        assert!(vacancy_names.iter().any(|n| n.starts_with("v_Cl")));
    }

    #[test]
    fn test_generate_all_defects_with_extrinsic() {
        let structure = make_nacl();
        let config = DefectsGeneratorConfig {
            extrinsic: vec!["K".to_string(), "Br".to_string()],
            ..Default::default()
        };

        let result = generate_all_defects(&structure, &config).unwrap();

        // Should have substitutions: K_on_Na, K_on_Cl, Br_on_Na, Br_on_Cl
        assert_eq!(result.substitutions.len(), 4);

        // Check substitution naming
        let sub_names: Vec<&str> = result
            .substitutions
            .iter()
            .map(|d| d.name.as_str())
            .collect();
        assert!(sub_names.contains(&"K_on_Na"));
        assert!(sub_names.contains(&"K_on_Cl"));
        assert!(sub_names.contains(&"Br_on_Na"));
        assert!(sub_names.contains(&"Br_on_Cl"));
    }

    #[test]
    fn test_generate_all_defects_vacancies_only() {
        let structure = make_nacl();
        let config = DefectsGeneratorConfig {
            include_vacancies: true,
            include_substitutions: false,
            include_interstitials: false,
            include_antisites: false,
            ..Default::default()
        };

        let result = generate_all_defects(&structure, &config).unwrap();

        assert_eq!(result.vacancies.len(), 2);
        assert!(result.substitutions.is_empty());
        assert!(result.interstitials.is_empty());
        assert!(result.antisites.is_empty());
    }

    #[test]
    fn test_generate_all_defects_single_element() {
        let structure = make_fcc_cu();
        let config = DefectsGeneratorConfig::default();

        let result = generate_all_defects(&structure, &config).unwrap();

        // Should have 1 vacancy type (all Cu sites are equivalent)
        assert_eq!(result.vacancies.len(), 1);
        assert_eq!(result.vacancies[0].original_species, Some("Cu".to_string()));

        // No antisites for single element
        assert!(result.antisites.is_empty());

        // Should have interstitials for Cu
        assert!(!result.interstitials.is_empty());
    }

    #[test]
    fn test_defect_entry_charge_states() {
        let structure = make_nacl();
        let config = DefectsGeneratorConfig {
            max_charge: 4,
            ..Default::default()
        };

        let result = generate_all_defects(&structure, &config).unwrap();

        // Check that vacancies have charge states
        for vacancy in &result.vacancies {
            assert!(!vacancy.charge_states.is_empty());
            // Cl vacancy should have +1 as likely charge (Cl is -1)
            if vacancy.original_species == Some("Cl".to_string()) {
                assert!(vacancy.charge_states.iter().any(|cs| cs.charge == 1));
            }
            // Na vacancy should have -1 as likely charge (Na is +1)
            if vacancy.original_species == Some("Na".to_string()) {
                assert!(vacancy.charge_states.iter().any(|cs| cs.charge == -1));
            }
        }
    }

    #[test]
    fn test_defect_entry_has_coordinates() {
        let structure = make_nacl();
        let config = DefectsGeneratorConfig::default();

        let result = generate_all_defects(&structure, &config).unwrap();

        // All defects should have fractional coordinates (with tolerance for floating-point)
        let eps = 1e-10;
        for vacancy in &result.vacancies {
            assert!(vacancy.frac_coords.x >= -eps && vacancy.frac_coords.x <= 1.0 + eps);
            assert!(vacancy.frac_coords.y >= -eps && vacancy.frac_coords.y <= 1.0 + eps);
            assert!(vacancy.frac_coords.z >= -eps && vacancy.frac_coords.z <= 1.0 + eps);
        }

        for interstitial in &result.interstitials {
            assert!(interstitial.frac_coords.x >= -eps && interstitial.frac_coords.x <= 1.0 + eps);
            assert!(interstitial.frac_coords.y >= -eps && interstitial.frac_coords.y <= 1.0 + eps);
            assert!(interstitial.frac_coords.z >= -eps && interstitial.frac_coords.z <= 1.0 + eps);
        }
    }

    #[test]
    fn test_defect_entry_supercell_matrix() {
        let structure = make_nacl();
        let config = DefectsGeneratorConfig {
            supercell_min_dist: 10.0,
            supercell_max_atoms: 200,
            ..Default::default()
        };

        let result = generate_all_defects(&structure, &config).unwrap();

        // Supercell matrix should satisfy min distance
        let det = result.supercell_matrix[0][0]
            * result.supercell_matrix[1][1]
            * result.supercell_matrix[2][2];
        assert!(det >= 8, "Supercell should be at least 2x2x2 for NaCl");
    }
}
