//! TypeScript-compatible types for WASM bindings using `tsify`.
//! All types match pymatgen's JSON structure for interoperability.

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;

/// Result wrapper that serializes to `{ ok: T }` on success or `{ error: string }` on failure.
/// TypeScript: `WasmResult<T> = { ok: T } | { error: string }`
#[derive(Debug, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
#[serde(untagged)]
pub enum WasmResult<T> {
    /// Success variant
    Ok {
        /// The successful result value
        ok: T,
    },
    /// Error variant
    Err {
        /// Error message describing what went wrong
        error: String,
    },
}

impl<T> WasmResult<T> {
    /// Create a success result
    pub fn ok(value: T) -> Self {
        WasmResult::Ok { ok: value }
    }

    /// Create an error result
    pub fn err(msg: impl Into<String>) -> Self {
        WasmResult::Err { error: msg.into() }
    }
}

impl<T, E: std::fmt::Display> From<Result<T, E>> for WasmResult<T> {
    fn from(result: Result<T, E>) -> Self {
        match result {
            Ok(value) => WasmResult::ok(value),
            Err(err) => WasmResult::err(err.to_string()),
        }
    }
}

// === Vector and Matrix Types ===

/// 3x3 matrix represented as nested arrays (row-major).
pub type Matrix3x3 = [[f64; 3]; 3];

/// 3x3 integer matrix for supercell transformations.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsIntMatrix3x3(pub [[i32; 3]; 3]);

/// 3D vector of floats.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsVector3(pub [f64; 3]);

/// Miller index (3D integer vector).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsMillerIndex(pub [i32; 3]);

/// 3x3 float matrix for transformations.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsMatrix3x3(pub [[f64; 3]; 3]);

/// Lattice structure matching pymatgen's JSON format.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsLattice {
    /// 3x3 lattice matrix with lattice vectors as rows (Ångströms)
    pub matrix: Matrix3x3,
    /// Periodic boundary conditions along each axis
    #[serde(default = "default_pbc")]
    pub pbc: [bool; 3],
}

fn default_pbc() -> [bool; 3] {
    [true, true, true]
}

// === Species Types ===

/// Species occupancy at a site (element + occupancy + optional oxidation state).
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsSpeciesOccupancy {
    /// Element symbol (e.g., "Fe", "O", "Li")
    pub element: String,
    /// Site occupancy (0.0 to 1.0, typically 1.0 for ordered sites)
    #[serde(default = "default_occupancy")]
    pub occu: f64,
    /// Optional oxidation state (e.g., 2 for Fe²⁺, -2 for O²⁻)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oxidation_state: Option<i8>,
}

fn default_occupancy() -> f64 {
    1.0
}

// === Site Types ===

/// A crystallographic site with species, coordinates, and properties.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsSite {
    /// Species at this site (can have multiple for disordered sites)
    pub species: Vec<JsSpeciesOccupancy>,
    /// Fractional coordinates [a, b, c] in range [0, 1)
    pub abc: [f64; 3],
    /// Cartesian coordinates [x, y, z] in Ångströms (optional, computed if missing)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xyz: Option<[f64; 3]>,
    /// Site label (defaults to element symbol)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Site-specific properties (e.g., magnetic moment, charge)
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub properties: serde_json::Map<String, serde_json::Value>,
}

// === Structure Types ===

/// A crystal structure matching pymatgen's JSON format.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsCrystal {
    /// The crystal lattice
    pub lattice: JsLattice,
    /// List of crystallographic sites
    pub sites: Vec<JsSite>,
    /// Structure-level properties
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub properties: serde_json::Map<String, serde_json::Value>,
}

// === Neighbor List Types ===

/// Result of neighbor list calculation.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsNeighborList {
    /// Indices of center atoms
    pub center_indices: Vec<u32>,
    /// Indices of neighbor atoms
    pub neighbor_indices: Vec<u32>,
    /// Periodic image offsets [h, k, l] for each neighbor
    pub image_offsets: Vec<[i32; 3]>,
    /// Distances from center to neighbor (Ångströms)
    pub distances: Vec<f64>,
}

// === RMS Distance Types ===

/// Result of RMS distance calculation between two structures.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsRmsDistResult {
    /// Root mean square distance between matched sites (Ångströms)
    pub rms: f64,
    /// Maximum distance between any pair of matched sites (Ångströms)
    pub max_dist: f64,
}

// === Symmetry Types ===

/// A symmetry operation (rotation + translation in fractional coordinates).
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsSymmetryOperation {
    /// 3x3 rotation matrix (integer elements in fractional basis)
    pub rotation: [[i32; 3]; 3],
    /// Translation vector in fractional coordinates
    pub translation: [f64; 3],
}

/// Full symmetry dataset for a structure.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsSymmetryDataset {
    /// International space group number (1-230)
    pub spacegroup_number: u16,
    /// Space group symbol (e.g., "Fm-3m")
    pub spacegroup_symbol: String,
    /// Hall number
    pub hall_number: u16,
    /// Crystal system (e.g., "cubic", "hexagonal")
    pub crystal_system: String,
    /// Wyckoff letters for each site
    pub wyckoff_letters: Vec<String>,
    /// Site symmetry symbols for each site
    pub site_symmetry_symbols: Vec<String>,
    /// Equivalent atoms mapping
    pub equivalent_atoms: Vec<u32>,
    /// Symmetry operations
    pub operations: Vec<JsSymmetryOperation>,
}

// === Coordination Types ===

/// Information about a neighboring atom in coordination analysis.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsNeighborInfo {
    /// Index of the neighboring site
    pub site_index: u32,
    /// Element symbol of neighbor
    pub element: String,
    /// Distance to neighbor (Ångströms)
    pub distance: f64,
    /// Periodic image offset
    pub image: [i32; 3],
}

/// Local coordination environment for a site.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsLocalEnvironment {
    /// Index of the central site
    pub center_index: u32,
    /// Element at the center
    pub center_element: String,
    /// Coordination number
    pub coordination_number: u32,
    /// List of coordinating neighbors
    pub neighbors: Vec<JsNeighborInfo>,
}

// === Structure Metadata Types ===

/// Metadata about a crystal structure.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsStructureMetadata {
    /// Number of sites
    pub num_sites: u32,
    /// Reduced chemical formula (e.g., "Fe2O3")
    pub formula: String,
    /// Anonymous formula with elements replaced by A, B, C... (e.g., "A2B3")
    pub formula_anonymous: String,
    /// Hill notation formula (C and H first if present, then alphabetical)
    pub formula_hill: String,
    /// Volume in Å³
    pub volume: f64,
    /// Density in g/cm³ (null if zero volume)
    pub density: Option<f64>,
    /// Lattice parameters [a, b, c] in Ångströms
    pub lattice_params: [f64; 3],
    /// Lattice angles [alpha, beta, gamma] in degrees
    pub lattice_angles: [f64; 3],
    /// Whether structure is ordered (no partial occupancies)
    pub is_ordered: bool,
}

// === Reduction Algorithm Enum ===

/// Lattice reduction algorithm.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "lowercase")]
pub enum JsReductionAlgo {
    /// Niggli reduction - produces unique reduced cell
    Niggli,
    /// LLL reduction - produces nearly orthogonal basis
    Lll,
}

// === Conversion Utilities ===

use crate::element::Element;
use crate::lattice::Lattice;
use crate::species::{SiteOccupancy, Species};
use crate::structure::Structure;
use nalgebra::Vector3;
use std::collections::HashMap;

impl JsCrystal {
    /// Convert from internal Structure type to JS-compatible type
    pub fn from_structure(structure: &Structure) -> Self {
        let mat = structure.lattice.matrix();
        let cart_coords = structure.cart_coords();

        let sites: Vec<JsSite> = structure
            .site_occupancies
            .iter()
            .zip(structure.frac_coords.iter())
            .zip(cart_coords.iter())
            .enumerate()
            .map(|(site_idx, ((site_occ, frac_coord), cart_coord))| {
                let species: Vec<JsSpeciesOccupancy> = site_occ
                    .species
                    .iter()
                    .map(|(species_item, occupancy)| JsSpeciesOccupancy {
                        element: species_item.element.symbol().to_string(),
                        occu: *occupancy,
                        oxidation_state: species_item.oxidation_state,
                    })
                    .collect();

                let site_props = structure.site_properties(site_idx);
                let properties: serde_json::Map<String, serde_json::Value> = site_props
                    .iter()
                    .map(|(key, val)| (key.clone(), val.clone()))
                    .collect();

                JsSite {
                    species,
                    abc: [frac_coord.x, frac_coord.y, frac_coord.z],
                    xyz: Some([cart_coord.x, cart_coord.y, cart_coord.z]),
                    label: Some(site_occ.species_string()),
                    properties,
                }
            })
            .collect();

        let properties: serde_json::Map<String, serde_json::Value> = structure
            .properties
            .iter()
            .map(|(key, val)| (key.clone(), val.clone()))
            .collect();

        JsCrystal {
            lattice: JsLattice {
                matrix: [
                    [mat[(0, 0)], mat[(0, 1)], mat[(0, 2)]],
                    [mat[(1, 0)], mat[(1, 1)], mat[(1, 2)]],
                    [mat[(2, 0)], mat[(2, 1)], mat[(2, 2)]],
                ],
                pbc: structure.lattice.pbc,
            },
            sites,
            properties,
        }
    }

    /// Convert to internal Structure type
    pub fn to_structure(&self) -> Result<Structure, String> {
        let m = &self.lattice.matrix;
        let lattice_matrix = nalgebra::Matrix3::from_row_slice(&[
            m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2],
        ]);
        let mut lattice = Lattice::new(lattice_matrix);
        lattice.pbc = self.lattice.pbc;

        let mut site_occupancies = Vec::with_capacity(self.sites.len());
        let mut frac_coords = Vec::with_capacity(self.sites.len());

        for (site_idx, site) in self.sites.iter().enumerate() {
            if site.species.is_empty() {
                return Err(format!("Site {site_idx} has no species"));
            }

            let species: Vec<(Species, f64)> = site
                .species
                .iter()
                .map(|species_occ| {
                    let element = Element::from_symbol(&species_occ.element)
                        .ok_or_else(|| format!("Unknown element: {}", species_occ.element))?;
                    let species = if let Some(oxi) = species_occ.oxidation_state {
                        Species::new(element, Some(oxi))
                    } else {
                        Species::neutral(element)
                    };
                    Ok((species, species_occ.occu))
                })
                .collect::<Result<Vec<_>, String>>()?;

            // Convert site properties from serde_json::Map to HashMap
            let site_props: HashMap<String, serde_json::Value> = site
                .properties
                .iter()
                .map(|(key, val)| (key.clone(), val.clone()))
                .collect();

            site_occupancies.push(SiteOccupancy {
                species,
                properties: site_props,
            });
            frac_coords.push(Vector3::new(site.abc[0], site.abc[1], site.abc[2]));
        }

        let properties: HashMap<String, serde_json::Value> = self
            .properties
            .iter()
            .map(|(key, val)| (key.clone(), val.clone()))
            .collect();

        Structure::try_new_from_occupancies_with_properties(
            lattice,
            site_occupancies,
            frac_coords,
            properties,
        )
        .map_err(|err| err.to_string())
    }
}

impl JsReductionAlgo {
    /// Convert to internal ReductionAlgo type
    pub fn to_internal(&self) -> crate::structure::ReductionAlgo {
        match self {
            JsReductionAlgo::Niggli => crate::structure::ReductionAlgo::Niggli,
            JsReductionAlgo::Lll => crate::structure::ReductionAlgo::LLL,
        }
    }
}
