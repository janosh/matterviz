//! WASM bindings for ferrox types.
//!
//! This module provides JavaScript-accessible wrappers for Element, Species,
//! Structure, and StructureMatcher types via wasm-bindgen.
//!
//! All structure functions accept and return JS values that can be serialized
//! with serde. Results are returned as `{ ok: T }` or `{ error: string }`.

use std::path::Path;

use nalgebra::Vector3;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::cif::parse_cif_str;
use crate::element::Element;
use crate::io::{parse_poscar_str, parse_structure_json, structure_to_pymatgen_json};
use crate::matcher::{ComparatorType, StructureMatcher};
use crate::species::Species;
use crate::structure::{ReductionAlgo, Structure};

// =============================================================================
// Result Type for WASM (matches TypeScript WasmResult<T>)
// =============================================================================

/// Result wrapper that serializes to { ok: T } | { error: string }
#[derive(Serialize)]
#[serde(untagged)]
enum WasmResult<T: Serialize> {
    Ok { ok: T },
    Err { error: String },
}

impl<T: Serialize> WasmResult<T> {
    fn ok(value: T) -> Self {
        WasmResult::Ok { ok: value }
    }

    fn err(msg: impl Into<String>) -> Self {
        WasmResult::Err { error: msg.into() }
    }
}

/// Convert a Result to WasmResult
fn to_wasm_result<T: Serialize, E: std::fmt::Display>(result: Result<T, E>) -> WasmResult<T> {
    match result {
        Ok(value) => WasmResult::ok(value),
        Err(e) => WasmResult::err(e.to_string()),
    }
}

/// Serialize WasmResult to JsValue
fn serialize_result<T: Serialize>(result: WasmResult<T>) -> JsValue {
    serde_wasm_bindgen::to_value(&result).unwrap_or_else(|e| {
        let err: WasmResult<()> = WasmResult::err(format!("Serialization error: {e}"));
        serde_wasm_bindgen::to_value(&err).unwrap()
    })
}

// =============================================================================
// Structure Parsing Helpers
// =============================================================================

/// Parse a JS value as a Structure (from pymatgen-style JSON object)
fn parse_structure_from_js(value: &JsValue) -> Result<Structure, String> {
    let json_str = js_sys::JSON::stringify(value)
        .map_err(|_| "Failed to stringify JS value")?
        .as_string()
        .ok_or("Failed to convert to string")?;
    parse_structure_json(&json_str).map_err(|e| e.to_string())
}

/// Convert Structure to JS value (pymatgen-style JSON object)
fn structure_to_js(structure: &Structure) -> Result<JsValue, String> {
    let json_str = structure_to_pymatgen_json(structure);
    let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
    serde_wasm_bindgen::to_value(&parsed).map_err(|e| e.to_string())
}

/// Parse a JS array of structures
fn parse_js_array(arr: &JsValue) -> Result<Vec<Structure>, String> {
    js_sys::Array::from(arr)
        .iter()
        .map(|item| parse_structure_from_js(&item))
        .collect()
}

// =============================================================================
// Neighbor List Result Type
// =============================================================================

#[derive(Serialize)]
struct NeighborListResult {
    center_indices: Vec<usize>,
    neighbor_indices: Vec<usize>,
    image_offsets: Vec<[i32; 3]>,
    distances: Vec<f64>,
}

// =============================================================================
// RMS Distance Result Type
// =============================================================================

#[derive(Serialize)]
struct RmsDistResult {
    rms: f64,
    max_dist: f64,
}

// =============================================================================
// Element WASM bindings
// =============================================================================

/// JavaScript-accessible Element wrapper.
#[wasm_bindgen]
pub struct JsElement {
    inner: Element,
}

#[wasm_bindgen]
impl JsElement {
    /// Create an element from its symbol (e.g., "Fe", "O", "Na").
    ///
    /// Also accepts pseudo-elements: "D" (Deuterium), "T" (Tritium),
    /// and "X"/"Dummy"/"Vac" (placeholder atom).
    #[wasm_bindgen(constructor)]
    pub fn new(symbol: &str) -> Result<JsElement, JsError> {
        Element::from_symbol(symbol)
            .map(|e| JsElement { inner: e })
            .ok_or_else(|| JsError::new(&format!("Unknown element symbol: {symbol}")))
    }

    /// Create an element from its atomic number.
    ///
    /// Accepts 1-118 for real elements, plus pseudo-elements:
    /// - 119: Dummy (placeholder atom)
    /// - 120: D (Deuterium)
    /// - 121: T (Tritium)
    #[wasm_bindgen(js_name = "fromAtomicNumber")]
    pub fn from_atomic_number(z: u8) -> Result<JsElement, JsError> {
        Element::from_atomic_number(z)
            .map(|e| JsElement { inner: e })
            .ok_or_else(|| JsError::new(&format!("Invalid atomic number: {z} (valid: 1-121)")))
    }

    /// Get the element symbol.
    #[wasm_bindgen(getter)]
    pub fn symbol(&self) -> String {
        self.inner.symbol().to_string()
    }

    /// Get the atomic number.
    #[wasm_bindgen(getter, js_name = "atomicNumber")]
    pub fn atomic_number(&self) -> u8 {
        self.inner.atomic_number()
    }

    /// Get the full element name.
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.inner.name().to_string()
    }

    /// Get the atomic mass in atomic mass units.
    #[wasm_bindgen(getter, js_name = "atomicMass")]
    pub fn atomic_mass(&self) -> f64 {
        self.inner.atomic_mass()
    }

    /// Get the Pauling electronegativity (or NaN if not defined).
    #[wasm_bindgen(getter)]
    pub fn electronegativity(&self) -> f64 {
        self.inner.electronegativity().unwrap_or(f64::NAN)
    }

    /// Get the periodic table row (1-7).
    #[wasm_bindgen(getter)]
    pub fn row(&self) -> u8 {
        self.inner.row()
    }

    /// Get the periodic table group (1-18).
    #[wasm_bindgen(getter)]
    pub fn group(&self) -> u8 {
        self.inner.group()
    }

    /// Get the periodic table block ("S", "P", "D", or "F").
    #[wasm_bindgen(getter)]
    pub fn block(&self) -> String {
        self.inner.block().as_str().to_string()
    }

    /// Get atomic radius in Angstroms (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "atomicRadius")]
    pub fn atomic_radius(&self) -> f64 {
        self.inner.atomic_radius().unwrap_or(f64::NAN)
    }

    /// Get covalent radius in Angstroms (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "covalentRadius")]
    pub fn covalent_radius(&self) -> f64 {
        self.inner.covalent_radius().unwrap_or(f64::NAN)
    }

    // Classification methods

    /// Check if element is a noble gas.
    #[wasm_bindgen(js_name = "isNobleGas")]
    pub fn is_noble_gas(&self) -> bool {
        self.inner.is_noble_gas()
    }

    /// Check if element is an alkali metal.
    #[wasm_bindgen(js_name = "isAlkali")]
    pub fn is_alkali(&self) -> bool {
        self.inner.is_alkali()
    }

    /// Check if element is an alkaline earth metal.
    #[wasm_bindgen(js_name = "isAlkaline")]
    pub fn is_alkaline(&self) -> bool {
        self.inner.is_alkaline()
    }

    /// Check if element is a halogen.
    #[wasm_bindgen(js_name = "isHalogen")]
    pub fn is_halogen(&self) -> bool {
        self.inner.is_halogen()
    }

    /// Check if element is a chalcogen.
    #[wasm_bindgen(js_name = "isChalcogen")]
    pub fn is_chalcogen(&self) -> bool {
        self.inner.is_chalcogen()
    }

    /// Check if element is a lanthanoid.
    #[wasm_bindgen(js_name = "isLanthanoid")]
    pub fn is_lanthanoid(&self) -> bool {
        self.inner.is_lanthanoid()
    }

    /// Check if element is an actinoid.
    #[wasm_bindgen(js_name = "isActinoid")]
    pub fn is_actinoid(&self) -> bool {
        self.inner.is_actinoid()
    }

    /// Check if element is a transition metal.
    #[wasm_bindgen(js_name = "isTransitionMetal")]
    pub fn is_transition_metal(&self) -> bool {
        self.inner.is_transition_metal()
    }

    /// Check if element is a post-transition metal.
    #[wasm_bindgen(js_name = "isPostTransitionMetal")]
    pub fn is_post_transition_metal(&self) -> bool {
        self.inner.is_post_transition_metal()
    }

    /// Check if element is a metalloid.
    #[wasm_bindgen(js_name = "isMetalloid")]
    pub fn is_metalloid(&self) -> bool {
        self.inner.is_metalloid()
    }

    /// Check if element is a metal.
    #[wasm_bindgen(js_name = "isMetal")]
    pub fn is_metal(&self) -> bool {
        self.inner.is_metal()
    }

    /// Check if element is radioactive.
    #[wasm_bindgen(js_name = "isRadioactive")]
    pub fn is_radioactive(&self) -> bool {
        self.inner.is_radioactive()
    }

    /// Check if element is a rare earth element.
    #[wasm_bindgen(js_name = "isRareEarth")]
    pub fn is_rare_earth(&self) -> bool {
        self.inner.is_rare_earth()
    }

    /// Check if this is a pseudo-element (Dummy, D, T).
    #[wasm_bindgen(js_name = "isPseudo")]
    pub fn is_pseudo(&self) -> bool {
        self.inner.is_pseudo()
    }

    /// Get oxidation states as a JavaScript array.
    #[wasm_bindgen(js_name = "oxidationStates")]
    pub fn oxidation_states(&self) -> Vec<i8> {
        self.inner.oxidation_states().to_vec()
    }

    /// Get common oxidation states as a JavaScript array.
    #[wasm_bindgen(js_name = "commonOxidationStates")]
    pub fn common_oxidation_states(&self) -> Vec<i8> {
        self.inner.common_oxidation_states().to_vec()
    }

    /// Get ICSD oxidation states (with at least 10 instances in ICSD) as a JavaScript array.
    #[wasm_bindgen(js_name = "icsdOxidationStates")]
    pub fn icsd_oxidation_states(&self) -> Vec<i8> {
        self.inner.icsd_oxidation_states().to_vec()
    }

    /// Get maximum oxidation state (or 0 if none).
    #[wasm_bindgen(getter, js_name = "maxOxidationState")]
    pub fn max_oxidation_state(&self) -> i8 {
        self.inner.max_oxidation_state().unwrap_or(0)
    }

    /// Get minimum oxidation state (or 0 if none).
    #[wasm_bindgen(getter, js_name = "minOxidationState")]
    pub fn min_oxidation_state(&self) -> i8 {
        self.inner.min_oxidation_state().unwrap_or(0)
    }

    /// Get ionic radius for a specific oxidation state (or NaN if not defined).
    #[wasm_bindgen(js_name = "ionicRadius")]
    pub fn ionic_radius(&self, oxidation_state: i8) -> f64 {
        self.inner.ionic_radius(oxidation_state).unwrap_or(f64::NAN)
    }

    /// Get Shannon ionic radius (or NaN if not defined).
    #[wasm_bindgen(js_name = "shannonIonicRadius")]
    pub fn shannon_ionic_radius(&self, oxidation_state: i8, coordination: &str, spin: &str) -> f64 {
        self.inner
            .shannon_ionic_radius(oxidation_state, coordination, spin)
            .unwrap_or(f64::NAN)
    }
}

// =============================================================================
// Species WASM bindings
// =============================================================================

/// JavaScript-accessible Species wrapper.
#[wasm_bindgen]
pub struct JsSpecies {
    inner: Species,
}

#[wasm_bindgen]
impl JsSpecies {
    /// Create a species from a string like "Fe2+", "O2-", "Na+".
    #[wasm_bindgen(constructor)]
    pub fn new(species_str: &str) -> Result<JsSpecies, JsError> {
        Species::from_string(species_str)
            .map(|s| JsSpecies { inner: s })
            .ok_or_else(|| JsError::new(&format!("Invalid species string: {species_str}")))
    }

    /// Get the element symbol.
    #[wasm_bindgen(getter)]
    pub fn symbol(&self) -> String {
        self.inner.element.symbol().to_string()
    }

    /// Get the element's atomic number.
    #[wasm_bindgen(getter, js_name = "atomicNumber")]
    pub fn atomic_number(&self) -> u8 {
        self.inner.element.atomic_number()
    }

    /// Get the oxidation state (or null/undefined if not set).
    #[wasm_bindgen(getter, js_name = "oxidationState")]
    pub fn oxidation_state(&self) -> Option<i8> {
        self.inner.oxidation_state
    }

    /// Get the species string representation (e.g., "Fe2+").
    #[wasm_bindgen(js_name = "toString")]
    pub fn to_string_js(&self) -> String {
        self.inner.to_string()
    }

    /// Get ionic radius for this species' oxidation state (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "ionicRadius")]
    pub fn ionic_radius(&self) -> f64 {
        self.inner.ionic_radius().unwrap_or(f64::NAN)
    }

    /// Get atomic radius (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "atomicRadius")]
    pub fn atomic_radius(&self) -> f64 {
        self.inner.atomic_radius().unwrap_or(f64::NAN)
    }

    /// Get electronegativity (or NaN if not defined).
    #[wasm_bindgen(getter)]
    pub fn electronegativity(&self) -> f64 {
        self.inner.electronegativity().unwrap_or(f64::NAN)
    }

    /// Get Shannon ionic radius with coordination and spin (or NaN if not defined).
    #[wasm_bindgen(js_name = "shannonIonicRadius")]
    pub fn shannon_ionic_radius(&self, coordination: &str, spin: &str) -> f64 {
        self.inner
            .shannon_ionic_radius(coordination, spin)
            .unwrap_or(f64::NAN)
    }

    /// Get covalent radius (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "covalentRadius")]
    pub fn covalent_radius(&self) -> f64 {
        self.inner.covalent_radius().unwrap_or(f64::NAN)
    }

    /// Get the element's full name (e.g., "Iron" for Fe).
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.inner.name().to_string()
    }
}

// =============================================================================
// StructureMatcher WASM bindings
// =============================================================================

/// JavaScript-accessible StructureMatcher wrapper with builder pattern.
#[wasm_bindgen]
pub struct WasmStructureMatcher {
    inner: StructureMatcher,
}

#[wasm_bindgen]
impl WasmStructureMatcher {
    /// Create a new StructureMatcher with default settings.
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmStructureMatcher {
        WasmStructureMatcher {
            inner: StructureMatcher::new(),
        }
    }

    /// Set the lattice length tolerance (fractional).
    #[wasm_bindgen]
    pub fn with_latt_len_tol(mut self, tol: f64) -> WasmStructureMatcher {
        self.inner = self.inner.with_latt_len_tol(tol);
        self
    }

    /// Set the site position tolerance (normalized).
    #[wasm_bindgen]
    pub fn with_site_pos_tol(mut self, tol: f64) -> WasmStructureMatcher {
        self.inner = self.inner.with_site_pos_tol(tol);
        self
    }

    /// Set the angle tolerance (degrees).
    #[wasm_bindgen]
    pub fn with_angle_tol(mut self, tol: f64) -> WasmStructureMatcher {
        self.inner = self.inner.with_angle_tol(tol);
        self
    }

    /// Set whether to reduce to primitive cell before matching.
    #[wasm_bindgen]
    pub fn with_primitive_cell(mut self, val: bool) -> WasmStructureMatcher {
        self.inner = self.inner.with_primitive_cell(val);
        self
    }

    /// Set whether to scale volumes to match.
    #[wasm_bindgen]
    pub fn with_scale(mut self, val: bool) -> WasmStructureMatcher {
        self.inner = self.inner.with_scale(val);
        self
    }

    /// Set whether to use element-only comparison (ignores oxidation states).
    #[wasm_bindgen]
    pub fn with_element_comparator(mut self, val: bool) -> WasmStructureMatcher {
        let comparator = if val {
            ComparatorType::Element
        } else {
            ComparatorType::Species
        };
        self.inner = self.inner.with_comparator(comparator);
        self
    }

    /// Check if two structures match.
    #[wasm_bindgen]
    pub fn fit(&self, struct1: &JsValue, struct2: &JsValue) -> JsValue {
        let result: Result<bool, String> = (|| {
            let s1 = parse_structure_from_js(struct1)?;
            let s2 = parse_structure_from_js(struct2)?;
            Ok(self.inner.fit(&s1, &s2))
        })();
        serialize_result(to_wasm_result(result))
    }

    /// Check if two structures match under any species permutation.
    #[wasm_bindgen]
    pub fn fit_anonymous(&self, struct1: &JsValue, struct2: &JsValue) -> JsValue {
        let result: Result<bool, String> = (|| {
            let s1 = parse_structure_from_js(struct1)?;
            let s2 = parse_structure_from_js(struct2)?;
            Ok(self.inner.fit_anonymous(&s1, &s2))
        })();
        serialize_result(to_wasm_result(result))
    }

    /// Get RMS distance between two structures.
    #[wasm_bindgen]
    pub fn get_rms_dist(&self, struct1: &JsValue, struct2: &JsValue) -> JsValue {
        let result: Result<Option<RmsDistResult>, String> = (|| {
            let s1 = parse_structure_from_js(struct1)?;
            let s2 = parse_structure_from_js(struct2)?;
            Ok(self
                .inner
                .get_rms_dist(&s1, &s2)
                .map(|(rms, max_dist)| RmsDistResult { rms, max_dist }))
        })();
        serialize_result(to_wasm_result(result))
    }

    /// Deduplicate a list of structures.
    /// Returns array where result[i] is the index of the first matching structure.
    #[wasm_bindgen]
    pub fn deduplicate(&self, structures: &JsValue) -> JsValue {
        let result = parse_js_array(structures)
            .and_then(|parsed| self.inner.deduplicate(&parsed).map_err(|e| e.to_string()));
        serialize_result(to_wasm_result(result))
    }

    /// Find matches for new structures against existing structures.
    /// Returns array where result[i] is the index of matching existing structure or null.
    #[wasm_bindgen]
    pub fn find_matches(&self, new_structures: &JsValue, existing_structures: &JsValue) -> JsValue {
        let result = parse_js_array(new_structures).and_then(|new_parsed| {
            parse_js_array(existing_structures).and_then(|existing_parsed| {
                self.inner
                    .find_matches(&new_parsed, &existing_parsed)
                    .map_err(|e| e.to_string())
            })
        });
        serialize_result(to_wasm_result(result))
    }
}

impl Default for WasmStructureMatcher {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Structure Parsing Functions
// =============================================================================

/// Helper to wrap Result<JsValue, String> as { ok: value } or { error: string }
fn wrap_js_result(result: Result<JsValue, String>) -> JsValue {
    let obj = js_sys::Object::new();
    match result {
        Ok(value) => {
            js_sys::Reflect::set(&obj, &"ok".into(), &value).unwrap();
        }
        Err(e) => {
            js_sys::Reflect::set(&obj, &"error".into(), &e.into()).unwrap();
        }
    }
    obj.into()
}

/// Parse a structure from a pymatgen-style JSON object.
#[wasm_bindgen]
pub fn parse_structure(input: &JsValue) -> JsValue {
    wrap_js_result(parse_structure_from_js(input).and_then(|s| structure_to_js(&s)))
}

/// Parse a structure from CIF format string.
#[wasm_bindgen]
pub fn parse_cif(content: &str) -> JsValue {
    wrap_js_result(
        parse_cif_str(content, Path::new("inline.cif"))
            .map_err(|e| e.to_string())
            .and_then(|s| structure_to_js(&s)),
    )
}

/// Parse a structure from POSCAR format string.
#[wasm_bindgen]
pub fn parse_poscar(content: &str) -> JsValue {
    wrap_js_result(
        parse_poscar_str(content)
            .map_err(|e| e.to_string())
            .and_then(|s| structure_to_js(&s)),
    )
}

// =============================================================================
// Supercell Functions
// =============================================================================

/// Create a diagonal supercell (nx × ny × nz).
#[wasm_bindgen]
pub fn make_supercell_diag(structure: &JsValue, nx: i32, ny: i32, nz: i32) -> JsValue {
    wrap_js_result((|| {
        if nx <= 0 || ny <= 0 || nz <= 0 {
            return Err(format!(
                "Supercell factors must be positive, got [{nx}, {ny}, {nz}]"
            ));
        }
        let s = parse_structure_from_js(structure)?;
        let supercell = s.make_supercell_diag([nx, ny, nz]);
        structure_to_js(&supercell)
    })())
}

/// Create a supercell using a 3x3 transformation matrix.
#[wasm_bindgen]
pub fn make_supercell(structure: &JsValue, matrix: &JsValue) -> JsValue {
    wrap_js_result((|| {
        let s = parse_structure_from_js(structure)?;
        let mat: [[i32; 3]; 3] =
            serde_wasm_bindgen::from_value(matrix.clone()).map_err(|e| e.to_string())?;
        let supercell = s.make_supercell(mat).map_err(|e| e.to_string())?;
        structure_to_js(&supercell)
    })())
}

// =============================================================================
// Lattice Reduction Functions
// =============================================================================

/// Get structure with reduced lattice (Niggli or LLL algorithm).
#[wasm_bindgen]
pub fn get_reduced_structure(structure: &JsValue, algo: &str) -> JsValue {
    wrap_js_result((|| {
        let s = parse_structure_from_js(structure)?;
        let algo = match algo.to_lowercase().as_str() {
            "niggli" => ReductionAlgo::Niggli,
            "lll" => ReductionAlgo::LLL,
            _ => return Err(format!("Invalid algorithm: {algo}. Use 'niggli' or 'lll'")),
        };
        let reduced = s.get_reduced_structure(algo).map_err(|e| e.to_string())?;
        structure_to_js(&reduced)
    })())
}

/// Get the primitive cell of a structure.
#[wasm_bindgen]
pub fn get_primitive(structure: &JsValue, symprec: f64) -> JsValue {
    wrap_js_result((|| {
        let s = parse_structure_from_js(structure)?;
        let primitive = s.get_primitive(symprec).map_err(|e| e.to_string())?;
        structure_to_js(&primitive)
    })())
}

/// Get the spacegroup number of a structure.
#[wasm_bindgen]
pub fn get_spacegroup_number(structure: &JsValue, symprec: f64) -> JsValue {
    let result = (|| {
        let s = parse_structure_from_js(structure)?;
        s.get_spacegroup_number(symprec).map_err(|e| e.to_string())
    })();
    serialize_result(to_wasm_result(result))
}

/// Serialize structure to pymatgen-compatible JSON string.
#[wasm_bindgen]
pub fn structure_to_json(structure: &JsValue) -> JsValue {
    let result: Result<String, String> = (|| {
        let s = parse_structure_from_js(structure)?;
        Ok(structure_to_pymatgen_json(&s))
    })();
    serialize_result(to_wasm_result(result))
}

// =============================================================================
// Physical Property Functions
// =============================================================================

/// Get the volume of the unit cell in Angstrom³.
#[wasm_bindgen]
pub fn get_volume(structure: &JsValue) -> JsValue {
    let result = parse_structure_from_js(structure).map(|s| s.volume());
    serialize_result(to_wasm_result(result))
}

/// Get the total mass of the structure in atomic mass units.
#[wasm_bindgen]
pub fn get_total_mass(structure: &JsValue) -> JsValue {
    let result = parse_structure_from_js(structure).map(|s| s.total_mass());
    serialize_result(to_wasm_result(result))
}

/// Get the density of the structure in g/cm³.
#[wasm_bindgen]
pub fn get_density(structure: &JsValue) -> JsValue {
    let result = (|| {
        let s = parse_structure_from_js(structure)?;
        s.density()
            .ok_or_else(|| "Cannot compute density for zero-volume structure".to_string())
    })();
    serialize_result(to_wasm_result(result))
}

// =============================================================================
// Neighbor Finding Functions
// =============================================================================

/// Get neighbor list for a structure.
#[wasm_bindgen]
pub fn get_neighbor_list(
    structure: &JsValue,
    r: f64,
    numerical_tol: f64,
    exclude_self: bool,
) -> JsValue {
    let result = (|| {
        if r < 0.0 {
            return Err("Cutoff radius must be non-negative".to_string());
        }
        let s = parse_structure_from_js(structure)?;
        let (center_indices, neighbor_indices, image_offsets, distances) =
            s.get_neighbor_list(r, numerical_tol, exclude_self);
        Ok(NeighborListResult {
            center_indices,
            neighbor_indices,
            image_offsets,
            distances,
        })
    })();
    serialize_result(to_wasm_result(result))
}

/// Get distance between two sites using minimum image convention.
#[wasm_bindgen]
pub fn get_distance(structure: &JsValue, i: usize, j: usize) -> JsValue {
    let result = (|| {
        let s = parse_structure_from_js(structure)?;
        let n = s.num_sites();
        if i >= n || j >= n {
            return Err(format!(
                "Site indices ({i}, {j}) out of bounds for structure with {n} sites"
            ));
        }
        Ok(s.get_distance(i, j))
    })();
    serialize_result(to_wasm_result(result))
}

/// Get the full distance matrix between all sites.
#[wasm_bindgen]
pub fn get_distance_matrix(structure: &JsValue) -> JsValue {
    let result = parse_structure_from_js(structure).map(|s| s.distance_matrix());
    serialize_result(to_wasm_result(result))
}

// =============================================================================
// Sorting Functions
// =============================================================================

/// Get a sorted copy of the structure by atomic number.
#[wasm_bindgen]
pub fn get_sorted_structure(structure: &JsValue, reverse: bool) -> JsValue {
    wrap_js_result((|| {
        let s = parse_structure_from_js(structure)?;
        let sorted = s.get_sorted_structure(reverse);
        structure_to_js(&sorted)
    })())
}

/// Get a sorted copy of the structure by electronegativity.
#[wasm_bindgen]
pub fn get_sorted_by_electronegativity(structure: &JsValue, reverse: bool) -> JsValue {
    wrap_js_result((|| {
        let s = parse_structure_from_js(structure)?;
        let sorted = s.get_sorted_by_electronegativity(reverse);
        structure_to_js(&sorted)
    })())
}

// =============================================================================
// Interpolation Functions
// =============================================================================

/// Interpolate between two structures.
#[wasm_bindgen]
pub fn interpolate_structures(
    start: &JsValue,
    end: &JsValue,
    n_images: usize,
    interpolate_lattices: bool,
    use_pbc: bool,
) -> JsValue {
    let result = (|| {
        let s1 = parse_structure_from_js(start)?;
        let s2 = parse_structure_from_js(end)?;
        let images = s1
            .interpolate(&s2, n_images, interpolate_lattices, use_pbc)
            .map_err(|e| e.to_string())?;
        let arr = js_sys::Array::new();
        for img in &images {
            arr.push(&structure_to_js(img)?);
        }
        Ok(arr.into())
    })();
    wrap_js_result(result)
}

// =============================================================================
// Copy and Wrap Functions
// =============================================================================

/// Create a copy of the structure, optionally sanitized.
#[wasm_bindgen]
pub fn copy_structure(structure: &JsValue, sanitize: bool) -> JsValue {
    wrap_js_result((|| {
        let s = parse_structure_from_js(structure)?;
        let copied = s.copy(sanitize);
        structure_to_js(&copied)
    })())
}

/// Wrap all fractional coordinates to [0, 1).
#[wasm_bindgen]
pub fn wrap_to_unit_cell(structure: &JsValue) -> JsValue {
    wrap_js_result((|| {
        let mut s = parse_structure_from_js(structure)?;
        s.wrap_to_unit_cell();
        structure_to_js(&s)
    })())
}

// =============================================================================
// Site Manipulation Functions
// =============================================================================

/// Translate specific sites by a vector.
#[wasm_bindgen]
pub fn translate_sites(
    structure: &JsValue,
    indices: &JsValue,
    vector: &JsValue,
    fractional: bool,
) -> JsValue {
    wrap_js_result((|| {
        let mut s = parse_structure_from_js(structure)?;
        let idx: Vec<usize> =
            serde_wasm_bindgen::from_value(indices.clone()).map_err(|e| e.to_string())?;
        let vec: [f64; 3] =
            serde_wasm_bindgen::from_value(vector.clone()).map_err(|e| e.to_string())?;

        let n = s.num_sites();
        for &i in &idx {
            if i >= n {
                return Err(format!(
                    "Index {i} out of bounds for structure with {n} sites"
                ));
            }
        }

        s.translate_sites(&idx, Vector3::from(vec), fractional);
        structure_to_js(&s)
    })())
}

/// Perturb all sites by random vectors.
#[wasm_bindgen]
pub fn perturb_structure(
    structure: &JsValue,
    distance: f64,
    min_distance: Option<f64>,
    seed: Option<u64>,
) -> JsValue {
    wrap_js_result((|| {
        if distance < 0.0 {
            return Err("distance must be non-negative".to_string());
        }
        if let Some(min_dist) = min_distance {
            if min_dist < 0.0 {
                return Err("min_distance must be non-negative".to_string());
            }
            if min_dist > distance {
                return Err(format!(
                    "distance ({distance}) must be >= min_distance ({min_dist})"
                ));
            }
        }
        let mut s = parse_structure_from_js(structure)?;
        s.perturb(distance, min_distance, seed);
        structure_to_js(&s)
    })())
}

// =============================================================================
// Element Information Functions
// =============================================================================

/// Get atomic mass for an element by symbol.
#[wasm_bindgen]
pub fn get_atomic_mass(symbol: &str) -> JsValue {
    let result = Element::from_symbol(symbol)
        .map(|e| e.atomic_mass())
        .ok_or_else(|| format!("Unknown element: {symbol}"));
    serialize_result(to_wasm_result(result))
}

/// Get electronegativity for an element by symbol.
#[wasm_bindgen]
pub fn get_electronegativity(symbol: &str) -> JsValue {
    let result = Element::from_symbol(symbol)
        .ok_or_else(|| format!("Unknown element: {symbol}"))
        .and_then(|e| {
            e.electronegativity()
                .ok_or_else(|| format!("No electronegativity data for {symbol}"))
        });
    serialize_result(to_wasm_result(result))
}
