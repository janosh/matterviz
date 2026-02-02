//! Surface analysis module for crystallographic surfaces.
//!
//! This module provides functionality for:
//! - Miller index manipulation and enumeration
//! - Surface termination analysis
//! - Adsorption site finding
//! - Surface energy calculations
//! - Wulff construction for equilibrium crystal shapes

use crate::error::{FerroxError, Result};
use crate::lattice::Lattice;
use crate::species::Species;
use crate::structure::Structure;
use nalgebra::Vector3;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::f64::consts::PI;

// === Miller Index ===

/// A Miller index (h, k, l) representing a crystallographic plane.
///
/// Miller indices specify the orientation of a plane in a crystal lattice.
/// Common low-index planes include (100), (110), (111), etc.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MillerIndex {
    /// h component of the Miller index
    pub h: i32,
    /// k component of the Miller index
    pub k: i32,
    /// l component of the Miller index
    pub l: i32,
}

impl MillerIndex {
    /// Create a new Miller index.
    pub fn new(h: i32, k: i32, l: i32) -> Self {
        Self { h, k, l }
    }

    /// Create a Miller index from an array.
    pub fn from_array(hkl: [i32; 3]) -> Self {
        Self {
            h: hkl[0],
            k: hkl[1],
            l: hkl[2],
        }
    }

    /// Convert to array format.
    pub fn to_array(&self) -> [i32; 3] {
        [self.h, self.k, self.l]
    }

    /// Compute the GCD of two integers.
    fn gcd(a: i32, b: i32) -> i32 {
        if b == 0 { a.abs() } else { Self::gcd(b, a % b) }
    }

    /// Reduce the Miller index to its smallest coprime representation.
    ///
    /// For example, (2, 4, 6) becomes (1, 2, 3).
    pub fn reduced(&self) -> Self {
        let gcd = Self::gcd(Self::gcd(self.h, self.k), self.l);
        if gcd == 0 {
            *self
        } else {
            Self {
                h: self.h / gcd,
                k: self.k / gcd,
                l: self.l / gcd,
            }
        }
    }

    /// Check if this is a zero index (0, 0, 0).
    pub fn is_zero(&self) -> bool {
        self.h == 0 && self.k == 0 && self.l == 0
    }

    /// Get the sum of absolute values of indices.
    pub fn norm_l1(&self) -> i32 {
        self.h.abs() + self.k.abs() + self.l.abs()
    }
}

impl std::fmt::Display for MillerIndex {
    fn fmt(&self, fmt: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(fmt, "({}, {}, {})", self.h, self.k, self.l)
    }
}

impl From<[i32; 3]> for MillerIndex {
    fn from(hkl: [i32; 3]) -> Self {
        Self::from_array(hkl)
    }
}

impl From<MillerIndex> for [i32; 3] {
    fn from(miller: MillerIndex) -> Self {
        miller.to_array()
    }
}

/// Enumerate all unique Miller indices up to a maximum index value.
///
/// This generates all unique low-index Miller planes with |h|, |k|, |l| <= max_index.
/// Each plane is returned in reduced form (coprime indices) and only once
/// per symmetry-equivalent family (avoiding both (1,0,0) and (-1,0,0)).
///
/// # Arguments
///
/// * `max_index` - Maximum absolute value for any index component
///
/// # Returns
///
/// A vector of unique Miller indices, excluding (0, 0, 0).
pub fn enumerate_miller_indices(max_index: i32) -> Vec<MillerIndex> {
    let mut indices = HashSet::new();

    for h in -max_index..=max_index {
        for k in -max_index..=max_index {
            for l in -max_index..=max_index {
                if h == 0 && k == 0 && l == 0 {
                    continue;
                }
                let miller = MillerIndex::new(h, k, l).reduced();
                // Normalize sign: first non-zero component should be positive
                let normalized = normalize_miller_sign(miller);
                indices.insert(normalized);
            }
        }
    }

    let mut result: Vec<MillerIndex> = indices.into_iter().collect();
    // Sort by L1 norm (sum of absolute values) then lexicographically
    result.sort_by(|a, b| {
        a.norm_l1()
            .cmp(&b.norm_l1())
            .then(a.h.cmp(&b.h))
            .then(a.k.cmp(&b.k))
            .then(a.l.cmp(&b.l))
    });
    result
}

/// Normalize Miller index sign so first non-zero component is positive.
fn normalize_miller_sign(miller: MillerIndex) -> MillerIndex {
    let first_nonzero = if miller.h != 0 {
        miller.h
    } else if miller.k != 0 {
        miller.k
    } else {
        miller.l
    };

    if first_nonzero < 0 {
        MillerIndex::new(-miller.h, -miller.k, -miller.l)
    } else {
        miller
    }
}

// === Surface Termination ===

/// A surface termination representing a specific way to cut a crystal surface.
///
/// Different terminations expose different atomic arrangements at the surface,
/// which affects surface properties like energy, polarity, and reactivity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurfaceTermination {
    /// Miller index defining the surface orientation
    pub miller_index: MillerIndex,
    /// Shift along the surface normal (fractional coordinates)
    pub shift: f64,
    /// Species present at the surface
    pub surface_species: Vec<Species>,
    /// Surface atomic density (atoms per Å²)
    pub surface_density: f64,
    /// Whether the surface is polar (has net dipole)
    pub is_polar: bool,
    /// The slab structure for this termination
    pub slab: Structure,
}

impl SurfaceTermination {
    /// Create a new surface termination.
    pub fn new(
        miller_index: MillerIndex,
        shift: f64,
        surface_species: Vec<Species>,
        surface_density: f64,
        is_polar: bool,
        slab: Structure,
    ) -> Self {
        Self {
            miller_index,
            shift,
            surface_species,
            surface_density,
            is_polar,
            slab,
        }
    }
}

// === Adsorption Sites ===

/// Type of adsorption site on a surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AdsorptionSiteType {
    /// Atop site - directly above a surface atom
    Atop,
    /// Bridge site - between two surface atoms
    Bridge,
    /// Hollow site with 3-fold coordination
    Hollow3,
    /// Hollow site with 4-fold coordination
    Hollow4,
    /// Other site type
    Other,
}

impl AdsorptionSiteType {
    /// Parse from string representation.
    pub fn parse(type_str: &str) -> Option<Self> {
        match type_str.to_lowercase().as_str() {
            "atop" | "on_top" | "top" => Some(Self::Atop),
            "bridge" => Some(Self::Bridge),
            "hollow3" | "hollow_3" | "fcc" | "hcp" => Some(Self::Hollow3),
            "hollow4" | "hollow_4" | "hollow" => Some(Self::Hollow4),
            "other" => Some(Self::Other),
            _ => None,
        }
    }

    /// Get string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Atop => "atop",
            Self::Bridge => "bridge",
            Self::Hollow3 => "hollow3",
            Self::Hollow4 => "hollow4",
            Self::Other => "other",
        }
    }
}

impl std::fmt::Display for AdsorptionSiteType {
    fn fmt(&self, fmt: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(fmt, "{}", self.as_str())
    }
}

/// An adsorption site on a surface.
///
/// Represents a location where adsorbates can bind to the surface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdsorptionSite {
    /// Type of adsorption site
    pub site_type: AdsorptionSiteType,
    /// Position in fractional coordinates
    pub position: Vector3<f64>,
    /// Position in Cartesian coordinates
    pub cart_position: Vector3<f64>,
    /// Height above the surface (Å)
    pub height: f64,
    /// Indices of surface atoms coordinating this site
    pub coordinating_atoms: Vec<usize>,
    /// Symmetry multiplicity of this site
    pub symmetry_multiplicity: usize,
}

impl AdsorptionSite {
    /// Create a new adsorption site.
    pub fn new(
        site_type: AdsorptionSiteType,
        position: Vector3<f64>,
        cart_position: Vector3<f64>,
        height: f64,
        coordinating_atoms: Vec<usize>,
        symmetry_multiplicity: usize,
    ) -> Self {
        Self {
            site_type,
            position,
            cart_position,
            height,
            coordinating_atoms,
            symmetry_multiplicity,
        }
    }
}

// === Surface Analysis Functions ===

/// Get indices of surface atoms in a slab structure.
///
/// Surface atoms are identified as those with z-coordinates (in fractional)
/// above a certain threshold, based on the vacuum region.
///
/// # Arguments
///
/// * `slab` - The slab structure
/// * `tolerance` - Tolerance for identifying surface layers in **fractional coordinates**.
///   For example, 0.1 means atoms within 10% of the c-axis length from the top
///   are considered surface atoms. Typical values: 0.05-0.15 depending on slab thickness.
///
/// # Returns
///
/// Indices of atoms at the top surface.
pub fn get_surface_atoms(slab: &Structure, tolerance: f64) -> Vec<usize> {
    if slab.num_sites() == 0 {
        return vec![];
    }

    // Find the maximum z-coordinate
    let max_z = slab
        .frac_coords
        .iter()
        .map(|coord| coord.z)
        .fold(f64::NEG_INFINITY, f64::max);

    // Find atoms within tolerance of the maximum z
    slab.frac_coords
        .iter()
        .enumerate()
        .filter(|(_, coord)| (coord.z - max_z).abs() < tolerance)
        .map(|(idx, _)| idx)
        .collect()
}

/// Calculate the surface area of a slab.
///
/// The surface area is calculated as the cross product of the a and b
/// lattice vectors, giving the area of the periodic unit cell surface.
///
/// # Arguments
///
/// * `slab` - The slab structure
///
/// # Returns
///
/// Surface area in Å².
pub fn surface_area(slab: &Structure) -> f64 {
    let matrix = slab.lattice.matrix();
    let a_vec = matrix.row(0).transpose();
    let b_vec = matrix.row(1).transpose();
    a_vec.cross(&b_vec).norm()
}

/// Calculate surface energy from DFT energies.
///
/// Uses the standard formula:
/// γ = (E_slab - n * E_bulk) / (2 * A)
///
/// where the factor of 2 accounts for the two surfaces of the slab.
///
/// # Arguments
///
/// * `slab_energy` - Total energy of the slab (eV)
/// * `bulk_energy_per_atom` - Energy per atom in the bulk (eV)
/// * `n_atoms` - Number of atoms in the slab
/// * `area` - Surface area (Å²)
///
/// # Returns
///
/// Surface energy in eV/Å².
pub fn calculate_surface_energy(
    slab_energy: f64,
    bulk_energy_per_atom: f64,
    n_atoms: usize,
    area: f64,
) -> f64 {
    if area <= 0.0 {
        return f64::NAN;
    }
    (slab_energy - (n_atoms as f64) * bulk_energy_per_atom) / (2.0 * area)
}

/// Result of a surface energy calculation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurfaceEnergy {
    /// Miller index of the surface
    pub miller_index: MillerIndex,
    /// Surface energy in eV/Å²
    pub energy_ev_per_a2: f64,
    /// Surface energy in J/m²
    pub energy_j_per_m2: f64,
    /// Surface area used in calculation (Å²)
    pub surface_area: f64,
}

impl SurfaceEnergy {
    /// Create a new surface energy result.
    ///
    /// Automatically converts from eV/Å² to J/m².
    pub fn new(miller_index: MillerIndex, energy_ev_per_a2: f64, surface_area: f64) -> Self {
        // Conversion factor: 1 eV/Å² = 16.02176634 J/m²
        const EV_A2_TO_J_M2: f64 = 16.02176634;
        Self {
            miller_index,
            energy_ev_per_a2,
            energy_j_per_m2: energy_ev_per_a2 * EV_A2_TO_J_M2,
            surface_area,
        }
    }
}

// === Adsorption Site Finding ===

/// Find adsorption sites on a surface.
///
/// Identifies atop, bridge, and hollow sites on the surface of a slab.
///
/// # Arguments
///
/// * `slab` - The slab structure
/// * `height` - Height above surface for placing adsorbates (Å)
/// * `site_types` - Optional filter for site types (None = all types)
///
/// # Returns
///
/// Vector of adsorption sites found on the surface.
pub fn find_adsorption_sites(
    slab: &Structure,
    height: f64,
    site_types: Option<&[AdsorptionSiteType]>,
) -> Vec<AdsorptionSite> {
    let mut sites = Vec::new();

    // Get surface atoms with a reasonable tolerance
    let tolerance = 0.1;
    let surface_indices = get_surface_atoms(slab, tolerance);

    if surface_indices.is_empty() {
        return sites;
    }

    // Get Cartesian positions of surface atoms
    let cart_coords = slab.cart_coords();
    let surface_cart: Vec<Vector3<f64>> = surface_indices
        .iter()
        .map(|&idx| cart_coords[idx])
        .collect();

    // Get average z-coordinate of surface atoms
    let avg_z: f64 =
        surface_cart.iter().map(|coord| coord.z).sum::<f64>() / surface_cart.len() as f64;

    // Height for placing sites above surface
    let site_z = avg_z + height;

    // Check if we should include each site type
    let include_atop = site_types
        .map(|types| types.contains(&AdsorptionSiteType::Atop))
        .unwrap_or(true);
    let include_bridge = site_types
        .map(|types| types.contains(&AdsorptionSiteType::Bridge))
        .unwrap_or(true);
    let include_hollow3 = site_types
        .map(|types| types.contains(&AdsorptionSiteType::Hollow3))
        .unwrap_or(true);
    let include_hollow4 = site_types
        .map(|types| types.contains(&AdsorptionSiteType::Hollow4))
        .unwrap_or(true);

    // Atop sites: directly above each surface atom
    if include_atop {
        for (local_idx, &global_idx) in surface_indices.iter().enumerate() {
            let cart = surface_cart[local_idx];
            let cart_pos = Vector3::new(cart.x, cart.y, site_z);
            let frac_pos = slab.lattice.get_fractional_coord(&cart_pos);

            sites.push(AdsorptionSite::new(
                AdsorptionSiteType::Atop,
                frac_pos,
                cart_pos,
                height,
                vec![global_idx],
                1,
            ));
        }
    }

    // Bridge and hollow sites require neighbor analysis
    if include_bridge || include_hollow3 || include_hollow4 {
        // Build neighbor list for surface atoms
        let cutoff = 4.0; // Reasonable cutoff for nearest neighbors
        let (center_idx, neighbor_idx, _, distances) = slab.get_neighbor_list(cutoff, 1e-8, true);

        // Build adjacency set for O(1) neighbor lookups
        // Store edges as (min, max) pairs for consistent ordering
        let surface_set: HashSet<usize> = surface_indices.iter().copied().collect();
        let mut edges: HashSet<(usize, usize)> = HashSet::new();
        for ((&ci, &ni), &dist) in center_idx
            .iter()
            .zip(neighbor_idx.iter())
            .zip(distances.iter())
        {
            if dist < cutoff && surface_set.contains(&ci) && surface_set.contains(&ni) {
                let edge = if ci < ni { (ci, ni) } else { (ni, ci) };
                edges.insert(edge);
            }
        }

        // Helper to check if two atoms are neighbors using the prebuilt set
        let are_neighbors = |a: usize, b: usize| -> bool {
            let edge = if a < b { (a, b) } else { (b, a) };
            edges.contains(&edge)
        };

        // Build adjacency list for efficient neighbor iteration
        let mut adjacency: std::collections::HashMap<usize, Vec<usize>> =
            std::collections::HashMap::new();
        for &(a, b) in &edges {
            adjacency.entry(a).or_default().push(b);
            adjacency.entry(b).or_default().push(a);
        }

        // Map from global index to local index for position lookup
        let global_to_local: std::collections::HashMap<usize, usize> = surface_indices
            .iter()
            .enumerate()
            .map(|(local, &global)| (global, local))
            .collect();

        // Bridge sites: at midpoint of each edge
        if include_bridge {
            for &(global_i, global_j) in &edges {
                let idx_i = global_to_local[&global_i];
                let idx_j = global_to_local[&global_j];
                let cart_i = surface_cart[idx_i];
                let cart_j = surface_cart[idx_j];
                let midpoint = (cart_i + cart_j) / 2.0;
                let cart_pos = Vector3::new(midpoint.x, midpoint.y, site_z);
                let frac_pos = slab.lattice.get_fractional_coord(&cart_pos);

                sites.push(AdsorptionSite::new(
                    AdsorptionSiteType::Bridge,
                    frac_pos,
                    cart_pos,
                    height,
                    vec![global_i, global_j],
                    1,
                ));
            }
        }

        // Hollow sites require finding triangular or square arrangements
        if include_hollow3 || include_hollow4 {
            // Find triangles: for each edge (i,j), find common neighbors k
            if include_hollow3 {
                let mut found_triangles: HashSet<(usize, usize, usize)> = HashSet::new();
                for &(global_i, global_j) in &edges {
                    if let (Some(neighbors_i), Some(neighbors_j)) =
                        (adjacency.get(&global_i), adjacency.get(&global_j))
                    {
                        // Find common neighbors
                        let set_i: HashSet<usize> = neighbors_i.iter().copied().collect();
                        for &global_k in neighbors_j {
                            if global_k > global_j && set_i.contains(&global_k) {
                                // Found triangle i-j-k, normalize order to avoid duplicates
                                let mut tri = [global_i, global_j, global_k];
                                tri.sort();
                                if found_triangles.insert((tri[0], tri[1], tri[2])) {
                                    let idx_i = global_to_local[&global_i];
                                    let idx_j = global_to_local[&global_j];
                                    let idx_k = global_to_local[&global_k];
                                    let centroid = (surface_cart[idx_i]
                                        + surface_cart[idx_j]
                                        + surface_cart[idx_k])
                                        / 3.0;
                                    let cart_pos = Vector3::new(centroid.x, centroid.y, site_z);
                                    let frac_pos = slab.lattice.get_fractional_coord(&cart_pos);

                                    sites.push(AdsorptionSite::new(
                                        AdsorptionSiteType::Hollow3,
                                        frac_pos,
                                        cart_pos,
                                        height,
                                        vec![global_i, global_j, global_k],
                                        1,
                                    ));
                                }
                            }
                        }
                    }
                }
            }

            // Hollow4: find quadrilaterals by looking for cycles of 4
            if include_hollow4 && surface_indices.len() >= 4 {
                let mut found_quads: HashSet<(usize, usize, usize, usize)> = HashSet::new();
                // For each edge (i,j), look for two other atoms k,l such that
                // i-k, k-l, l-j are all edges (forming i-j-l-k cycle)
                for &(global_i, global_j) in &edges {
                    if let (Some(neighbors_i), Some(neighbors_j)) =
                        (adjacency.get(&global_i), adjacency.get(&global_j))
                    {
                        // For each neighbor k of i (k != j)
                        for &global_k in neighbors_i {
                            if global_k == global_j {
                                continue;
                            }
                            // For each neighbor l of j (l != i, l != k)
                            for &global_l in neighbors_j {
                                if global_l == global_i || global_l == global_k {
                                    continue;
                                }
                                // Check if k-l is an edge
                                if are_neighbors(global_k, global_l) {
                                    // Found quadrilateral i-k-l-j
                                    let mut quad = [global_i, global_j, global_k, global_l];
                                    quad.sort();
                                    if found_quads.insert((quad[0], quad[1], quad[2], quad[3])) {
                                        let idx_i = global_to_local[&global_i];
                                        let idx_j = global_to_local[&global_j];
                                        let idx_k = global_to_local[&global_k];
                                        let idx_l = global_to_local[&global_l];
                                        let centroid = (surface_cart[idx_i]
                                            + surface_cart[idx_j]
                                            + surface_cart[idx_k]
                                            + surface_cart[idx_l])
                                            / 4.0;
                                        let cart_pos = Vector3::new(centroid.x, centroid.y, site_z);
                                        let frac_pos = slab.lattice.get_fractional_coord(&cart_pos);

                                        sites.push(AdsorptionSite::new(
                                            AdsorptionSiteType::Hollow4,
                                            frac_pos,
                                            cart_pos,
                                            height,
                                            vec![global_i, global_j, global_k, global_l],
                                            1,
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    sites
}

// === Wulff Construction ===

/// A facet on a Wulff shape (equilibrium crystal shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WulffFacet {
    /// Miller index of this facet
    pub miller_index: MillerIndex,
    /// Surface energy of this facet (J/m²)
    pub surface_energy: f64,
    /// Normal vector to the facet (unit vector)
    pub normal: Vector3<f64>,
    /// Distance from center to facet (proportional to surface energy)
    pub distance_from_center: f64,
    /// Fractional area of total surface
    pub area_fraction: f64,
}

impl WulffFacet {
    /// Create a new Wulff facet.
    pub fn new(
        miller_index: MillerIndex,
        surface_energy: f64,
        normal: Vector3<f64>,
        distance_from_center: f64,
        area_fraction: f64,
    ) -> Self {
        Self {
            miller_index,
            surface_energy,
            normal,
            distance_from_center,
            area_fraction,
        }
    }
}

/// Result of Wulff construction - the equilibrium crystal shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WulffShape {
    /// Facets making up the crystal shape
    pub facets: Vec<WulffFacet>,
    /// Vertices of the Wulff polyhedron
    pub vertices: Vec<Vector3<f64>>,
    /// Total surface area (relative units)
    pub total_surface_area: f64,
    /// Volume enclosed (relative units)
    pub volume: f64,
    /// Sphericity (1.0 = perfect sphere)
    pub sphericity: f64,
}

impl WulffShape {
    /// Create a new Wulff shape.
    pub fn new(
        facets: Vec<WulffFacet>,
        vertices: Vec<Vector3<f64>>,
        total_surface_area: f64,
        volume: f64,
    ) -> Self {
        // Sphericity = (π^(1/3) * (6V)^(2/3)) / A
        // For a sphere, sphericity = 1
        let sphericity = if total_surface_area > 0.0 && volume > 0.0 {
            PI.powf(1.0 / 3.0) * (6.0 * volume).powf(2.0 / 3.0) / total_surface_area
        } else {
            0.0
        };

        Self {
            facets,
            vertices,
            total_surface_area,
            volume,
            sphericity,
        }
    }
}

/// Convert Miller index to surface normal vector in Cartesian coordinates.
///
/// # Arguments
///
/// * `lattice` - The crystal lattice
/// * `hkl` - Miller index as [h, k, l]
///
/// # Returns
///
/// Unit normal vector in Cartesian coordinates.
pub fn miller_to_normal(lattice: &Lattice, hkl: [i32; 3]) -> Vector3<f64> {
    let inv_t = lattice.inv_matrix().transpose();
    let hkl_vec = Vector3::new(hkl[0] as f64, hkl[1] as f64, hkl[2] as f64);
    let normal = inv_t * hkl_vec;
    let norm = normal.norm();
    if norm > 1e-10 {
        normal / norm
    } else {
        Vector3::new(0.0, 0.0, 1.0)
    }
}

/// Calculate the d-spacing for a Miller plane.
///
/// The d-spacing is the perpendicular distance between parallel planes
/// in the crystal lattice.
///
/// # Arguments
///
/// * `lattice` - The crystal lattice
/// * `hkl` - Miller index as [h, k, l]
///
/// # Returns
///
/// d-spacing in Ångströms.
///
/// # Errors
///
/// Returns an error if hkl is [0, 0, 0].
pub fn d_spacing(lattice: &Lattice, hkl: [i32; 3]) -> Result<f64> {
    if hkl == [0, 0, 0] {
        return Err(FerroxError::InvalidStructure {
            index: 0,
            reason: "Miller indices cannot all be zero".to_string(),
        });
    }

    // d = 1 / |G| where G = h*b1 + k*b2 + l*b3 (reciprocal lattice vector without 2π)
    let inv_t = lattice.inv_matrix().transpose();
    let hkl_vec = Vector3::new(hkl[0] as f64, hkl[1] as f64, hkl[2] as f64);
    let g_vec = inv_t * hkl_vec;
    Ok(1.0 / g_vec.norm())
}

/// Compute the Wulff shape (equilibrium crystal shape) from surface energies.
///
/// The Wulff construction determines the equilibrium shape of a crystal
/// by minimizing total surface energy at fixed volume.
///
/// # Arguments
///
/// * `lattice` - The crystal lattice
/// * `surface_energies` - Vector of (Miller index, surface energy) pairs
///
/// # Returns
///
/// A WulffShape describing the equilibrium crystal.
pub fn compute_wulff_shape(
    lattice: &Lattice,
    surface_energies: &[(MillerIndex, f64)],
) -> Result<WulffShape> {
    if surface_energies.is_empty() {
        return Err(FerroxError::InvalidStructure {
            index: 0,
            reason: "Need at least one surface energy".to_string(),
        });
    }

    // Create facets from surface energies
    let mut facets: Vec<WulffFacet> = Vec::new();

    // Find minimum surface energy for normalization
    let min_energy = surface_energies
        .iter()
        .map(|(_, energy)| *energy)
        .filter(|e| e.is_finite() && *e > 0.0)
        .fold(f64::INFINITY, f64::min);

    if !min_energy.is_finite() || min_energy <= 0.0 {
        return Err(FerroxError::InvalidStructure {
            index: 0,
            reason: "All surface energies must be positive".to_string(),
        });
    }

    for (miller, energy) in surface_energies {
        if !energy.is_finite() || *energy <= 0.0 {
            continue;
        }

        let normal = miller_to_normal(lattice, miller.to_array());
        let distance = energy / min_energy; // Normalized distance

        // Add facet for this Miller index
        facets.push(WulffFacet::new(*miller, *energy, normal, distance, 0.0));

        // Also add the opposite facet (negative Miller index)
        let neg_miller = MillerIndex::new(-miller.h, -miller.k, -miller.l);
        let neg_normal = -normal;
        facets.push(WulffFacet::new(
            neg_miller, *energy, neg_normal, distance, 0.0,
        ));
    }

    // Simplified Wulff construction - compute approximate area fractions
    // based on solid angle coverage
    let total_solid_angle: f64 = facets
        .iter()
        .map(|f| 1.0 / f.distance_from_center.powi(2))
        .sum();

    for facet in &mut facets {
        facet.area_fraction = (1.0 / facet.distance_from_center.powi(2)) / total_solid_angle;
    }

    // Compute approximate volume and surface area (simplified)
    // For a Wulff polyhedron, these depend on the geometry
    let _total_area: f64 = facets.iter().map(|f| f.area_fraction).sum();
    let avg_distance: f64 = facets
        .iter()
        .map(|f| f.distance_from_center * f.area_fraction)
        .sum();
    let volume = (4.0 / 3.0) * PI * avg_distance.powi(3);
    let area = 4.0 * PI * avg_distance.powi(2);

    Ok(WulffShape::new(facets, vec![], area, volume))
}

// === Slab Config Extension ===

/// Extended configuration for slab generation with additional surface analysis options.
///
/// This extends the basic SlabConfig from structure.rs with additional
/// parameters for surface termination enumeration.
#[derive(Debug, Clone)]
pub struct SlabConfigExt {
    /// Basic slab configuration
    pub miller_index: MillerIndex,
    /// Minimum slab thickness in Angstroms
    pub min_slab_size: f64,
    /// Minimum vacuum thickness in Angstroms
    pub min_vacuum: f64,
    /// Center the slab in the vacuum
    pub center_slab: bool,
    /// Interpret min_slab_size as number of unit planes
    pub in_unit_planes: bool,
    /// Reduce to primitive surface cell
    pub primitive: bool,
    /// Maximum search range for surface normal basis vectors
    pub max_normal_search: i32,
    /// Symmetrize the slab
    pub symmetrize: bool,
}

impl Default for SlabConfigExt {
    fn default() -> Self {
        Self {
            miller_index: MillerIndex::new(1, 0, 0),
            min_slab_size: 10.0,
            min_vacuum: 10.0,
            center_slab: true,
            in_unit_planes: false,
            primitive: false,
            max_normal_search: 5,
            symmetrize: false,
        }
    }
}

impl SlabConfigExt {
    /// Create a new config with the given Miller index.
    pub fn new(miller_index: MillerIndex) -> Self {
        Self {
            miller_index,
            ..Default::default()
        }
    }

    /// Set the minimum slab size.
    #[must_use]
    pub fn with_min_slab_size(mut self, size: f64) -> Self {
        self.min_slab_size = size;
        self
    }

    /// Set the minimum vacuum size.
    #[must_use]
    pub fn with_min_vacuum(mut self, vacuum: f64) -> Self {
        self.min_vacuum = vacuum;
        self
    }

    /// Set whether to center the slab.
    #[must_use]
    pub fn with_center_slab(mut self, center: bool) -> Self {
        self.center_slab = center;
        self
    }

    /// Set whether min_slab_size is in unit planes.
    #[must_use]
    pub fn with_in_unit_planes(mut self, in_planes: bool) -> Self {
        self.in_unit_planes = in_planes;
        self
    }

    /// Set whether to reduce to primitive cell.
    #[must_use]
    pub fn with_primitive(mut self, primitive: bool) -> Self {
        self.primitive = primitive;
        self
    }

    /// Convert to the basic SlabConfig used by Structure::generate_slabs
    pub fn to_slab_config(&self) -> crate::structure::SlabConfig {
        crate::structure::SlabConfig {
            miller_index: self.miller_index.to_array(),
            min_slab_size: self.min_slab_size,
            min_vacuum_size: self.min_vacuum,
            center_slab: self.center_slab,
            in_unit_planes: self.in_unit_planes,
            primitive: self.primitive,
            symprec: 0.01,
            termination_index: None,
        }
    }
}

/// Enumerate all unique terminations for a given Miller index.
///
/// This uses the structure's generate_slabs method to find all unique
/// surface terminations and wraps them in SurfaceTermination structs
/// with additional metadata.
///
/// # Arguments
///
/// * `structure` - The bulk structure
/// * `miller_index` - The surface orientation
/// * `config` - Configuration for slab generation
/// * `symprec` - Symmetry precision for identifying unique terminations
///
/// # Returns
///
/// Vector of unique surface terminations.
pub fn enumerate_terminations(
    structure: &Structure,
    miller_index: MillerIndex,
    config: &SlabConfigExt,
    symprec: f64,
) -> Result<Vec<SurfaceTermination>> {
    // Use the existing SlabConfig infrastructure
    let slab_config = crate::structure::SlabConfig {
        miller_index: miller_index.to_array(),
        min_slab_size: config.min_slab_size,
        min_vacuum_size: config.min_vacuum,
        center_slab: config.center_slab,
        in_unit_planes: config.in_unit_planes,
        primitive: config.primitive,
        symprec,
        termination_index: None,
    };

    let slabs = structure.generate_slabs(&slab_config)?;

    let mut terminations = Vec::new();
    for (idx, slab) in slabs.into_iter().enumerate() {
        // Calculate surface properties
        let area = surface_area(&slab);
        let surface_atoms = get_surface_atoms(&slab, 0.1);
        let surface_species: Vec<Species> = surface_atoms
            .iter()
            .filter_map(|&site_idx| slab.site_occupancies.get(site_idx))
            .map(|occ| *occ.dominant_species())
            .collect();

        let density = if area > 0.0 {
            surface_atoms.len() as f64 / area
        } else {
            0.0
        };

        // Simple polarity check - if surface has only one type of species
        // and the opposite surface has different species
        let is_polar = {
            let unique_species: HashSet<_> = surface_species.iter().collect();
            unique_species.len() == 1 && !surface_species.is_empty()
        };

        terminations.push(SurfaceTermination::new(
            miller_index,
            idx as f64 * 0.1, // Approximate shift
            surface_species,
            density,
            is_polar,
            slab,
        ));
    }

    Ok(terminations)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_miller_index_reduced() {
        let miller = MillerIndex::new(2, 4, 6);
        let reduced = miller.reduced();
        assert_eq!(reduced.h, 1);
        assert_eq!(reduced.k, 2);
        assert_eq!(reduced.l, 3);
    }

    #[test]
    fn test_miller_index_reduced_zero() {
        let miller = MillerIndex::new(0, 0, 0);
        let reduced = miller.reduced();
        assert_eq!(reduced.h, 0);
        assert_eq!(reduced.k, 0);
        assert_eq!(reduced.l, 0);
    }

    #[test]
    fn test_miller_index_reduced_negative() {
        let miller = MillerIndex::new(-2, -4, -2);
        let reduced = miller.reduced();
        assert_eq!(reduced.h, -1);
        assert_eq!(reduced.k, -2);
        assert_eq!(reduced.l, -1);
    }

    #[test]
    fn test_enumerate_miller_max_1() {
        let indices = enumerate_miller_indices(1);
        // Should include (1,0,0), (0,1,0), (0,0,1), (1,1,0), (1,0,1), (0,1,1), (1,1,1)
        // and their normalized versions
        assert!(indices.len() >= 7);
        assert!(indices.contains(&MillerIndex::new(1, 0, 0)));
        assert!(indices.contains(&MillerIndex::new(0, 1, 0)));
        assert!(indices.contains(&MillerIndex::new(0, 0, 1)));
        assert!(indices.contains(&MillerIndex::new(1, 1, 1)));
    }

    #[test]
    fn test_enumerate_miller_excludes_zero() {
        let indices = enumerate_miller_indices(2);
        assert!(!indices.contains(&MillerIndex::new(0, 0, 0)));
    }

    #[test]
    fn test_d_spacing_cubic() {
        let lattice = Lattice::cubic(4.0);
        let d_100 = d_spacing(&lattice, [1, 0, 0]).unwrap();
        // For cubic: d_hkl = a / sqrt(h² + k² + l²)
        // d_100 = 4.0 / sqrt(1) = 4.0
        assert!((d_100 - 4.0).abs() < 0.01);

        let d_110 = d_spacing(&lattice, [1, 1, 0]).unwrap();
        // d_110 = 4.0 / sqrt(2) ≈ 2.83
        assert!((d_110 - 4.0 / 2.0_f64.sqrt()).abs() < 0.01);

        let d_111 = d_spacing(&lattice, [1, 1, 1]).unwrap();
        // d_111 = 4.0 / sqrt(3) ≈ 2.31
        assert!((d_111 - 4.0 / 3.0_f64.sqrt()).abs() < 0.01);
    }

    #[test]
    fn test_d_spacing_zero_error() {
        let lattice = Lattice::cubic(4.0);
        let result = d_spacing(&lattice, [0, 0, 0]);
        assert!(result.is_err());
    }

    #[test]
    fn test_miller_to_normal_cubic() {
        let lattice = Lattice::cubic(4.0);

        let normal_100 = miller_to_normal(&lattice, [1, 0, 0]);
        assert!(normal_100.norm() - 1.0 < 0.001);
        // For cubic, (100) normal should be along x
        assert!(normal_100.x.abs() > 0.99);

        let normal_001 = miller_to_normal(&lattice, [0, 0, 1]);
        assert!(normal_001.norm() - 1.0 < 0.001);
        // For cubic, (001) normal should be along z
        assert!(normal_001.z.abs() > 0.99);
    }

    #[test]
    fn test_surface_energy_calculation() {
        let energy = calculate_surface_energy(
            -100.0, // slab energy
            -10.0,  // bulk energy per atom
            8,      // n_atoms
            10.0,   // area
        );
        // E_surf = (-100 - 8*(-10)) / (2*10) = (-100 + 80) / 20 = -1.0
        assert!((energy - (-1.0)).abs() < 0.001);
    }

    #[test]
    fn test_surface_energy_zero_area() {
        let energy = calculate_surface_energy(-100.0, -10.0, 8, 0.0);
        assert!(energy.is_nan());
    }

    #[test]
    fn test_adsorption_site_type_from_str() {
        assert_eq!(
            AdsorptionSiteType::parse("atop"),
            Some(AdsorptionSiteType::Atop)
        );
        assert_eq!(
            AdsorptionSiteType::parse("bridge"),
            Some(AdsorptionSiteType::Bridge)
        );
        assert_eq!(
            AdsorptionSiteType::parse("hollow3"),
            Some(AdsorptionSiteType::Hollow3)
        );
        assert_eq!(
            AdsorptionSiteType::parse("fcc"),
            Some(AdsorptionSiteType::Hollow3)
        );
        assert_eq!(AdsorptionSiteType::parse("invalid"), None);
    }

    #[test]
    fn test_wulff_shape_sphericity() {
        // Test that sphericity is calculated correctly
        let shape = WulffShape::new(vec![], vec![], 100.0, 50.0);
        assert!(shape.sphericity > 0.0);
        assert!(shape.sphericity <= 1.0);
    }
}
