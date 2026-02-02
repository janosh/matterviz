//! WASM bindings for ferrox types.
//!
//! This module provides JavaScript-accessible wrappers for Element, Species,
//! Structure, and StructureMatcher types via wasm-bindgen.
//!
//! All structure functions use strongly-typed `JsCrystal` inputs/outputs.
//! Results are returned as `WasmResult<T>` = `{ ok: T }` | `{ error: string }`.

use std::path::Path;

use nalgebra::Vector3;
use serde::{Deserialize, Serialize};
use tsify_next::Tsify;
use wasm_bindgen::prelude::*;

use crate::cif::parse_cif_str;
use crate::element::Element;
use crate::io::parse_poscar_str;
use crate::species::Species;
use crate::structure_matcher::{ComparatorType, StructureMatcher};
use crate::wasm_types::{
    JsAseAtoms, JsCompositionInfo, JsCrystal, JsElementAmount, JsIntMatrix3x3, JsLocalEnvironment,
    JsMatrix3x3, JsMillerIndex, JsNeighborInfo, JsNeighborList, JsReductionAlgo, JsRmsDistResult,
    JsStructureMetadata, JsSymmetryDataset, JsSymmetryOperation, JsVector3, WasmResult,
};

// === Element WASM bindings ===

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
            .map(|elem| JsElement { inner: elem })
            .ok_or_else(|| JsError::new(&format!("Unknown element symbol: {symbol}")))
    }

    /// Create an element from its atomic number.
    ///
    /// Accepts 1-118 for real elements, plus pseudo-elements:
    /// - 119: Dummy (placeholder atom)
    /// - 120: D (Deuterium)
    /// - 121: T (Tritium)
    #[wasm_bindgen(js_name = "from_atomic_number")]
    pub fn from_atomic_number(atomic_num: u8) -> Result<JsElement, JsError> {
        Element::from_atomic_number(atomic_num)
            .map(|elem| JsElement { inner: elem })
            .ok_or_else(|| {
                JsError::new(&format!(
                    "Invalid atomic number: {atomic_num} (valid: 1-121)"
                ))
            })
    }

    /// Get the element symbol.
    #[wasm_bindgen(getter)]
    pub fn symbol(&self) -> String {
        self.inner.symbol().to_string()
    }

    /// Get the atomic number.
    #[wasm_bindgen(getter, js_name = "atomic_number")]
    pub fn atomic_number(&self) -> u8 {
        self.inner.atomic_number()
    }

    /// Get the full element name.
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.inner.name().to_string()
    }

    /// Get the atomic mass in atomic mass units.
    #[wasm_bindgen(getter, js_name = "atomic_mass")]
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
    #[wasm_bindgen(getter, js_name = "atomic_radius")]
    pub fn atomic_radius(&self) -> f64 {
        self.inner.atomic_radius().unwrap_or(f64::NAN)
    }

    /// Get covalent radius in Angstroms (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "covalent_radius")]
    pub fn covalent_radius(&self) -> f64 {
        self.inner.covalent_radius().unwrap_or(f64::NAN)
    }

    // Classification methods

    /// Check if element is a noble gas.
    #[wasm_bindgen(js_name = "is_noble_gas")]
    pub fn is_noble_gas(&self) -> bool {
        self.inner.is_noble_gas()
    }

    /// Check if element is an alkali metal.
    #[wasm_bindgen(js_name = "is_alkali")]
    pub fn is_alkali(&self) -> bool {
        self.inner.is_alkali()
    }

    /// Check if element is an alkaline earth metal.
    #[wasm_bindgen(js_name = "is_alkaline")]
    pub fn is_alkaline(&self) -> bool {
        self.inner.is_alkaline()
    }

    /// Check if element is a halogen.
    #[wasm_bindgen(js_name = "is_halogen")]
    pub fn is_halogen(&self) -> bool {
        self.inner.is_halogen()
    }

    /// Check if element is a chalcogen.
    #[wasm_bindgen(js_name = "is_chalcogen")]
    pub fn is_chalcogen(&self) -> bool {
        self.inner.is_chalcogen()
    }

    /// Check if element is a lanthanoid.
    #[wasm_bindgen(js_name = "is_lanthanoid")]
    pub fn is_lanthanoid(&self) -> bool {
        self.inner.is_lanthanoid()
    }

    /// Check if element is an actinoid.
    #[wasm_bindgen(js_name = "is_actinoid")]
    pub fn is_actinoid(&self) -> bool {
        self.inner.is_actinoid()
    }

    /// Check if element is a transition metal.
    #[wasm_bindgen(js_name = "is_transition_metal")]
    pub fn is_transition_metal(&self) -> bool {
        self.inner.is_transition_metal()
    }

    /// Check if element is a post-transition metal.
    #[wasm_bindgen(js_name = "is_post_transition_metal")]
    pub fn is_post_transition_metal(&self) -> bool {
        self.inner.is_post_transition_metal()
    }

    /// Check if element is a metalloid.
    #[wasm_bindgen(js_name = "is_metalloid")]
    pub fn is_metalloid(&self) -> bool {
        self.inner.is_metalloid()
    }

    /// Check if element is a metal.
    #[wasm_bindgen(js_name = "is_metal")]
    pub fn is_metal(&self) -> bool {
        self.inner.is_metal()
    }

    /// Check if element is radioactive.
    #[wasm_bindgen(js_name = "is_radioactive")]
    pub fn is_radioactive(&self) -> bool {
        self.inner.is_radioactive()
    }

    /// Check if element is a rare earth element.
    #[wasm_bindgen(js_name = "is_rare_earth")]
    pub fn is_rare_earth(&self) -> bool {
        self.inner.is_rare_earth()
    }

    /// Check if this is a pseudo-element (Dummy, D, T).
    #[wasm_bindgen(js_name = "is_pseudo")]
    pub fn is_pseudo(&self) -> bool {
        self.inner.is_pseudo()
    }

    /// Get oxidation states as a JavaScript array.
    #[wasm_bindgen(js_name = "oxidation_states")]
    pub fn oxidation_states(&self) -> Vec<i8> {
        self.inner.oxidation_states().to_vec()
    }

    /// Get common oxidation states as a JavaScript array.
    #[wasm_bindgen(js_name = "common_oxidation_states")]
    pub fn common_oxidation_states(&self) -> Vec<i8> {
        self.inner.common_oxidation_states().to_vec()
    }

    /// Get ICSD oxidation states (with at least 10 instances in ICSD) as a JavaScript array.
    #[wasm_bindgen(js_name = "icsd_oxidation_states")]
    pub fn icsd_oxidation_states(&self) -> Vec<i8> {
        self.inner.icsd_oxidation_states().to_vec()
    }

    /// Get maximum oxidation state (or 0 if none).
    #[wasm_bindgen(getter, js_name = "max_oxidation_state")]
    pub fn max_oxidation_state(&self) -> i8 {
        self.inner.max_oxidation_state().unwrap_or(0)
    }

    /// Get minimum oxidation state (or 0 if none).
    #[wasm_bindgen(getter, js_name = "min_oxidation_state")]
    pub fn min_oxidation_state(&self) -> i8 {
        self.inner.min_oxidation_state().unwrap_or(0)
    }

    /// Get ionic radius for a specific oxidation state (or NaN if not defined).
    #[wasm_bindgen(js_name = "ionic_radius")]
    pub fn ionic_radius(&self, oxidation_state: i8) -> f64 {
        self.inner.ionic_radius(oxidation_state).unwrap_or(f64::NAN)
    }

    /// Get all ionic radii as JSON string: {"oxi_state": radius, ...}.
    ///
    /// Returns null if no ionic radii data is available.
    #[wasm_bindgen(js_name = "ionic_radii")]
    pub fn ionic_radii(&self) -> Option<String> {
        self.inner
            .ionic_radii()
            .map(|radii| serde_json::to_string(radii).unwrap_or_default())
    }

    /// Get Shannon ionic radius (or NaN if not defined).
    #[wasm_bindgen(js_name = "shannon_ionic_radius")]
    pub fn shannon_ionic_radius(&self, oxidation_state: i8, coordination: &str, spin: &str) -> f64 {
        self.inner
            .shannon_ionic_radius(oxidation_state, coordination, spin)
            .unwrap_or(f64::NAN)
    }

    /// Get full Shannon radii as JSON string.
    ///
    /// Structure: {oxi_state: {coordination: {spin: {crystal_radius, ionic_radius}}}}
    /// Returns null if no Shannon radii data is available.
    #[wasm_bindgen(js_name = "shannon_radii")]
    pub fn shannon_radii(&self) -> Option<String> {
        self.inner
            .shannon_radii()
            .map(|radii| serde_json::to_string(radii).unwrap_or_default())
    }

    // Physical properties

    /// Get melting point in Kelvin (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "melting_point")]
    pub fn melting_point(&self) -> f64 {
        self.inner.melting_point().unwrap_or(f64::NAN)
    }

    /// Get boiling point in Kelvin (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "boiling_point")]
    pub fn boiling_point(&self) -> f64 {
        self.inner.boiling_point().unwrap_or(f64::NAN)
    }

    /// Get density in g/cm³ (or NaN if not defined).
    #[wasm_bindgen(getter)]
    pub fn density(&self) -> f64 {
        self.inner.density().unwrap_or(f64::NAN)
    }

    /// Get electron affinity in kJ/mol (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "electron_affinity")]
    pub fn electron_affinity(&self) -> f64 {
        self.inner.electron_affinity().unwrap_or(f64::NAN)
    }

    /// Get first ionization energy in kJ/mol (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "first_ionization_energy")]
    pub fn first_ionization_energy(&self) -> f64 {
        self.inner.first_ionization_energy().unwrap_or(f64::NAN)
    }

    /// Get all ionization energies in kJ/mol.
    #[wasm_bindgen(js_name = "ionization_energies")]
    pub fn ionization_energies(&self) -> Vec<f64> {
        self.inner.ionization_energies().to_vec()
    }

    /// Get molar heat capacity (Cp) in J/(mol·K) (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "molar_heat")]
    pub fn molar_heat(&self) -> f64 {
        self.inner.molar_heat().unwrap_or(f64::NAN)
    }

    /// Get specific heat capacity in J/(g·K) (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "specific_heat")]
    pub fn specific_heat(&self) -> f64 {
        self.inner.specific_heat().unwrap_or(f64::NAN)
    }

    /// Get number of valence electrons (or 0 if not defined).
    #[wasm_bindgen(getter, js_name = "n_valence")]
    pub fn n_valence(&self) -> u8 {
        self.inner.n_valence().unwrap_or(0)
    }

    /// Get electron configuration string (or empty string if not defined).
    #[wasm_bindgen(getter, js_name = "electron_configuration")]
    pub fn electron_configuration(&self) -> String {
        self.inner
            .electron_configuration()
            .unwrap_or("")
            .to_string()
    }

    /// Get semantic electron configuration with noble gas core (or empty string if not defined).
    #[wasm_bindgen(getter, js_name = "electron_configuration_semantic")]
    pub fn electron_configuration_semantic(&self) -> String {
        self.inner
            .electron_configuration_semantic()
            .unwrap_or("")
            .to_string()
    }
}

// === Species WASM bindings ===

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
            .map(|species| JsSpecies { inner: species })
            .ok_or_else(|| JsError::new(&format!("Invalid species string: {species_str}")))
    }

    /// Get the element symbol.
    #[wasm_bindgen(getter)]
    pub fn symbol(&self) -> String {
        self.inner.element.symbol().to_string()
    }

    /// Get the element's atomic number.
    #[wasm_bindgen(getter, js_name = "atomic_number")]
    pub fn atomic_number(&self) -> u8 {
        self.inner.element.atomic_number()
    }

    /// Get the oxidation state (or null/undefined if not set).
    #[wasm_bindgen(getter, js_name = "oxidation_state")]
    pub fn oxidation_state(&self) -> Option<i8> {
        self.inner.oxidation_state
    }

    /// Get the species string representation (e.g., "Fe2+").
    #[wasm_bindgen(js_name = "to_string")]
    pub fn to_string_js(&self) -> String {
        self.inner.to_string()
    }

    /// Get ionic radius for this species' oxidation state (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "ionic_radius")]
    pub fn ionic_radius(&self) -> f64 {
        self.inner.ionic_radius().unwrap_or(f64::NAN)
    }

    /// Get atomic radius (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "atomic_radius")]
    pub fn atomic_radius(&self) -> f64 {
        self.inner.atomic_radius().unwrap_or(f64::NAN)
    }

    /// Get electronegativity (or NaN if not defined).
    #[wasm_bindgen(getter)]
    pub fn electronegativity(&self) -> f64 {
        self.inner.electronegativity().unwrap_or(f64::NAN)
    }

    /// Get Shannon ionic radius with coordination and spin (or NaN if not defined).
    #[wasm_bindgen(js_name = "shannon_ionic_radius")]
    pub fn shannon_ionic_radius(&self, coordination: &str, spin: &str) -> f64 {
        self.inner
            .shannon_ionic_radius(coordination, spin)
            .unwrap_or(f64::NAN)
    }

    /// Get covalent radius (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "covalent_radius")]
    pub fn covalent_radius(&self) -> f64 {
        self.inner.covalent_radius().unwrap_or(f64::NAN)
    }

    /// Get the element's full name (e.g., "Iron" for Fe).
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.inner.name().to_string()
    }
}

// === StructureMatcher WASM bindings ===

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
    pub fn fit(&self, struct1: JsCrystal, struct2: JsCrystal) -> WasmResult<bool> {
        let result: Result<bool, String> = (|| {
            let s1 = struct1.to_structure()?;
            let s2 = struct2.to_structure()?;
            Ok(self.inner.fit(&s1, &s2))
        })();
        result.into()
    }

    /// Check if two structures match under any species permutation.
    #[wasm_bindgen]
    pub fn fit_anonymous(&self, struct1: JsCrystal, struct2: JsCrystal) -> WasmResult<bool> {
        let result: Result<bool, String> = (|| {
            let s1 = struct1.to_structure()?;
            let s2 = struct2.to_structure()?;
            Ok(self.inner.fit_anonymous(&s1, &s2))
        })();
        result.into()
    }

    /// Get RMS distance between two structures.
    #[wasm_bindgen]
    pub fn get_rms_dist(
        &self,
        struct1: JsCrystal,
        struct2: JsCrystal,
    ) -> WasmResult<Option<JsRmsDistResult>> {
        let result: Result<Option<JsRmsDistResult>, String> = (|| {
            let s1 = struct1.to_structure()?;
            let s2 = struct2.to_structure()?;
            Ok(self
                .inner
                .get_rms_dist(&s1, &s2)
                .map(|(rms, max_dist)| JsRmsDistResult { rms, max_dist }))
        })();
        result.into()
    }

    /// Compute a universal distance between any two structures.
    ///
    /// Unlike `get_rms_dist` which may return null for incompatible structures,
    /// this method always returns a finite distance value, making it suitable for
    /// consistent ranking of structures by similarity and compatible with `Number.isFinite()`.
    ///
    /// # Properties
    /// - d(x, y) ≥ 0 (non-negative)
    /// - d(x, x) = 0 (identity)
    /// - d(x, y) = d(y, x) (symmetric)
    /// - Always finite (clamped to 1e9 if underlying computation yields non-finite)
    ///
    /// Note: Triangle inequality is not guaranteed due to greedy matching.
    ///
    /// # Returns
    /// Finite distance in [0, 1e9]. Smaller values indicate more similar structures.
    #[wasm_bindgen(js_name = "get_structure_distance")]
    pub fn get_structure_distance(
        &self,
        struct1: JsCrystal,
        struct2: JsCrystal,
    ) -> WasmResult<f64> {
        let result: Result<f64, String> = (|| {
            let s1 = struct1.to_structure()?;
            let s2 = struct2.to_structure()?;
            let dist = self.inner.get_structure_distance(&s1, &s2);
            // Clamp non-finite values to ensure JS compatibility with Number.isFinite()
            Ok(if dist.is_finite() { dist } else { 1e9 })
        })();
        result.into()
    }

    /// Deduplicate a list of structures.
    /// Returns array where result[i] is the index of the first matching structure.
    #[wasm_bindgen]
    pub fn deduplicate(&self, structures: Vec<JsCrystal>) -> WasmResult<Vec<u32>> {
        let result: Result<Vec<u32>, String> = (|| {
            let structs: Vec<_> = structures
                .into_iter()
                .map(|js| js.to_structure())
                .collect::<Result<Vec<_>, _>>()?;
            let indices = self
                .inner
                .deduplicate(&structs)
                .map_err(|err| err.to_string())?;
            Ok(indices.into_iter().map(|idx| idx as u32).collect())
        })();
        result.into()
    }

    /// Find matches for new structures against existing structures.
    /// Returns array where result[i] is the index of matching existing structure or null.
    #[wasm_bindgen]
    pub fn find_matches(
        &self,
        new_structures: Vec<JsCrystal>,
        existing_structures: Vec<JsCrystal>,
    ) -> WasmResult<Vec<Option<u32>>> {
        let result: Result<Vec<Option<u32>>, String> = (|| {
            let new_structs: Vec<_> = new_structures
                .into_iter()
                .map(|js| js.to_structure())
                .collect::<Result<Vec<_>, _>>()?;
            let existing_structs: Vec<_> = existing_structures
                .into_iter()
                .map(|js| js.to_structure())
                .collect::<Result<Vec<_>, _>>()?;
            let matches = self
                .inner
                .find_matches(&new_structs, &existing_structs)
                .map_err(|err| err.to_string())?;
            Ok(matches
                .into_iter()
                .map(|opt| opt.map(|idx| idx as u32))
                .collect())
        })();
        result.into()
    }
}

impl Default for WasmStructureMatcher {
    fn default() -> Self {
        Self::new()
    }
}

// === Structure Parsing Functions ===

/// Parse a structure from CIF format string.
#[wasm_bindgen]
pub fn parse_cif(content: &str) -> WasmResult<JsCrystal> {
    let result = parse_cif_str(content, Path::new("inline.cif"))
        .map_err(|err| err.to_string())
        .map(|structure| JsCrystal::from_structure(&structure));
    result.into()
}

/// Parse a structure from POSCAR format string.
#[wasm_bindgen]
pub fn parse_poscar(content: &str) -> WasmResult<JsCrystal> {
    let result = parse_poscar_str(content)
        .map_err(|err| err.to_string())
        .map(|structure| JsCrystal::from_structure(&structure));
    result.into()
}

// === Supercell Functions ===

/// Create a diagonal supercell (nx × ny × nz).
#[wasm_bindgen]
pub fn make_supercell_diag(
    structure: JsCrystal,
    scale_a: i32,
    scale_b: i32,
    scale_c: i32,
) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        if scale_a <= 0 || scale_b <= 0 || scale_c <= 0 {
            return Err(format!(
                "Supercell factors must be positive, got [{scale_a}, {scale_b}, {scale_c}]"
            ));
        }
        let struc = structure.to_structure()?;
        let supercell = struc.make_supercell_diag([scale_a, scale_b, scale_c]);
        Ok(JsCrystal::from_structure(&supercell))
    })();
    result.into()
}

/// Create a supercell using a 3x3 transformation matrix.
#[wasm_bindgen]
pub fn make_supercell(structure: JsCrystal, matrix: JsIntMatrix3x3) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let struc = structure.to_structure()?;
        let supercell = struc
            .make_supercell(matrix.0)
            .map_err(|err| err.to_string())?;
        Ok(JsCrystal::from_structure(&supercell))
    })();
    result.into()
}

// === Lattice Reduction Functions ===

/// Get structure with reduced lattice (Niggli or LLL algorithm).
#[wasm_bindgen]
pub fn get_reduced_structure(structure: JsCrystal, algo: JsReductionAlgo) -> WasmResult<JsCrystal> {
    structure
        .to_structure()
        .and_then(|struc| {
            struc
                .get_reduced_structure(algo.to_internal())
                .map_err(|e| e.to_string())
        })
        .map(|reduced| JsCrystal::from_structure(&reduced))
        .into()
}

/// Get the primitive cell of a structure.
#[wasm_bindgen]
pub fn get_primitive(structure: JsCrystal, symprec: f64) -> WasmResult<JsCrystal> {
    structure
        .to_structure()
        .and_then(|struc| struc.get_primitive(symprec).map_err(|e| e.to_string()))
        .map(|prim| JsCrystal::from_structure(&prim))
        .into()
}

/// Get the conventional cell of a structure.
#[wasm_bindgen]
pub fn get_conventional(structure: JsCrystal, symprec: f64) -> WasmResult<JsCrystal> {
    structure
        .to_structure()
        .and_then(|struc| {
            struc
                .get_conventional_structure(symprec)
                .map_err(|e| e.to_string())
        })
        .map(|conv| JsCrystal::from_structure(&conv))
        .into()
}

// === Symmetry Functions ===

/// Get the spacegroup number of a structure.
#[wasm_bindgen]
pub fn get_spacegroup_number(structure: JsCrystal, symprec: f64) -> WasmResult<u16> {
    structure
        .to_structure()
        .and_then(|struc| {
            struc
                .get_spacegroup_number(symprec)
                .map_err(|e| e.to_string())
        })
        .map(|sg| sg as u16)
        .into()
}

/// Get the spacegroup symbol of a structure.
#[wasm_bindgen]
pub fn get_spacegroup_symbol(structure: JsCrystal, symprec: f64) -> WasmResult<String> {
    structure
        .to_structure()
        .and_then(|struc| {
            struc
                .get_spacegroup_symbol(symprec)
                .map_err(|e| e.to_string())
        })
        .into()
}

/// Get the crystal system of a structure.
#[wasm_bindgen]
pub fn get_crystal_system(structure: JsCrystal, symprec: f64) -> WasmResult<String> {
    structure
        .to_structure()
        .and_then(|struc| struc.get_crystal_system(symprec).map_err(|e| e.to_string()))
        .into()
}

/// Get Wyckoff letters for each site in the structure.
#[wasm_bindgen]
pub fn get_wyckoff_letters(structure: JsCrystal, symprec: f64) -> WasmResult<Vec<String>> {
    let result: Result<Vec<String>, String> = (|| {
        let struc = structure.to_structure()?;
        let letters = struc
            .get_wyckoff_letters(symprec)
            .map_err(|err| err.to_string())?;
        Ok(letters
            .into_iter()
            .map(|letter| letter.to_string())
            .collect())
    })();
    result.into()
}

/// Get symmetry operations for the structure.
#[wasm_bindgen]
pub fn get_symmetry_operations(
    structure: JsCrystal,
    symprec: f64,
) -> WasmResult<Vec<JsSymmetryOperation>> {
    let result: Result<Vec<JsSymmetryOperation>, String> = (|| {
        let struc = structure.to_structure()?;
        let ops = struc
            .get_symmetry_operations(symprec)
            .map_err(|err| err.to_string())?;
        Ok(ops
            .into_iter()
            .map(|(rot, trans)| JsSymmetryOperation {
                rotation: rot,
                translation: trans,
            })
            .collect())
    })();
    result.into()
}

/// Get the full symmetry dataset for a structure.
#[wasm_bindgen]
pub fn get_symmetry_dataset(structure: JsCrystal, symprec: f64) -> WasmResult<JsSymmetryDataset> {
    use crate::structure::{moyo_ops_to_arrays, spacegroup_to_crystal_system};

    let result: Result<JsSymmetryDataset, String> = (|| {
        let struc = structure.to_structure()?;
        let dataset = struc
            .get_symmetry_dataset(symprec)
            .map_err(|err| err.to_string())?;
        let operations = moyo_ops_to_arrays(&dataset.operations);
        Ok(JsSymmetryDataset {
            spacegroup_number: dataset.number as u16,
            spacegroup_symbol: dataset.hm_symbol,
            hall_number: dataset.hall_number as u16,
            crystal_system: spacegroup_to_crystal_system(dataset.number).to_string(),
            wyckoff_letters: dataset
                .wyckoffs
                .into_iter()
                .map(|letter| letter.to_string())
                .collect(),
            site_symmetry_symbols: dataset.site_symmetry_symbols,
            equivalent_atoms: dataset.orbits.into_iter().map(|idx| idx as u32).collect(),
            operations: operations
                .into_iter()
                .map(|(rot, trans)| JsSymmetryOperation {
                    rotation: rot,
                    translation: trans,
                })
                .collect(),
        })
    })();
    result.into()
}

// === Physical Property Functions ===

/// Get the volume of the unit cell in Angstrom³.
#[wasm_bindgen]
pub fn get_volume(structure: JsCrystal) -> WasmResult<f64> {
    let result = structure.to_structure().map(|struc| struc.volume());
    result.into()
}

/// Get the total mass of the structure in atomic mass units.
#[wasm_bindgen]
pub fn get_total_mass(structure: JsCrystal) -> WasmResult<f64> {
    let result = structure.to_structure().map(|struc| struc.total_mass());
    result.into()
}

/// Get the density of the structure in g/cm³.
#[wasm_bindgen]
pub fn get_density(structure: JsCrystal) -> WasmResult<f64> {
    let result: Result<f64, String> = (|| {
        let struc = structure.to_structure()?;
        struc
            .density()
            .ok_or_else(|| "Cannot compute density for zero-volume structure".to_string())
    })();
    result.into()
}

/// Get metadata about a structure (formula, volume, etc.).
#[wasm_bindgen]
pub fn get_structure_metadata(structure: JsCrystal) -> WasmResult<JsStructureMetadata> {
    structure
        .to_structure()
        .map(|struc| {
            let comp = struc.composition();
            let lengths = struc.lattice.lengths();
            let angles = struc.lattice.angles();
            JsStructureMetadata {
                num_sites: struc.num_sites() as u32,
                formula: comp.reduced_formula(),
                formula_anonymous: comp.anonymous_formula(),
                formula_hill: comp.hill_formula(),
                volume: struc.volume(),
                density: struc.density(),
                lattice_params: [lengths.x, lengths.y, lengths.z],
                lattice_angles: [angles.x, angles.y, angles.z],
                is_ordered: struc.is_ordered(),
            }
        })
        .into()
}

// === Neighbor Finding Functions ===

/// Get neighbor list for a structure.
#[wasm_bindgen]
pub fn get_neighbor_list(
    structure: JsCrystal,
    cutoff_radius: f64,
    numerical_tol: f64,
    exclude_self: bool,
) -> WasmResult<JsNeighborList> {
    let result: Result<JsNeighborList, String> = (|| {
        if cutoff_radius < 0.0 {
            return Err("Cutoff radius must be non-negative".to_string());
        }
        let struc = structure.to_structure()?;
        let (center_indices, neighbor_indices, image_offsets, distances) =
            struc.get_neighbor_list(cutoff_radius, numerical_tol, exclude_self);
        Ok(JsNeighborList {
            center_indices: center_indices.into_iter().map(|idx| idx as u32).collect(),
            neighbor_indices: neighbor_indices.into_iter().map(|idx| idx as u32).collect(),
            image_offsets,
            distances,
        })
    })();
    result.into()
}

/// Get distance between two sites using minimum image convention.
#[wasm_bindgen]
pub fn get_distance(structure: JsCrystal, site_idx_1: u32, site_idx_2: u32) -> WasmResult<f64> {
    let result: Result<f64, String> = (|| {
        let struc = structure.to_structure()?;
        let num_sites = struc.num_sites();
        let idx_1 = site_idx_1 as usize;
        let idx_2 = site_idx_2 as usize;
        if idx_1 >= num_sites || idx_2 >= num_sites {
            return Err(format!(
                "Site indices ({idx_1}, {idx_2}) out of bounds for structure with {num_sites} sites"
            ));
        }
        Ok(struc.get_distance(idx_1, idx_2))
    })();
    result.into()
}

/// Get the full distance matrix between all sites.
#[wasm_bindgen]
pub fn get_distance_matrix(structure: JsCrystal) -> WasmResult<Vec<Vec<f64>>> {
    let result = structure
        .to_structure()
        .map(|struc| struc.distance_matrix());
    result.into()
}

// === Coordination Analysis Functions ===

/// Get coordination numbers for all sites using cutoff-based method.
#[wasm_bindgen]
pub fn get_coordination_numbers(structure: JsCrystal, cutoff: f64) -> WasmResult<Vec<u32>> {
    if cutoff < 0.0 {
        return WasmResult::err("Cutoff must be non-negative");
    }
    structure
        .to_structure()
        .map(|struc| {
            struc
                .get_coordination_numbers(cutoff)
                .into_iter()
                .map(|cn| cn as u32)
                .collect()
        })
        .into()
}

/// Get coordination number for a specific site.
#[wasm_bindgen]
pub fn get_coordination_number(
    structure: JsCrystal,
    site_index: u32,
    cutoff: f64,
) -> WasmResult<u32> {
    if cutoff < 0.0 {
        return WasmResult::err("Cutoff must be non-negative");
    }
    let result: Result<u32, String> = (|| {
        let struc = structure.to_structure()?;
        let idx = site_index as usize;
        if idx >= struc.num_sites() {
            return Err(format!(
                "Site index {idx} out of bounds for structure with {} sites",
                struc.num_sites()
            ));
        }
        Ok(struc.get_coordination_number(idx, cutoff) as u32)
    })();
    result.into()
}

/// Get local environment (neighbors) for a specific site.
#[wasm_bindgen]
pub fn get_local_environment(
    structure: JsCrystal,
    site_index: u32,
    cutoff: f64,
) -> WasmResult<JsLocalEnvironment> {
    if cutoff < 0.0 {
        return WasmResult::err("Cutoff must be non-negative");
    }
    let result: Result<JsLocalEnvironment, String> = (|| {
        let struc = structure.to_structure()?;
        let idx = site_index as usize;
        if idx >= struc.num_sites() {
            return Err(format!(
                "Site index {idx} out of bounds for structure with {} sites",
                struc.num_sites()
            ));
        }
        let neighbors_raw = struc.get_local_environment(idx, cutoff);
        let neighbors: Vec<JsNeighborInfo> = neighbors_raw
            .into_iter()
            .map(|neighbor| JsNeighborInfo {
                site_index: neighbor.site_idx as u32,
                element: neighbor.species.element.symbol().to_string(),
                distance: neighbor.distance,
                image: neighbor.image,
            })
            .collect();
        let center_species = struc.species()[idx];
        Ok(JsLocalEnvironment {
            center_index: idx as u32,
            center_element: center_species.element.symbol().to_string(),
            coordination_number: neighbors.len() as u32,
            neighbors,
        })
    })();
    result.into()
}

// === Sorting Functions ===

/// Get a sorted copy of the structure by atomic number.
#[wasm_bindgen]
pub fn get_sorted_structure(structure: JsCrystal, reverse: bool) -> WasmResult<JsCrystal> {
    structure
        .to_structure()
        .map(|struc| JsCrystal::from_structure(&struc.get_sorted_structure(reverse)))
        .into()
}

/// Get a sorted copy of the structure by electronegativity.
#[wasm_bindgen]
pub fn get_sorted_by_electronegativity(
    structure: JsCrystal,
    reverse: bool,
) -> WasmResult<JsCrystal> {
    structure
        .to_structure()
        .map(|struc| JsCrystal::from_structure(&struc.get_sorted_by_electronegativity(reverse)))
        .into()
}

// === Interpolation Functions ===

/// Interpolate between two structures.
#[wasm_bindgen]
pub fn interpolate_structures(
    start: JsCrystal,
    end: JsCrystal,
    n_images: u32,
    interpolate_lattices: bool,
    use_pbc: bool,
) -> WasmResult<Vec<JsCrystal>> {
    let result: Result<Vec<JsCrystal>, String> = (|| {
        let s1 = start.to_structure()?;
        let s2 = end.to_structure()?;
        let images = s1
            .interpolate(&s2, n_images as usize, interpolate_lattices, use_pbc)
            .map_err(|err| err.to_string())?;
        Ok(images.iter().map(JsCrystal::from_structure).collect())
    })();
    result.into()
}

// === Copy and Wrap Functions ===

/// Create a copy of the structure, optionally sanitized.
#[wasm_bindgen]
pub fn copy_structure(structure: JsCrystal, sanitize: bool) -> WasmResult<JsCrystal> {
    structure
        .to_structure()
        .map(|struc| JsCrystal::from_structure(&struc.copy(sanitize)))
        .into()
}

/// Wrap all fractional coordinates to [0, 1).
#[wasm_bindgen]
pub fn wrap_to_unit_cell(structure: JsCrystal) -> WasmResult<JsCrystal> {
    structure
        .to_structure()
        .map(|mut struc| {
            struc.wrap_to_unit_cell();
            JsCrystal::from_structure(&struc)
        })
        .into()
}

// === Site Manipulation Functions ===

/// Translate specific sites by a vector.
#[wasm_bindgen]
pub fn translate_sites(
    structure: JsCrystal,
    indices: Vec<u32>,
    vector: JsVector3,
    fractional: bool,
) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let mut struc = structure.to_structure()?;
        let idx: Vec<usize> = indices.into_iter().map(|idx| idx as usize).collect();

        let num_sites = struc.num_sites();
        for &site_idx in &idx {
            if site_idx >= num_sites {
                return Err(format!(
                    "Index {site_idx} out of bounds for structure with {num_sites} sites"
                ));
            }
        }

        struc.translate_sites(&idx, Vector3::from(vector.0), fractional);
        Ok(JsCrystal::from_structure(&struc))
    })();
    result.into()
}

/// Perturb all sites by random vectors.
#[wasm_bindgen]
pub fn perturb_structure(
    structure: JsCrystal,
    distance: f64,
    min_distance: Option<f64>,
    seed: Option<u64>,
) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
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
        let mut struc = structure.to_structure()?;
        struc.perturb(distance, min_distance, seed);
        Ok(JsCrystal::from_structure(&struc))
    })();
    result.into()
}

// === Element Information Functions ===

/// Get atomic mass for an element by symbol.
#[wasm_bindgen]
pub fn get_atomic_mass(symbol: &str) -> WasmResult<f64> {
    let result = Element::from_symbol(symbol)
        .map(|elem| elem.atomic_mass())
        .ok_or_else(|| format!("Unknown element: {symbol}"));
    result.into()
}

/// Get electronegativity for an element by symbol.
#[wasm_bindgen]
pub fn get_electronegativity(symbol: &str) -> WasmResult<f64> {
    let result = Element::from_symbol(symbol)
        .ok_or_else(|| format!("Unknown element: {symbol}"))
        .and_then(|elem| {
            elem.electronegativity()
                .ok_or_else(|| format!("No electronegativity data for {symbol}"))
        });
    result.into()
}

// === Slab Generation Functions ===

/// Generate a single slab from a bulk structure.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn make_slab(
    structure: JsCrystal,
    miller_index: JsMillerIndex,
    min_slab_size: f64,
    min_vacuum_size: f64,
    center_slab: bool,
    in_unit_planes: bool,
    primitive: bool,
    symprec: f64,
    termination_index: Option<u32>,
) -> WasmResult<JsCrystal> {
    use crate::structure::SlabConfig;

    let result: Result<JsCrystal, String> = (|| {
        let struc = structure.to_structure()?;
        let config = SlabConfig {
            miller_index: miller_index.0,
            min_slab_size,
            min_vacuum_size,
            center_slab,
            in_unit_planes,
            primitive,
            symprec,
            termination_index: termination_index.map(|idx| idx as usize),
        };
        let slab = struc.make_slab(&config).map_err(|err| err.to_string())?;
        Ok(JsCrystal::from_structure(&slab))
    })();
    result.into()
}

/// Generate multiple slabs with different terminations.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn generate_slabs(
    structure: JsCrystal,
    miller_index: JsMillerIndex,
    min_slab_size: f64,
    min_vacuum_size: f64,
    center_slab: bool,
    in_unit_planes: bool,
    primitive: bool,
    symprec: f64,
) -> WasmResult<Vec<JsCrystal>> {
    use crate::structure::SlabConfig;

    let result: Result<Vec<JsCrystal>, String> = (|| {
        let struc = structure.to_structure()?;
        let config = SlabConfig {
            miller_index: miller_index.0,
            min_slab_size,
            min_vacuum_size,
            center_slab,
            in_unit_planes,
            primitive,
            symprec,
            termination_index: None,
        };
        let slabs = struc
            .generate_slabs(&config)
            .map_err(|err| err.to_string())?;
        Ok(slabs.iter().map(JsCrystal::from_structure).collect())
    })();
    result.into()
}

// === Transformation Functions ===

/// Apply a symmetry operation to the structure.
/// The rotation matrix should be a 3x3 float matrix, and translation is a 3D vector.
/// If fractional is true, the operation is applied in fractional coordinates.
#[wasm_bindgen]
pub fn apply_operation(
    structure: JsCrystal,
    rotation: JsMatrix3x3,
    translation: JsVector3,
    fractional: bool,
) -> WasmResult<JsCrystal> {
    use crate::structure::SymmOp;
    use nalgebra::Matrix3;

    structure
        .to_structure()
        .map(|struc| {
            let r = &rotation.0;
            let rot_mat = Matrix3::from_row_slice(&[
                r[0][0], r[0][1], r[0][2], r[1][0], r[1][1], r[1][2], r[2][0], r[2][1], r[2][2],
            ]);
            let op = SymmOp::new(rot_mat, Vector3::from(translation.0));
            JsCrystal::from_structure(&struc.apply_operation_copy(&op, fractional))
        })
        .into()
}

/// Apply inversion symmetry to the structure.
#[wasm_bindgen]
pub fn apply_inversion(structure: JsCrystal, fractional: bool) -> WasmResult<JsCrystal> {
    use crate::structure::SymmOp;
    structure
        .to_structure()
        .map(|struc| {
            JsCrystal::from_structure(&struc.apply_operation_copy(&SymmOp::inversion(), fractional))
        })
        .into()
}

/// Substitute one species with another throughout the structure.
#[wasm_bindgen]
pub fn substitute_species(
    structure: JsCrystal,
    old_species: &str,
    new_species: &str,
) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let struc = structure.to_structure()?;
        let old = Species::from_string(old_species)
            .ok_or_else(|| format!("Invalid species string: {old_species}"))?;
        let new = Species::from_string(new_species)
            .ok_or_else(|| format!("Invalid species string: {new_species}"))?;
        let substituted = struc.substitute(old, new).map_err(|err| err.to_string())?;
        Ok(JsCrystal::from_structure(&substituted))
    })();
    result.into()
}

/// Remove all sites containing any of the specified species.
#[wasm_bindgen]
pub fn remove_species(structure: JsCrystal, species: Vec<String>) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let struc = structure.to_structure()?;
        let species_vec: Vec<Species> = species
            .iter()
            .map(|s| Species::from_string(s).ok_or_else(|| format!("Invalid species string: {s}")))
            .collect::<Result<_, _>>()?;
        let new_s = struc
            .remove_species(&species_vec)
            .map_err(|err| err.to_string())?;
        Ok(JsCrystal::from_structure(&new_s))
    })();
    result.into()
}

/// Remove sites at specific indices.
#[wasm_bindgen]
pub fn remove_sites(structure: JsCrystal, indices: Vec<u32>) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let struc = structure.to_structure()?;
        let idx: Vec<usize> = indices.into_iter().map(|idx| idx as usize).collect();
        let num_sites = struc.num_sites();
        for &site_idx in &idx {
            if site_idx >= num_sites {
                return Err(format!(
                    "Index {site_idx} out of bounds for structure with {num_sites} sites"
                ));
            }
        }
        let new_s = struc.remove_sites(&idx).map_err(|err| err.to_string())?;
        Ok(JsCrystal::from_structure(&new_s))
    })();
    result.into()
}

// === I/O Functions ===

/// Serialize structure to pymatgen-compatible JSON string.
#[wasm_bindgen]
pub fn structure_to_json(structure: JsCrystal) -> WasmResult<String> {
    structure
        .to_structure()
        .map(|struc| crate::io::structure_to_pymatgen_json(&struc))
        .into()
}

/// Convert structure to CIF format string.
#[wasm_bindgen]
pub fn structure_to_cif(structure: JsCrystal) -> WasmResult<String> {
    structure
        .to_structure()
        .map(|struc| crate::cif::structure_to_cif(&struc, None))
        .into()
}

/// Convert structure to POSCAR format string.
#[wasm_bindgen]
pub fn structure_to_poscar(structure: JsCrystal) -> WasmResult<String> {
    structure
        .to_structure()
        .map(|struc| crate::io::structure_to_poscar(&struc, None))
        .into()
}

// === XRD Functions ===

use crate::wasm_types::{JsHklInfo, JsXrdOptions, JsXrdPattern};

/// Compute powder X-ray diffraction pattern from a structure.
///
/// Options:
/// - wavelength: X-ray wavelength in Angstroms (default: 1.54184, Cu Kα)
/// - two_theta_range: [min, max] 2θ angles in degrees (default: [0, 180])
/// - debye_waller_factors: Element symbol -> B factor mapping
/// - scaled: Whether to scale intensities to 0-100 (default: true)
#[wasm_bindgen]
pub fn compute_xrd(
    structure: JsCrystal,
    options: Option<JsXrdOptions>,
) -> WasmResult<JsXrdPattern> {
    use crate::xrd::{XrdConfig, compute_xrd as xrd_compute};

    let result: Result<JsXrdPattern, String> = (|| {
        let struc = structure.to_structure()?;
        let opts = options.unwrap_or_default();

        if opts.wavelength <= 0.0 {
            return Err("wavelength must be positive".to_string());
        }

        let two_theta_range = opts
            .two_theta_range
            .map(|[min, max]| {
                if min < 0.0 || max > 180.0 || min >= max {
                    Err("two_theta_range must be [min, max] with 0 <= min < max <= 180".to_string())
                } else {
                    Ok((min, max))
                }
            })
            .transpose()?;

        let config = XrdConfig {
            wavelength: opts.wavelength,
            two_theta_range,
            debye_waller_factors: opts.debye_waller_factors,
            scaled: opts.scaled,
            ..Default::default()
        };

        let pattern = xrd_compute(&struc, &config);

        // Convert HklInfo to JsHklInfo
        let hkls: Vec<Vec<JsHklInfo>> = pattern
            .hkls
            .into_iter()
            .map(|families| {
                families
                    .into_iter()
                    .map(|info| JsHklInfo {
                        hkl: info.hkl,
                        multiplicity: info.multiplicity,
                    })
                    .collect()
            })
            .collect();

        Ok(JsXrdPattern {
            two_theta: pattern.two_theta,
            intensities: pattern.intensities,
            hkls,
            d_spacings: pattern.d_spacings,
        })
    })();
    result.into()
}

/// Get atomic scattering parameters (Cromer-Mann coefficients).
///
/// Returns the raw JSON string of scattering parameters for all elements.
/// This is the same data embedded in the WASM module, exposed for users
/// who need programmatic access to the coefficients.
#[wasm_bindgen]
pub fn get_atomic_scattering_params() -> String {
    crate::xrd::SCATTERING_PARAMS_JSON.to_string()
}

// === Composition Functions ===

/// Parse a chemical formula and return composition information.
///
/// Returns an object with:
/// - species: object mapping element/species symbols to amounts
/// - formula: the input formula normalized
/// - reducedFormula: reduced formula string
/// - formulaAnonymous: anonymous formula (e.g., "A2B3")
/// - formulaHill: Hill notation formula
/// - alphabeticalFormula: alphabetically sorted formula
/// - chemicalSystem: element system (e.g., "Fe-O")
/// - numAtoms: total number of atoms
/// - numElements: number of distinct elements
/// - weight: molecular weight in atomic mass units
/// - isElement: true if composition is a single element
/// - averageElectronegativity: average electronegativity (or null)
/// - totalElectrons: total number of electrons
#[wasm_bindgen]
pub fn parse_composition(formula: &str) -> WasmResult<JsCompositionInfo> {
    use crate::composition::Composition;

    let result: Result<JsCompositionInfo, String> = (|| {
        let comp = Composition::from_formula(formula).map_err(|e| e.to_string())?;

        // Build species as Vec of {element, amount} objects
        let species: Vec<JsElementAmount> = comp
            .iter()
            .map(|(sp, amt)| JsElementAmount {
                element: sp.to_string(),
                amount: *amt,
            })
            .collect();

        Ok(JsCompositionInfo {
            species,
            formula: comp.formula(),
            reduced_formula: comp.reduced_formula(),
            formula_anonymous: comp.anonymous_formula(),
            formula_hill: comp.hill_formula(),
            alphabetical_formula: comp.alphabetical_formula(),
            chemical_system: comp.chemical_system(),
            num_atoms: comp.num_atoms(),
            num_elements: comp.num_elements() as u32,
            weight: comp.weight(),
            is_element: comp.is_element(),
            average_electronegativity: comp.average_electroneg(),
            total_electrons: comp.total_electrons() as u32,
        })
    })();
    result.into()
}

fn parse_comp_and_elem(
    formula: &str,
    element: &str,
) -> Result<(crate::composition::Composition, Element), String> {
    let comp = crate::composition::Composition::from_formula(formula).map_err(|e| e.to_string())?;
    let elem =
        Element::from_symbol(element).ok_or_else(|| format!("Unknown element: {element}"))?;
    Ok((comp, elem))
}

/// Get atomic fraction of an element in a composition.
///
/// Returns the atomic fraction (0.0 to 1.0) or 0.0 if element not present.
#[wasm_bindgen]
pub fn get_atomic_fraction(formula: &str, element: &str) -> WasmResult<f64> {
    parse_comp_and_elem(formula, element)
        .map(|(comp, elem)| comp.get_atomic_fraction(elem))
        .into()
}

/// Get weight fraction of an element in a composition.
///
/// Returns the weight fraction (0.0 to 1.0) or 0.0 if element not present.
#[wasm_bindgen]
pub fn get_wt_fraction(formula: &str, element: &str) -> WasmResult<f64> {
    parse_comp_and_elem(formula, element)
        .map(|(comp, elem)| comp.get_wt_fraction(elem))
        .into()
}

// Converts composition to element amounts, stripping oxidation states.
// This is intentional for reduced/fractional composition which work at element level.
fn comp_to_element_amounts(comp: &crate::composition::Composition) -> Vec<JsElementAmount> {
    comp.iter()
        .map(|(sp, amt)| JsElementAmount {
            element: sp.element.symbol().to_string(),
            amount: *amt,
        })
        .collect()
}

/// Get reduced composition as array of {element, amount} objects.
///
/// Note: Returns element symbols only (e.g., "Fe"), stripping any oxidation states.
/// Use `parse_composition` if you need to preserve species with oxidation states.
#[wasm_bindgen]
pub fn reduced_composition(formula: &str) -> WasmResult<Vec<JsElementAmount>> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| comp_to_element_amounts(&c.reduced_composition()))
        .map_err(|e| e.to_string())
        .into()
}

/// Get fractional composition (atomic fractions) as array of {element, amount} objects.
///
/// Note: Returns element symbols only (e.g., "Fe"), stripping any oxidation states.
/// Use `parse_composition` if you need to preserve species with oxidation states.
#[wasm_bindgen]
pub fn fractional_composition(formula: &str) -> WasmResult<Vec<JsElementAmount>> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| comp_to_element_amounts(&c.fractional_composition()))
        .map_err(|e| e.to_string())
        .into()
}

/// Check if two compositions are approximately equal.
///
/// Uses relative tolerance of 0.01 (1%) and absolute tolerance of 1e-8.
#[wasm_bindgen]
pub fn compositions_almost_equal(formula1: &str, formula2: &str) -> WasmResult<bool> {
    use crate::composition::Composition;
    Composition::from_formula(formula1)
        .and_then(|c1| {
            Composition::from_formula(formula2).map(|c2| c1.almost_equals(&c2, 0.01, 1e-8))
        })
        .map_err(|e| e.to_string())
        .into()
}

/// Check if a composition is charge-balanced.
///
/// Returns null if any species lacks an oxidation state.
#[wasm_bindgen]
pub fn is_charge_balanced(formula: &str) -> WasmResult<Option<bool>> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| c.is_charge_balanced())
        .map_err(|e| e.to_string())
        .into()
}

/// Get the net charge of a composition.
///
/// Returns null if any species lacks an oxidation state, or if the charge is non-integer.
#[wasm_bindgen]
pub fn composition_charge(formula: &str) -> WasmResult<Option<i32>> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| c.charge())
        .map_err(|e| e.to_string())
        .into()
}

/// Get a hash of the reduced formula (ignores oxidation states).
///
/// Useful for grouping compositions by formula.
#[wasm_bindgen]
pub fn formula_hash(formula: &str) -> WasmResult<String> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| c.formula_hash().to_string())
        .map_err(|e| e.to_string())
        .into()
}

/// Get a hash of the composition including oxidation states.
///
/// Useful for exact matching of compositions.
#[wasm_bindgen]
pub fn species_hash(formula: &str) -> WasmResult<String> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| c.species_hash().to_string())
        .map_err(|e| e.to_string())
        .into()
}

// === Lattice Property Functions ===

// Helper to convert nalgebra Matrix3 to [[f64; 3]; 3]
fn mat3_to_array(m: &nalgebra::Matrix3<f64>) -> [[f64; 3]; 3] {
    [
        [m[(0, 0)], m[(0, 1)], m[(0, 2)]],
        [m[(1, 0)], m[(1, 1)], m[(1, 2)]],
        [m[(2, 0)], m[(2, 1)], m[(2, 2)]],
    ]
}

/// Get the metric tensor G = A * A^T of the lattice.
#[wasm_bindgen]
pub fn get_lattice_metric_tensor(structure: JsCrystal) -> WasmResult<[[f64; 3]; 3]> {
    structure
        .to_structure()
        .map(|s| mat3_to_array(&s.lattice.metric_tensor()))
        .into()
}

/// Get the inverse of the lattice matrix.
#[wasm_bindgen]
pub fn get_lattice_inv_matrix(structure: JsCrystal) -> WasmResult<[[f64; 3]; 3]> {
    structure
        .to_structure()
        .map(|s| mat3_to_array(&s.lattice.inv_matrix()))
        .into()
}

/// Get the reciprocal lattice matrix (2π convention).
#[wasm_bindgen]
pub fn get_reciprocal_lattice(structure: JsCrystal) -> WasmResult<[[f64; 3]; 3]> {
    structure
        .to_structure()
        .map(|s| mat3_to_array(s.lattice.reciprocal().matrix()))
        .into()
}

/// Get the LLL-reduced lattice matrix.
#[wasm_bindgen]
pub fn get_lll_reduced_lattice(structure: JsCrystal) -> WasmResult<[[f64; 3]; 3]> {
    structure
        .to_structure()
        .map(|s| mat3_to_array(&s.lattice.lll_matrix()))
        .into()
}

/// Get the transformation matrix to LLL-reduced basis.
#[wasm_bindgen]
pub fn get_lll_mapping(structure: JsCrystal) -> WasmResult<[[f64; 3]; 3]> {
    structure
        .to_structure()
        .map(|s| mat3_to_array(&s.lattice.lll_mapping()))
        .into()
}

// === Structure Symmetry Functions ===

/// Get the Pearson symbol (e.g., "cF8" for FCC).
#[wasm_bindgen]
pub fn get_pearson_symbol(structure: JsCrystal, symprec: f64) -> WasmResult<String> {
    structure
        .to_structure()
        .and_then(|struc| struc.get_pearson_symbol(symprec).map_err(|e| e.to_string()))
        .into()
}

/// Get the Hall number for spacegroup identification.
#[wasm_bindgen]
pub fn get_hall_number(structure: JsCrystal, symprec: f64) -> WasmResult<i32> {
    structure
        .to_structure()
        .and_then(|struc| struc.get_hall_number(symprec).map_err(|e| e.to_string()))
        .into()
}

/// Get site symmetry symbols for each site.
#[wasm_bindgen]
pub fn get_site_symmetry_symbols(structure: JsCrystal, symprec: f64) -> WasmResult<Vec<String>> {
    structure
        .to_structure()
        .and_then(|struc| {
            struc
                .get_site_symmetry_symbols(symprec)
                .map_err(|e| e.to_string())
        })
        .into()
}

/// Get equivalent site indices (orbits from symmetry analysis).
#[wasm_bindgen]
pub fn get_equivalent_sites(structure: JsCrystal, symprec: f64) -> WasmResult<Vec<u32>> {
    structure
        .to_structure()
        .and_then(|struc| {
            struc
                .get_equivalent_sites(symprec)
                .map(|v| v.into_iter().map(|x| x as u32).collect())
                .map_err(|e| e.to_string())
        })
        .into()
}

/// Check if two sites are periodic images of each other.
#[wasm_bindgen]
pub fn is_periodic_image(
    structure: JsCrystal,
    site_i: u32,
    site_j: u32,
    tolerance: f64,
) -> WasmResult<bool> {
    // Validate tolerance
    if !tolerance.is_finite() || tolerance < 0.0 {
        return WasmResult::err(format!(
            "tolerance must be finite and >= 0, got {tolerance}"
        ));
    }
    structure
        .to_structure()
        .and_then(|struc| {
            let num_sites = struc.num_sites();
            if site_i as usize >= num_sites {
                return Err(format!(
                    "site_i={site_i} out of bounds for structure with {num_sites} sites"
                ));
            }
            if site_j as usize >= num_sites {
                return Err(format!(
                    "site_j={site_j} out of bounds for structure with {num_sites} sites"
                ));
            }
            Ok(struc.is_periodic_image(site_i as usize, site_j as usize, tolerance))
        })
        .into()
}

// === Elastic Tensor Analysis ===

use crate::elastic;

// Helper to convert JsMatrix3x3 to nalgebra Matrix3
fn js_to_matrix3(m: &JsMatrix3x3) -> nalgebra::Matrix3<f64> {
    nalgebra::Matrix3::from_row_slice(&[
        m.0[0][0], m.0[0][1], m.0[0][2], m.0[1][0], m.0[1][1], m.0[1][2], m.0[2][0], m.0[2][1],
        m.0[2][2],
    ])
}

// Helper to convert nalgebra Matrix3 to JsMatrix3x3
fn matrix3_to_js(m: &nalgebra::Matrix3<f64>) -> JsMatrix3x3 {
    JsMatrix3x3([
        [m[(0, 0)], m[(0, 1)], m[(0, 2)]],
        [m[(1, 0)], m[(1, 1)], m[(1, 2)]],
        [m[(2, 0)], m[(2, 1)], m[(2, 2)]],
    ])
}

/// Generate strain matrices for elastic tensor calculation.
///
/// Returns 6 or 12 strain matrices depending on whether shear strains are included.
/// Each strain type is applied in both positive and negative directions.
#[wasm_bindgen]
pub fn elastic_generate_strains(magnitude: f64, shear: bool) -> WasmResult<Vec<JsMatrix3x3>> {
    if !magnitude.is_finite() || magnitude < 0.0 {
        return WasmResult::err("magnitude must be finite and non-negative");
    }
    let strains: Vec<_> = elastic::generate_strains(magnitude, shear)
        .iter()
        .map(matrix3_to_js)
        .collect();
    WasmResult::ok(strains)
}

/// Apply strain to a cell matrix.
///
/// Returns the deformed cell: cell_new = cell * (I + strain)
#[wasm_bindgen]
pub fn elastic_apply_strain(cell: JsMatrix3x3, strain: JsMatrix3x3) -> JsMatrix3x3 {
    let result = elastic::apply_strain(&js_to_matrix3(&cell), &js_to_matrix3(&strain));
    matrix3_to_js(&result)
}

/// Convert 3x3 stress tensor to 6-element Voigt notation [xx, yy, zz, yz, xz, xy].
#[wasm_bindgen]
pub fn elastic_stress_to_voigt(stress: JsMatrix3x3) -> Vec<f64> {
    elastic::stress_to_voigt(&js_to_matrix3(&stress)).to_vec()
}

/// Convert 3x3 strain tensor to 6-element Voigt notation [xx, yy, zz, 2*yz, 2*xz, 2*xy].
#[wasm_bindgen]
pub fn elastic_strain_to_voigt(strain: JsMatrix3x3) -> Vec<f64> {
    elastic::strain_to_voigt(&js_to_matrix3(&strain)).to_vec()
}

/// Compute 6x6 elastic tensor from stress-strain data using SVD pseudoinverse.
///
/// Returns flat array of 36 elements in row-major order (compatible with
/// elastic_bulk_modulus, elastic_shear_modulus, elastic_is_stable).
#[wasm_bindgen]
pub fn elastic_tensor_from_stresses(
    strains: Vec<JsMatrix3x3>,
    stresses: Vec<JsMatrix3x3>,
) -> WasmResult<Vec<f64>> {
    if strains.len() != stresses.len() {
        return WasmResult::err("Strains and stresses must have same length");
    }
    if strains.is_empty() {
        return WasmResult::err("At least one strain-stress pair required");
    }
    let strain_mats: Vec<_> = strains.iter().map(js_to_matrix3).collect();
    let stress_mats: Vec<_> = stresses.iter().map(js_to_matrix3).collect();
    let tensor = elastic::elastic_tensor_from_stresses(&strain_mats, &stress_mats);
    // Flatten to row-major for consistency with modulus functions
    WasmResult::ok(tensor.iter().flat_map(|row| row.iter().copied()).collect())
}

/// Compute Voigt-Reuss-Hill bulk modulus from 6x6 elastic tensor.
///
/// tensor: flat array of 36 elements in row-major order
#[wasm_bindgen]
pub fn elastic_bulk_modulus(tensor: Vec<f64>) -> WasmResult<f64> {
    match tensor_flat_to_array(&tensor) {
        Ok(arr) => WasmResult::ok(elastic::bulk_modulus(&arr)),
        Err(err) => WasmResult::err(err),
    }
}

/// Compute Voigt-Reuss-Hill shear modulus from 6x6 elastic tensor.
///
/// tensor: flat array of 36 elements in row-major order
#[wasm_bindgen]
pub fn elastic_shear_modulus(tensor: Vec<f64>) -> WasmResult<f64> {
    match tensor_flat_to_array(&tensor) {
        Ok(arr) => WasmResult::ok(elastic::shear_modulus(&arr)),
        Err(err) => WasmResult::err(err),
    }
}

/// Compute Young's modulus from bulk (k) and shear (g) moduli: E = 9KG / (3K + G).
#[wasm_bindgen]
pub fn elastic_youngs_modulus(bulk: f64, shear: f64) -> f64 {
    elastic::youngs_modulus(bulk, shear)
}

/// Compute Poisson's ratio from bulk (k) and shear (g) moduli: nu = (3K - 2G) / (6K + 2G).
#[wasm_bindgen]
pub fn elastic_poisson_ratio(bulk: f64, shear: f64) -> f64 {
    elastic::poisson_ratio(bulk, shear)
}

/// Check if elastic tensor satisfies mechanical stability (positive definite).
///
/// tensor: flat array of 36 elements in row-major order
#[wasm_bindgen]
pub fn elastic_is_stable(tensor: Vec<f64>) -> WasmResult<bool> {
    match tensor_flat_to_array(&tensor) {
        Ok(arr) => WasmResult::ok(elastic::is_mechanically_stable(&arr)),
        Err(err) => WasmResult::err(err),
    }
}

/// Compute Zener anisotropy ratio for cubic crystals: A = 2*C44 / (C11 - C12).
/// A = 1 for isotropic materials.
#[wasm_bindgen]
pub fn elastic_zener_ratio(c11: f64, c12: f64, c44: f64) -> f64 {
    elastic::zener_ratio(c11, c12, c44)
}

// Helper to convert flat Vec<f64> (36 elements) to [[f64; 6]; 6]
fn tensor_flat_to_array(tensor: &[f64]) -> Result<[[f64; 6]; 6], String> {
    if tensor.len() != 36 {
        return Err(format!(
            "Expected 36 elements for 6x6 tensor, got {}",
            tensor.len()
        ));
    }
    let mut arr = [[0.0; 6]; 6];
    for row in 0..6 {
        for col in 0..6 {
            arr[row][col] = tensor[row * 6 + col];
        }
    }
    Ok(arr)
}

// === Bond Orientational Order Parameters (Steinhardt) ===

use crate::order_params;

/// Compute Steinhardt q_l order parameter for each atom.
///
/// l is typically 4 or 6. cutoff is the neighbor distance in Angstrom.
/// Returns q_l values for each atom.
#[wasm_bindgen]
pub fn compute_steinhardt_q(
    structure: JsCrystal,
    degree: i32,
    cutoff: f64,
) -> WasmResult<Vec<f64>> {
    if cutoff < 0.0 {
        return WasmResult::err("Cutoff must be non-negative");
    }
    structure
        .to_structure()
        .map(|struc| order_params::compute_steinhardt_q(&struc, degree, cutoff))
        .into()
}

/// Classify local structure based on q4 and q6 values.
///
/// Returns structure type: "fcc", "bcc", "hcp", "icosahedral", "liquid", or "unknown".
#[wasm_bindgen]
pub fn classify_local_structure(q4: f64, q6: f64, tolerance: f64) -> String {
    order_params::classify_local_structure(q4, q6, tolerance)
        .as_str()
        .to_string()
}

/// Classify all atoms in a structure based on their local order parameters.
///
/// Returns structure type string for each atom.
#[wasm_bindgen]
pub fn classify_all_atoms(
    structure: JsCrystal,
    cutoff: f64,
    tolerance: f64,
) -> WasmResult<Vec<String>> {
    if cutoff < 0.0 {
        return WasmResult::err("Cutoff must be non-negative");
    }
    structure
        .to_structure()
        .map(|struc| {
            order_params::classify_all_atoms(&struc, cutoff, tolerance)
                .iter()
                .map(|s| s.as_str().to_string())
                .collect()
        })
        .into()
}

// === Trajectory Analysis (MSD, VACF, Diffusion) ===

use crate::trajectory::{MsdCalculator, VacfCalculator};

// Helper to parse flat [x0,y0,z0,x1,y1,z1,...] to Vec<Vector3>
fn parse_flat_vec3(data: &[f64], n_atoms: usize) -> Result<Vec<Vector3<f64>>, String> {
    if data.len() != n_atoms * 3 {
        return Err(format!(
            "Expected {} values ({}*3), got {}",
            n_atoms * 3,
            n_atoms,
            data.len()
        ));
    }
    Ok(data
        .chunks(3)
        .map(|c| Vector3::new(c[0], c[1], c[2]))
        .collect())
}

// Helper to parse flat 9-element cell array to Matrix3 (row-major)
fn parse_flat_cell(data: Option<&[f64]>) -> Result<Option<nalgebra::Matrix3<f64>>, String> {
    match data {
        None => Ok(None),
        Some(cell) => {
            if cell.len() != 9 {
                return Err(format!("Cell must have 9 elements, got {}", cell.len()));
            }
            Ok(Some(nalgebra::Matrix3::new(
                cell[0], cell[1], cell[2], cell[3], cell[4], cell[5], cell[6], cell[7], cell[8],
            )))
        }
    }
}

/// Streaming MSD calculator for large trajectories.
///
/// Usage: create with new(), add frames with add_frame(), get result with compute_msd().
#[wasm_bindgen]
pub struct JsMsdCalculator {
    inner: MsdCalculator,
}

#[wasm_bindgen]
impl JsMsdCalculator {
    /// Create a new MSD calculator.
    ///
    /// n_atoms: number of atoms in each frame (must be > 0)
    /// max_lag: maximum lag time in frames
    /// origin_interval: frames between time origins (must be > 0, smaller = more samples)
    #[wasm_bindgen(constructor)]
    pub fn new(
        n_atoms: usize,
        max_lag: usize,
        origin_interval: usize,
    ) -> Result<JsMsdCalculator, JsError> {
        if n_atoms == 0 {
            return Err(JsError::new("n_atoms must be > 0"));
        }
        if origin_interval == 0 {
            return Err(JsError::new("origin_interval must be > 0"));
        }
        Ok(JsMsdCalculator {
            inner: MsdCalculator::new(n_atoms, max_lag, origin_interval),
        })
    }

    /// Add a frame to the MSD calculation.
    ///
    /// positions: flat array of [x0, y0, z0, x1, y1, z1, ...] for all atoms
    #[wasm_bindgen]
    pub fn add_frame(&mut self, positions: Vec<f64>) -> WasmResult<()> {
        match parse_flat_vec3(&positions, self.inner.n_atoms()) {
            Ok(pos_vec) => {
                self.inner.add_frame(&pos_vec);
                WasmResult::ok(())
            }
            Err(err) => WasmResult::err(err),
        }
    }

    /// Compute final MSD values averaged over all atoms.
    ///
    /// Returns MSD values for each lag time (length = max_lag + 1).
    #[wasm_bindgen]
    pub fn compute_msd(&self) -> Vec<f64> {
        self.inner.compute_msd()
    }

    /// Compute MSD for each atom separately.
    ///
    /// Returns flattened array of shape (max_lag+1, n_atoms) in row-major order:
    /// `[msd_lag0_atom0, msd_lag0_atom1, ..., msd_lag1_atom0, msd_lag1_atom1, ...]`
    ///
    /// To access MSD for atom `a` at lag `t`: `result[t * n_atoms + a]`
    #[wasm_bindgen]
    pub fn compute_msd_per_atom(&self) -> Vec<f64> {
        self.inner
            .compute_msd_per_atom()
            .into_iter()
            .flatten()
            .collect()
    }

    /// Get number of atoms.
    #[wasm_bindgen]
    pub fn n_atoms(&self) -> usize {
        self.inner.n_atoms()
    }

    /// Get maximum lag time in frames.
    #[wasm_bindgen]
    pub fn max_lag(&self) -> usize {
        self.inner.max_lag()
    }
}

/// Streaming VACF calculator for large trajectories.
#[wasm_bindgen]
pub struct JsVacfCalculator {
    inner: VacfCalculator,
}

#[wasm_bindgen]
impl JsVacfCalculator {
    /// Create a new VACF calculator.
    ///
    /// n_atoms: number of atoms in each frame (must be > 0)
    /// max_lag: maximum lag time in frames
    /// origin_interval: frames between time origins (must be > 0, smaller = more samples)
    #[wasm_bindgen(constructor)]
    pub fn new(
        n_atoms: usize,
        max_lag: usize,
        origin_interval: usize,
    ) -> Result<JsVacfCalculator, JsError> {
        if n_atoms == 0 {
            return Err(JsError::new("n_atoms must be > 0"));
        }
        if origin_interval == 0 {
            return Err(JsError::new("origin_interval must be > 0"));
        }
        Ok(JsVacfCalculator {
            inner: VacfCalculator::new(n_atoms, max_lag, origin_interval),
        })
    }

    /// Add a frame to the VACF calculation.
    ///
    /// velocities: flat array of [vx0, vy0, vz0, vx1, vy1, vz1, ...] for all atoms
    #[wasm_bindgen]
    pub fn add_frame(&mut self, velocities: Vec<f64>) -> WasmResult<()> {
        match parse_flat_vec3(&velocities, self.inner.n_atoms()) {
            Ok(vel_vec) => {
                self.inner.add_frame(&vel_vec);
                WasmResult::ok(())
            }
            Err(err) => WasmResult::err(err),
        }
    }

    /// Compute final VACF values.
    #[wasm_bindgen]
    pub fn compute_vacf(&self) -> Vec<f64> {
        self.inner.compute_vacf()
    }

    /// Compute normalized VACF (VACF(t) / VACF(0)).
    #[wasm_bindgen]
    pub fn compute_normalized_vacf(&self) -> Vec<f64> {
        self.inner.compute_normalized_vacf()
    }

    /// Get number of atoms.
    #[wasm_bindgen]
    pub fn n_atoms(&self) -> usize {
        self.inner.n_atoms()
    }

    /// Get maximum lag time in frames.
    #[wasm_bindgen]
    pub fn max_lag(&self) -> usize {
        self.inner.max_lag()
    }
}

/// Compute diffusion coefficient from MSD using Einstein relation.
///
/// D = MSD / (2 * dim * t) fitted in the linear regime.
///
/// Returns array of length 2: `[diffusion_coefficient, r_squared]`
/// where r_squared indicates fit quality (1.0 = perfect linear fit).
#[wasm_bindgen]
pub fn diffusion_from_msd(
    msd: Vec<f64>,
    times: Vec<f64>,
    dim: usize,
    start_fraction: f64,
    end_fraction: f64,
) -> WasmResult<Vec<f64>> {
    if msd.len() != times.len() {
        return WasmResult::err("MSD and times must have same length");
    }
    if dim == 0 {
        return WasmResult::err("dim must be > 0");
    }
    if !(0.0..=1.0).contains(&start_fraction) || !(0.0..=1.0).contains(&end_fraction) {
        return WasmResult::err("start_fraction and end_fraction must be in [0, 1]");
    }
    if start_fraction >= end_fraction {
        return WasmResult::err("start_fraction must be < end_fraction");
    }
    let (diff, r2) = crate::trajectory::diffusion_coefficient_from_msd(
        &msd,
        &times,
        dim,
        start_fraction,
        end_fraction,
    );
    WasmResult::ok(vec![diff, r2])
}

/// Compute diffusion coefficient from VACF using Green-Kubo relation.
///
/// D = (1/dim) * integral_0^inf VACF(t) dt
#[wasm_bindgen]
pub fn diffusion_from_vacf(vacf: Vec<f64>, dt: f64, dim: usize) -> WasmResult<f64> {
    if dim == 0 {
        return WasmResult::err("dim must be > 0");
    }
    if dt <= 0.0 {
        return WasmResult::err("dt must be positive");
    }
    WasmResult::ok(crate::trajectory::diffusion_coefficient_from_vacf(
        &vacf, dt, dim,
    ))
}

// === Molecule I/O Functions ===

/// Parse a molecule from pymatgen Molecule JSON string.
///
/// Returns the parsed molecule JSON string in pymatgen-compatible format.
#[wasm_bindgen]
pub fn parse_molecule_json(json: &str) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let mol = crate::io::parse_molecule_json(json).map_err(|e| e.to_string())?;
        Ok(crate::io::molecule_to_pymatgen_json(&mol))
    })();
    result.into()
}

/// Convert a molecule to XYZ format string.
#[wasm_bindgen]
pub fn molecule_to_xyz_str(json: &str, comment: Option<String>) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let mol = crate::io::parse_molecule_json(json).map_err(|e| e.to_string())?;
        Ok(crate::io::molecule_to_xyz(&mol, comment.as_deref()))
    })();
    result.into()
}

/// Parse a molecule from XYZ format string.
///
/// Returns the molecule JSON string in pymatgen Molecule.as_dict() format.
#[wasm_bindgen]
pub fn parse_xyz_str(content: &str) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let mol = crate::io::parse_xyz_str(content).map_err(|e| e.to_string())?;
        Ok(crate::io::molecule_to_pymatgen_json(&mol))
    })();
    result.into()
}

// === ASE Atoms Conversion Functions ===

/// Convert an ASE Atoms dict to pymatgen format.
///
/// Returns JSON string for either a Structure or Molecule depending on periodicity.
#[wasm_bindgen]
pub fn ase_to_pymatgen(ase_atoms: JsAseAtoms) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let json = serde_json::to_string(&ase_atoms).map_err(|e| e.to_string())?;
        crate::io::ase_atoms_to_pymatgen_json(&json).map_err(|e| e.to_string())
    })();
    result.into()
}

/// Convert a pymatgen Structure to ASE Atoms dict format.
#[wasm_bindgen]
pub fn structure_to_ase(structure: JsCrystal) -> WasmResult<JsAseAtoms> {
    let result: Result<JsAseAtoms, String> = (|| {
        let struc = structure.to_structure()?;
        let ase_dict = crate::io::structure_to_ase_atoms_dict(&struc);
        serde_json::from_value(ase_dict).map_err(|e| format!("Deserialization error: {e}"))
    })();
    result.into()
}

/// Convert a pymatgen Molecule JSON to ASE Atoms dict format.
#[wasm_bindgen]
pub fn molecule_to_ase(molecule_json: &str) -> WasmResult<JsAseAtoms> {
    let result: Result<JsAseAtoms, String> = (|| {
        let mol = crate::io::parse_molecule_json(molecule_json).map_err(|e| e.to_string())?;
        let ase_dict = crate::io::molecule_to_ase_atoms_dict(&mol);
        serde_json::from_value(ase_dict).map_err(|e| format!("Deserialization error: {e}"))
    })();
    result.into()
}

/// Result type for parse_ase_atoms containing type name and JSON data.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsAseParseResult {
    /// "Structure" or "Molecule"
    #[serde(rename = "type")]
    pub type_name: String,
    /// JSON string in pymatgen format
    pub data: String,
}

/// Parse ASE Atoms dict and determine if it's a Structure or Molecule.
///
/// Returns { type: "Structure" | "Molecule", data: pymatgen_json_string }.
#[wasm_bindgen]
#[allow(deprecated)]
pub fn parse_ase_atoms(ase_atoms: JsAseAtoms) -> WasmResult<JsAseParseResult> {
    let result: Result<JsAseParseResult, String> = (|| {
        let json = serde_json::to_string(&ase_atoms).map_err(|e| e.to_string())?;

        let (type_name, pymatgen_json) =
            match crate::io::parse_ase_atoms_json(&json).map_err(|e| e.to_string())? {
                crate::io::StructureOrMolecule::Structure(s) => (
                    "Structure".to_string(),
                    crate::io::structure_to_pymatgen_json(&s),
                ),
                crate::io::StructureOrMolecule::Molecule(m) => (
                    "Molecule".to_string(),
                    crate::io::molecule_to_pymatgen_json(&m),
                ),
            };

        Ok(JsAseParseResult {
            type_name,
            data: pymatgen_json,
        })
    })();
    result.into()
}

// === Cell Operations (PBC, Reductions, Supercells) ===

use crate::cell_ops;

/// Result type for Niggli reduction.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsNiggliResult {
    /// Flattened 3x3 Niggli matrix (row-major, 9 elements)
    pub matrix: Vec<f64>,
    /// Flattened 3x3 transformation matrix (row-major, 9 elements)
    pub transformation: Vec<f64>,
    /// Niggli form type: "TypeI" or "TypeII"
    pub form: String,
}

/// Wrap all site positions to the unit cell [0, 1)^3.
#[wasm_bindgen]
pub fn cell_wrap_to_unit_cell(structure: JsCrystal) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let mut struc = structure.to_structure()?;
        struc.wrap_to_unit_cell();
        Ok(JsCrystal::from_structure(&struc))
    })();
    result.into()
}

/// Check if a lattice is already Niggli-reduced.
#[wasm_bindgen]
pub fn cell_is_niggli_reduced(structure: JsCrystal, tolerance: f64) -> WasmResult<bool> {
    let result: Result<bool, String> = (|| {
        let struc = structure.to_structure()?;
        Ok(cell_ops::is_niggli_reduced(&struc.lattice, tolerance))
    })();
    result.into()
}

// === Point Defect Generation (WASM) ===

use crate::defects;

/// Create a vacancy by removing an atom at the specified site index.
///
/// Returns JSON with 'structure' (defective structure) and defect info.
#[wasm_bindgen]
pub fn defect_create_vacancy(structure: JsCrystal, site_idx: u32) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let defect_result =
            defects::create_vacancy(&struc, site_idx as usize).map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&defect_result.structure).unwrap_or_default(),
            "defect_type": defect_result.defect.defect_type.as_str(),
            "site_idx": defect_result.defect.site_idx,
            "position": defect_result.defect.position.as_slice(),
            "original_species": defect_result.defect.original_species.map(|s| s.to_string()),
        });
        Ok(json.to_string())
    })();
    result.into()
}

// === Interatomic Potentials ===

use crate::potentials;

/// Result from potential calculation.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsPotentialResult {
    /// Total potential energy in eV
    pub energy: f64,
    /// Forces on each atom [Fx, Fy, Fz] in eV/Å (flat array)
    pub forces: Vec<f64>,
    /// Optional 3x3 stress tensor in eV/Å³ (Voigt: xx, yy, zz, yz, xz, xy)
    pub stress: Option<[f64; 6]>,
}

fn potential_result_to_js(result: &potentials::PotentialResult) -> JsPotentialResult {
    let forces: Vec<f64> = result.forces.iter().flat_map(|f| [f.x, f.y, f.z]).collect();
    let stress = result.stress.as_ref().map(|s| {
        // Convert 3x3 to Voigt notation: xx, yy, zz, yz, xz, xy
        [
            s[(0, 0)],
            s[(1, 1)],
            s[(2, 2)],
            s[(1, 2)],
            s[(0, 2)],
            s[(0, 1)],
        ]
    });
    JsPotentialResult {
        energy: result.energy,
        forces,
        stress,
    }
}

/// Compute Lennard-Jones potential energy and forces.
///
/// V(r) = 4ε[(σ/r)¹² - (σ/r)⁶]
///
/// positions: flat array [x0, y0, z0, x1, y1, z1, ...] in Angstrom
/// cell: optional 3x3 cell matrix as flat array [a1, a2, a3, b1, b2, b3, c1, c2, c3]
/// pbc_x, pbc_y, pbc_z: periodic boundary conditions
/// sigma: LJ sigma in Angstrom (default: 3.4 for Ar)
/// epsilon: LJ epsilon in eV (default: 0.0103 for Ar)
/// cutoff: optional cutoff distance in Angstrom
/// compute_stress: whether to compute stress tensor
#[wasm_bindgen]
pub fn compute_lennard_jones(
    positions: Vec<f64>,
    cell: Option<Vec<f64>>,
    pbc_x: bool,
    pbc_y: bool,
    pbc_z: bool,
    sigma: f64,
    epsilon: f64,
    cutoff: Option<f64>,
    compute_stress: bool,
) -> WasmResult<JsPotentialResult> {
    let result: Result<JsPotentialResult, String> = (|| {
        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms)?;
        let cell_mat = parse_flat_cell(cell.as_deref())?;
        let pbc = [pbc_x, pbc_y, pbc_z];

        let params = potentials::LennardJonesParams::new(sigma, epsilon, cutoff);
        let result =
            potentials::compute_lj_full(&pos_vec, cell_mat.as_ref(), pbc, &params, compute_stress);
        Ok(potential_result_to_js(&result))
    })();
    result.into()
}

/// Create a substitutional defect by replacing the species at a site.
#[wasm_bindgen]
pub fn defect_create_substitution(
    structure: JsCrystal,
    site_idx: u32,
    new_species: &str,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let species = Species::from_string(new_species)
            .ok_or_else(|| format!("Invalid species: {new_species}"))?;
        let defect_result = defects::create_substitution(&struc, site_idx as usize, species)
            .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&defect_result.structure).unwrap_or_default(),
            "defect_type": defect_result.defect.defect_type.as_str(),
            "site_idx": defect_result.defect.site_idx,
            "position": defect_result.defect.position.as_slice(),
            "species": defect_result.defect.species.map(|s| s.to_string()),
            "original_species": defect_result.defect.original_species.map(|s| s.to_string()),
        });
        Ok(json.to_string())
    })();
    result.into()
}

/// Compute Morse potential energy and forces.
///
/// V(r) = D * (1 - exp(-α(r - r₀)))² - D
///
/// positions: flat array [x0, y0, z0, x1, y1, z1, ...] in Angstrom
/// cell: optional 3x3 cell matrix as flat array
/// pbc_x, pbc_y, pbc_z: periodic boundary conditions
/// d: well depth in eV
/// alpha: width parameter in 1/Angstrom
/// r0: equilibrium distance in Angstrom
/// cutoff: cutoff distance in Angstrom
/// compute_stress: whether to compute stress tensor
#[wasm_bindgen]
pub fn compute_morse(
    positions: Vec<f64>,
    cell: Option<Vec<f64>>,
    pbc_x: bool,
    pbc_y: bool,
    pbc_z: bool,
    d: f64,
    alpha: f64,
    r0: f64,
    cutoff: f64,
    compute_stress: bool,
) -> WasmResult<JsPotentialResult> {
    let result: Result<JsPotentialResult, String> = (|| {
        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms)?;
        let cell_mat = parse_flat_cell(cell.as_deref())?;
        let pbc = [pbc_x, pbc_y, pbc_z];

        let result = potentials::compute_morse_simple(
            &pos_vec,
            cell_mat.as_ref(),
            pbc,
            d,
            alpha,
            r0,
            cutoff,
            compute_stress,
        );
        Ok(potential_result_to_js(&result))
    })();
    result.into()
}

/// Create an interstitial by adding an atom at a fractional position.
#[wasm_bindgen]
pub fn defect_create_interstitial(
    structure: JsCrystal,
    position: Vec<f64>,
    species: &str,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        if position.len() != 3 {
            return Err("Position must have 3 elements".to_string());
        }
        let struc = structure.to_structure()?;
        let new_species =
            Species::from_string(species).ok_or_else(|| format!("Invalid species: {species}"))?;
        let frac_pos = nalgebra::Vector3::new(position[0], position[1], position[2]);
        let defect_result = defects::create_interstitial(&struc, frac_pos, new_species)
            .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&defect_result.structure).unwrap_or_default(),
            "defect_type": defect_result.defect.defect_type.as_str(),
            "position": defect_result.defect.position.as_slice(),
            "species": defect_result.defect.species.map(|s| s.to_string()),
        });
        Ok(json.to_string())
    })();
    result.into()
}

/// Compute soft sphere potential energy and forces.
///
/// V(r) = ε(σ/r)^α
///
/// positions: flat array [x0, y0, z0, x1, y1, z1, ...] in Angstrom
/// cell: optional 3x3 cell matrix as flat array
/// pbc_x, pbc_y, pbc_z: periodic boundary conditions
/// sigma: length scale in Angstrom
/// epsilon: energy scale in eV
/// alpha: exponent (default 12, use 2 for soft spheres)
/// cutoff: cutoff distance in Angstrom
/// compute_stress: whether to compute stress tensor
#[wasm_bindgen]
pub fn compute_soft_sphere(
    positions: Vec<f64>,
    cell: Option<Vec<f64>>,
    pbc_x: bool,
    pbc_y: bool,
    pbc_z: bool,
    sigma: f64,
    epsilon: f64,
    alpha: f64,
    cutoff: f64,
    compute_stress: bool,
) -> WasmResult<JsPotentialResult> {
    let result: Result<JsPotentialResult, String> = (|| {
        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms)?;
        let cell_mat = parse_flat_cell(cell.as_deref())?;
        let pbc = [pbc_x, pbc_y, pbc_z];

        let result = potentials::compute_soft_sphere_simple(
            &pos_vec,
            cell_mat.as_ref(),
            pbc,
            sigma,
            epsilon,
            alpha,
            cutoff,
            compute_stress,
        );
        Ok(potential_result_to_js(&result))
    })();
    result.into()
}

/// Compute harmonic bond energy and forces.
///
/// V = 0.5 * k * (r - r₀)²
///
/// positions: flat array [x0, y0, z0, x1, y1, z1, ...] in Angstrom
/// bonds: flat array [i0, j0, k0, r0_0, i1, j1, k1, r0_1, ...] where
///        i,j are atom indices, k is spring constant (eV/Å²), r0 is equilibrium distance (Å)
/// cell: optional 3x3 cell matrix as flat array
/// pbc_x, pbc_y, pbc_z: periodic boundary conditions
/// compute_stress: whether to compute stress tensor
#[wasm_bindgen]
pub fn compute_harmonic_bonds(
    positions: Vec<f64>,
    bonds: Vec<f64>,
    cell: Option<Vec<f64>>,
    pbc_x: bool,
    pbc_y: bool,
    pbc_z: bool,
    compute_stress: bool,
) -> WasmResult<JsPotentialResult> {
    let result: Result<JsPotentialResult, String> = (|| {
        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms)?;
        let cell_mat = parse_flat_cell(cell.as_deref())?;
        let pbc = [pbc_x, pbc_y, pbc_z];

        // Parse bonds: [i, j, k, r0, ...]
        if bonds.len() % 4 != 0 {
            return Err("bonds array length must be divisible by 4".to_string());
        }
        let mut bond_vec: Vec<potentials::HarmonicBond> = Vec::with_capacity(bonds.len() / 4);
        for (bond_idx, chunk) in bonds.chunks(4).enumerate() {
            let idx_i = chunk[0];
            let idx_j = chunk[1];

            // Validate indices: must be finite, non-negative, integer, and within bounds
            if !idx_i.is_finite() || idx_i < 0.0 || idx_i.fract() != 0.0 {
                return Err(format!(
                    "bond {bond_idx}: atom index i={idx_i} is invalid (must be finite non-negative integer)"
                ));
            }
            if !idx_j.is_finite() || idx_j < 0.0 || idx_j.fract() != 0.0 {
                return Err(format!(
                    "bond {bond_idx}: atom index j={idx_j} is invalid (must be finite non-negative integer)"
                ));
            }

            let idx_i_usize = idx_i as usize;
            let idx_j_usize = idx_j as usize;

            if idx_i_usize >= n_atoms {
                return Err(format!(
                    "bond {bond_idx}: atom index i={idx_i_usize} out of bounds (n_atoms={n_atoms})"
                ));
            }
            if idx_j_usize >= n_atoms {
                return Err(format!(
                    "bond {bond_idx}: atom index j={idx_j_usize} out of bounds (n_atoms={n_atoms})"
                ));
            }

            // Optionally validate k and r0 are finite
            if !chunk[2].is_finite() {
                return Err(format!(
                    "bond {bond_idx}: spring constant k={} must be finite",
                    chunk[2]
                ));
            }
            if !chunk[3].is_finite() {
                return Err(format!(
                    "bond {bond_idx}: equilibrium distance r0={} must be finite",
                    chunk[3]
                ));
            }

            bond_vec.push(potentials::HarmonicBond::new(
                idx_i_usize,
                idx_j_usize,
                chunk[2],
                chunk[3],
            ));
        }

        let result = potentials::compute_harmonic_bonds(
            &pos_vec,
            &bond_vec,
            cell_mat.as_ref(),
            pbc,
            compute_stress,
        )
        .map_err(|e| e.to_string())?;
        Ok(potential_result_to_js(&result))
    })();
    result.into()
}

/// Create an antisite pair by swapping species at two sites.
#[wasm_bindgen]
pub fn defect_create_antisite(
    structure: JsCrystal,
    site_a_idx: u32,
    site_b_idx: u32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let n_sites = struc.num_sites();
        if site_a_idx as usize >= n_sites || site_b_idx as usize >= n_sites {
            return Err(format!(
                "Site indices ({}, {}) out of bounds for structure with {} sites",
                site_a_idx, site_b_idx, n_sites
            ));
        }
        let species_a = struc.species()[site_a_idx as usize];
        let species_b = struc.species()[site_b_idx as usize];
        let swapped =
            defects::create_antisite_pair(&struc, site_a_idx as usize, site_b_idx as usize)
                .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&swapped).unwrap_or_default(),
            "defect_type": "antisite",
            "site_a_idx": site_a_idx,
            "site_b_idx": site_b_idx,
            "species_a_original": species_a.to_string(),
            "species_b_original": species_b.to_string(),
        });
        Ok(json.to_string())
    })();
    result.into()
}

/// Find potential interstitial sites using Voronoi tessellation.
///
/// Returns JSON array of sites with frac_coords, cart_coords, min_distance, coordination, site_type.
#[wasm_bindgen]
pub fn defect_find_interstitial_sites(
    structure: JsCrystal,
    min_dist: f64,
    symprec: f64,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        // Validate min_dist: must be finite and positive
        if !min_dist.is_finite() || min_dist <= 0.0 {
            return Err("min_dist must be positive and finite".to_string());
        }

        let struc = structure.to_structure()?;
        let sites = defects::find_voronoi_interstitials(&struc, Some(min_dist), symprec);
        let json_sites: Vec<serde_json::Value> = sites
            .into_iter()
            .map(|site| {
                serde_json::json!({
                    "frac_coords": site.frac_coords.as_slice(),
                    "cart_coords": site.cart_coords.as_slice(),
                    "min_distance": site.min_distance,
                    "coordination": site.coordination,
                    "site_type": site.site_type.as_str(),
                })
            })
            .collect();
        Ok(serde_json::to_string(&json_sites).unwrap_or_default())
    })();
    result.into()
}

/// Find an optimal supercell matrix for dilute defect calculations.
///
/// Returns flat array of 9 integers [a1,a2,a3, b1,b2,b3, c1,c2,c3].
#[wasm_bindgen]
pub fn defect_find_supercell(
    structure: JsCrystal,
    min_image_dist: f64,
    max_atoms: u32,
    cubic_preference: f64,
) -> WasmResult<Vec<i32>> {
    let result: Result<Vec<i32>, String> = (|| {
        // Validate min_image_dist: must be finite and positive
        if !min_image_dist.is_finite() || min_image_dist <= 0.0 {
            return Err("min_image_dist must be positive and finite".to_string());
        }
        // Validate max_atoms: must be positive
        if max_atoms == 0 {
            return Err("max_atoms must be greater than 0".to_string());
        }

        let struc = structure.to_structure()?;
        let config = defects::DefectSupercellConfig {
            min_distance: min_image_dist,
            max_atoms: max_atoms as usize,
            cubic_preference,
        };
        let matrix =
            defects::find_defect_supercell(&struc, &config).map_err(|err| err.to_string())?;
        Ok(vec![
            matrix[0][0],
            matrix[0][1],
            matrix[0][2],
            matrix[1][0],
            matrix[1][1],
            matrix[1][2],
            matrix[2][0],
            matrix[2][1],
            matrix[2][2],
        ])
    })();
    result.into()
}

/// Classify an interstitial site based on its coordination number.
#[wasm_bindgen]
pub fn defect_classify_site(coordination: u32) -> String {
    defects::classify_interstitial_site(coordination as usize)
        .as_str()
        .to_string()
}

/// Generate a doped-compatible name for a point defect.
#[wasm_bindgen]
pub fn defect_generate_name(
    defect_type: &str,
    species: Option<String>,
    original_species: Option<String>,
    wyckoff: Option<String>,
    site_type: Option<String>,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        use crate::defects::{DefectType, PointDefect};
        use crate::species::Species;
        use nalgebra::Vector3;

        let dtype = match defect_type.to_lowercase().as_str() {
            "vacancy" => DefectType::Vacancy,
            "interstitial" => DefectType::Interstitial,
            "substitution" => DefectType::Substitution,
            "antisite" => DefectType::Antisite,
            other => return Err(format!("Unknown defect type: {other}")),
        };

        let species_parsed = species.as_ref().and_then(|s| Species::from_string(s));
        let original_parsed = original_species
            .as_ref()
            .and_then(|s| Species::from_string(s));

        let defect = PointDefect {
            defect_type: dtype,
            site_idx: None,
            position: Vector3::zeros(),
            species: species_parsed,
            original_species: original_parsed,
            charge: 0,
        };

        Ok(defect.name(wyckoff.as_deref(), site_type.as_deref()))
    })();
    result.into()
}

/// Guess likely charge states for a point defect based on oxidation state probabilities.
///
/// Returns JSON array of {charge, probability, reasoning} objects.
#[wasm_bindgen]
pub fn defect_guess_charge_states(
    defect_type: &str,
    removed_species: Option<String>,
    added_species: Option<String>,
    original_species: Option<String>,
    max_charge: i32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        use crate::defects::DefectType;
        use crate::oxidation::guess_defect_charge_states;

        let dtype = match defect_type.to_lowercase().as_str() {
            "vacancy" => DefectType::Vacancy,
            "interstitial" => DefectType::Interstitial,
            "substitution" => DefectType::Substitution,
            "antisite" => DefectType::Antisite,
            other => return Err(format!("Unknown defect type: {other}")),
        };

        let guesses = guess_defect_charge_states(
            dtype,
            removed_species.as_deref(),
            added_species.as_deref(),
            original_species.as_deref(),
            max_charge,
        );

        let json_guesses: Vec<serde_json::Value> = guesses
            .into_iter()
            .map(|guess| {
                serde_json::json!({
                    "charge": guess.charge,
                    "probability": guess.probability,
                    "reasoning": guess.reasoning,
                })
            })
            .collect();
        Ok(serde_json::to_string(&json_guesses).unwrap_or_default())
    })();
    result.into()
}

/// Get Wyckoff labels for all sites in a structure.
///
/// Returns JSON array of {label, multiplicity, site_symmetry} objects.
#[wasm_bindgen]
pub fn defect_get_wyckoff_labels(structure: JsCrystal, symprec: f64) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let wyckoffs = struc
            .get_wyckoff_sites(symprec)
            .map_err(|err| err.to_string())?;
        let json_sites: Vec<serde_json::Value> = wyckoffs
            .into_iter()
            .map(|wyk| {
                serde_json::json!({
                    "label": wyk.label,
                    "multiplicity": wyk.multiplicity,
                    "site_symmetry": wyk.site_symmetry,
                })
            })
            .collect();
        Ok(serde_json::to_string(&json_sites).unwrap_or_default())
    })();
    result.into()
}

// === Structure Distortions (WASM) ===

use crate::distortions;

/// Distort bonds around a defect site by specified factors.
///
/// Returns JSON array of distorted structures with metadata.
#[wasm_bindgen]
pub fn defect_distort_bonds(
    structure: JsCrystal,
    center_site_idx: u32,
    distortion_factors: Vec<f64>,
    num_neighbors: Option<u32>,
    cutoff: f64,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        // Validate cutoff: must be positive and finite (core function requires > 0)
        if !cutoff.is_finite() || cutoff <= 0.0 {
            return Err("cutoff must be positive and finite".to_string());
        }

        let struc = structure.to_structure()?;
        let results = distortions::distort_bonds(
            &struc,
            center_site_idx as usize,
            &distortion_factors,
            num_neighbors.map(|n| n as usize),
            cutoff,
        )
        .map_err(|err| err.to_string())?;

        let json_results: Vec<serde_json::Value> = results
            .into_iter()
            .map(|res| {
                serde_json::json!({
                    "structure": serde_json::to_value(&res.structure).unwrap_or_default(),
                    "distortion_type": res.distortion_type,
                    "distortion_factor": res.distortion_factor,
                    "center_site_idx": res.center_site_idx,
                })
            })
            .collect();
        Ok(serde_json::to_string(&json_results).unwrap_or_default())
    })();
    result.into()
}

/// Create a dimer by moving two atoms closer together.
#[wasm_bindgen]
pub fn defect_create_dimer(
    structure: JsCrystal,
    site_a_idx: u32,
    site_b_idx: u32,
    target_distance: f64,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        // Validate target_distance: must be finite and positive
        if !target_distance.is_finite() || target_distance <= 0.0 {
            return Err("target_distance must be positive and finite".to_string());
        }

        let struc = structure.to_structure()?;
        let res = distortions::create_dimer(
            &struc,
            site_a_idx as usize,
            site_b_idx as usize,
            target_distance,
        )
        .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&res.structure).unwrap_or_default(),
            "distortion_type": res.distortion_type,
            "distortion_factor": res.distortion_factor,
        });
        Ok(json.to_string())
    })();
    result.into()
}

/// Apply Monte Carlo rattling - random displacements to all atoms.
#[wasm_bindgen]
pub fn defect_rattle(
    structure: JsCrystal,
    stdev: f64,
    seed: u32,
    min_distance: f64,
    max_attempts: u32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        // Validate stdev: must be non-negative and finite
        if !stdev.is_finite() || stdev < 0.0 {
            return Err("stdev must be non-negative and finite".to_string());
        }
        // Validate min_distance: must be non-negative and finite
        if !min_distance.is_finite() || min_distance < 0.0 {
            return Err("min_distance must be non-negative and finite".to_string());
        }
        // Validate max_attempts: must be positive
        if max_attempts == 0 {
            return Err("max_attempts must be greater than 0".to_string());
        }

        let struc = structure.to_structure()?;
        let res = distortions::rattle_structure(
            &struc,
            stdev,
            seed as u64,
            min_distance,
            max_attempts as usize,
        )
        .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&res.structure).unwrap_or_default(),
            "distortion_type": res.distortion_type,
            "distortion_factor": res.distortion_factor,
        });
        Ok(json.to_string())
    })();
    result.into()
}

/// Apply local rattling with distance-dependent amplitude decay.
#[wasm_bindgen]
pub fn defect_local_rattle(
    structure: JsCrystal,
    center_site_idx: u32,
    max_amplitude: f64,
    decay_radius: f64,
    seed: u32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        // Validate max_amplitude: must be non-negative and finite
        if !max_amplitude.is_finite() || max_amplitude < 0.0 {
            return Err("max_amplitude must be non-negative and finite".to_string());
        }
        // Validate decay_radius: must be positive and finite
        if !decay_radius.is_finite() || decay_radius <= 0.0 {
            return Err("decay_radius must be positive and finite".to_string());
        }

        let struc = structure.to_structure()?;
        let res = distortions::local_rattle(
            &struc,
            center_site_idx as usize,
            max_amplitude,
            decay_radius,
            seed as u64,
        )
        .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&res.structure).unwrap_or_default(),
            "distortion_type": res.distortion_type,
            "distortion_factor": res.distortion_factor,
            "center_site_idx": res.center_site_idx,
        });
        Ok(json.to_string())
    })();
    result.into()
}

// === Defect Generator (WASM) ===

/// Generate all point defects for a structure.
///
/// Returns JSON object with supercell_matrix, vacancies, substitutions,
/// interstitials, antisites, spacegroup, n_defects.
#[wasm_bindgen]
pub fn defect_generate_all(
    structure: JsCrystal,
    extrinsic_json: &str,
    include_vacancies: bool,
    include_substitutions: bool,
    include_interstitials: bool,
    include_antisites: bool,
    supercell_min_dist: f64,
    supercell_max_atoms: u32,
    interstitial_min_dist: Option<f64>,
    symprec: f64,
    max_charge: i32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let extrinsic: Vec<String> = if extrinsic_json.is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(extrinsic_json)
                .map_err(|err| format!("Invalid extrinsic_json: {err}"))?
        };

        let config = crate::defects::DefectsGeneratorConfig {
            extrinsic,
            include_vacancies,
            include_substitutions,
            include_interstitials,
            include_antisites,
            supercell_min_dist,
            supercell_max_atoms: supercell_max_atoms as usize,
            interstitial_min_dist,
            symprec,
            max_charge,
        };

        let result =
            crate::defects::generate_all_defects(&struc, &config).map_err(|err| err.to_string())?;

        // Convert DefectEntry to JSON
        fn entry_to_json(entry: &crate::defects::DefectEntry) -> serde_json::Value {
            serde_json::json!({
                "name": entry.name,
                "defect_type": format!("{:?}", entry.defect_type),
                "site_idx": entry.site_idx,
                "frac_coords": entry.frac_coords.as_slice(),
                "species": entry.species,
                "original_species": entry.original_species,
                "wyckoff": entry.wyckoff,
                "site_symmetry": entry.site_symmetry,
                "equivalent_sites": entry.equivalent_sites,
                "charge_states": entry.charge_states.iter().map(|cs| {
                    serde_json::json!({
                        "charge": cs.charge,
                        "probability": cs.probability,
                        "reasoning": cs.reasoning,
                    })
                }).collect::<Vec<_>>(),
            })
        }

        let json = serde_json::json!({
            "supercell_matrix": result.supercell_matrix,
            "vacancies": result.vacancies.iter().map(entry_to_json).collect::<Vec<_>>(),
            "substitutions": result.substitutions.iter().map(entry_to_json).collect::<Vec<_>>(),
            "interstitials": result.interstitials.iter().map(entry_to_json).collect::<Vec<_>>(),
            "antisites": result.antisites.iter().map(entry_to_json).collect::<Vec<_>>(),
            "spacegroup": result.spacegroup,
            "n_defects": result.n_defects,
        });
        Ok(json.to_string())
    })();
    result.into()
}

// === Surface Analysis (WASM) ===

use crate::surfaces;

/// Enumerate all unique Miller indices up to a maximum index value.
///
/// Returns JSON array of [h, k, l] arrays.
#[wasm_bindgen]
pub fn surface_enumerate_miller(max_index: i32) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let indices: Vec<[i32; 3]> = surfaces::enumerate_miller_indices(max_index)
            .into_iter()
            .map(|mi| mi.to_array())
            .collect();
        Ok(serde_json::to_string(&indices).unwrap_or_default())
    })();
    result.into()
}

/// Get the normal vector for a Miller plane.
///
/// Returns JSON array [x, y, z] of the unit normal.
#[wasm_bindgen]
pub fn surface_miller_to_normal(
    structure: JsCrystal,
    h: i32,
    k: i32,
    l: i32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let normal = surfaces::miller_to_normal(&struc.lattice, [h, k, l]);
        Ok(serde_json::to_string(normal.as_slice()).unwrap_or_default())
    })();
    result.into()
}

/// Enumerate all unique surface terminations for a Miller index.
///
/// Returns JSON array of termination objects with miller_index, shift,
/// surface_species, surface_density, is_polar, and slab structure.
#[wasm_bindgen]
pub fn surface_enumerate_terminations(
    structure: JsCrystal,
    h: i32,
    k: i32,
    l: i32,
    min_slab: f64,
    min_vacuum: f64,
    symprec: f64,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        // Validate min_slab: must be finite and positive
        if !min_slab.is_finite() || min_slab <= 0.0 {
            return Err("min_slab must be positive and finite".to_string());
        }
        // Validate min_vacuum: must be finite and positive
        if !min_vacuum.is_finite() || min_vacuum <= 0.0 {
            return Err("min_vacuum must be positive and finite".to_string());
        }

        let struc = structure.to_structure()?;
        let miller = surfaces::MillerIndex::new(h, k, l);
        let config = surfaces::SlabConfigExt::new(miller)
            .with_min_slab_size(min_slab)
            .with_min_vacuum(min_vacuum);

        let terminations = surfaces::enumerate_terminations(&struc, miller, &config, symprec)
            .map_err(|err| err.to_string())?;

        let json_terms: Vec<serde_json::Value> = terminations
            .into_iter()
            .map(|term| {
                serde_json::json!({
                    "miller_index": term.miller_index.to_array(),
                    "shift": term.shift,
                    "surface_species": term.surface_species.iter().map(|sp| sp.to_string()).collect::<Vec<_>>(),
                    "surface_density": term.surface_density,
                    "is_polar": term.is_polar,
                    "slab": crate::io::structure_to_pymatgen_json(&term.slab),
                })
            })
            .collect();

        Ok(serde_json::to_string(&json_terms).unwrap_or_default())
    })();
    result.into()
}

/// Compute Lennard-Jones forces only.
///
/// Returns flat array of forces [Fx0, Fy0, Fz0, Fx1, Fy1, Fz1, ...] in eV/Å.
#[wasm_bindgen]
pub fn compute_lennard_jones_forces(
    positions: Vec<f64>,
    cell: Option<Vec<f64>>,
    pbc_x: bool,
    pbc_y: bool,
    pbc_z: bool,
    sigma: f64,
    epsilon: f64,
    cutoff: Option<f64>,
) -> WasmResult<Vec<f64>> {
    let result: Result<Vec<f64>, String> = (|| {
        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms)?;
        let cell_mat = parse_flat_cell(cell.as_deref())?;
        let pbc = [pbc_x, pbc_y, pbc_z];

        let params = potentials::LennardJonesParams::new(sigma, epsilon, cutoff);
        let result = potentials::compute_lennard_jones(&pos_vec, cell_mat.as_ref(), pbc, &params);
        Ok(result.forces.iter().flat_map(|f| [f.x, f.y, f.z]).collect())
    })();
    result.into()
}

// === MD Integrators ===

use crate::integrators;
use crate::optimizers;

/// MD simulation state for WASM.
#[wasm_bindgen]
pub struct JsMDState {
    inner: integrators::MDState,
}

#[wasm_bindgen]
impl JsMDState {
    /// Create a new MD state.
    ///
    /// positions: flat array [x0, y0, z0, x1, y1, z1, ...] in Angstrom
    /// masses: array of atomic masses in amu
    #[wasm_bindgen(constructor)]
    pub fn new(positions: Vec<f64>, masses: Vec<f64>) -> Result<JsMDState, JsError> {
        let n_atoms = masses.len();
        if positions.len() != n_atoms * 3 {
            return Err(JsError::new(&format!(
                "positions length {} must be 3 * masses length {}",
                positions.len(),
                n_atoms
            )));
        }
        let pos_vec: Vec<Vector3<f64>> = positions
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        Ok(JsMDState {
            inner: integrators::MDState::new(pos_vec, masses),
        })
    }

    /// Get positions as flat array.
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f64> {
        self.inner
            .positions
            .iter()
            .flat_map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Set positions from flat array.
    #[wasm_bindgen(setter)]
    pub fn set_positions(&mut self, positions: Vec<f64>) {
        let n_atoms = self.inner.num_atoms();
        if positions.len() == n_atoms * 3 {
            self.inner.positions = positions
                .chunks(3)
                .map(|c| Vector3::new(c[0], c[1], c[2]))
                .collect();
        }
    }

    /// Get velocities as flat array.
    #[wasm_bindgen(getter)]
    pub fn velocities(&self) -> Vec<f64> {
        self.inner
            .velocities
            .iter()
            .flat_map(|v| [v.x, v.y, v.z])
            .collect()
    }

    /// Set velocities from flat array.
    #[wasm_bindgen(setter)]
    pub fn set_velocities(&mut self, velocities: Vec<f64>) {
        let n_atoms = self.inner.num_atoms();
        if velocities.len() == n_atoms * 3 {
            self.inner.velocities = velocities
                .chunks(3)
                .map(|c| Vector3::new(c[0], c[1], c[2]))
                .collect();
        }
    }

    /// Get forces as flat array.
    #[wasm_bindgen(getter)]
    pub fn forces(&self) -> Vec<f64> {
        self.inner
            .forces
            .iter()
            .flat_map(|f| [f.x, f.y, f.z])
            .collect()
    }

    /// Set forces from flat array.
    #[wasm_bindgen(setter)]
    pub fn set_forces(&mut self, forces: Vec<f64>) {
        let n_atoms = self.inner.num_atoms();
        if forces.len() == n_atoms * 3 {
            self.inner.forces = forces
                .chunks(3)
                .map(|c| Vector3::new(c[0], c[1], c[2]))
                .collect();
        }
    }

    /// Get masses.
    #[wasm_bindgen(getter)]
    pub fn masses(&self) -> Vec<f64> {
        self.inner.masses.clone()
    }

    /// Number of atoms.
    #[wasm_bindgen(getter)]
    pub fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }

    /// Initialize velocities from Maxwell-Boltzmann distribution.
    #[wasm_bindgen]
    pub fn init_velocities(&mut self, temperature_k: f64, seed: Option<u64>) {
        self.inner.init_velocities(temperature_k, seed);
    }

    /// Compute kinetic energy in eV.
    #[wasm_bindgen]
    pub fn kinetic_energy(&self) -> f64 {
        self.inner.kinetic_energy()
    }

    /// Compute temperature in Kelvin.
    #[wasm_bindgen]
    pub fn temperature(&self) -> f64 {
        self.inner.temperature()
    }

    /// Set cell matrix (9 elements, row-major).
    #[wasm_bindgen]
    pub fn set_cell(&mut self, cell: Vec<f64>, pbc_x: bool, pbc_y: bool, pbc_z: bool) {
        if cell.len() == 9 {
            self.inner.cell = Some(nalgebra::Matrix3::new(
                cell[0], cell[1], cell[2], cell[3], cell[4], cell[5], cell[6], cell[7], cell[8],
            ));
            self.inner.pbc = [pbc_x, pbc_y, pbc_z];
        }
    }
}

/// Perform one velocity Verlet MD step.
///
/// forces: flat array of current forces [Fx0, Fy0, Fz0, ...] in eV/Angstrom
/// dt: timestep in femtoseconds
///
/// Returns new forces array that should be used for next step.
/// The caller must compute forces at the new positions and pass them to the next call.
#[wasm_bindgen]
pub fn md_velocity_verlet_step(
    state: &mut JsMDState,
    forces: Vec<f64>,
    dt_fs: f64,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }

        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();

        state.inner.set_forces(&force_vec);

        // Velocity Verlet: half-step velocity, full-step position, then caller computes new forces
        let dt_internal = dt_fs * integrators::units::FS_TO_INTERNAL;
        let half_dt = 0.5 * dt_internal;

        for idx in 0..n_atoms {
            let mass = state.inner.masses[idx];
            let accel = state.inner.forces[idx] / mass;
            state.inner.velocities[idx] += half_dt * accel;
            state.inner.positions[idx] += dt_internal * state.inner.velocities[idx];
        }

        Ok(())
    })();
    result.into()
}

/// Get surface atoms in a slab structure.
///
/// Returns JSON array of site indices.
#[wasm_bindgen]
pub fn surface_get_surface_atoms(slab: JsCrystal, tolerance: f64) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        // Validate tolerance: must be finite and positive
        if !tolerance.is_finite() || tolerance <= 0.0 {
            return Err("tolerance must be positive and finite".to_string());
        }

        let struc = slab.to_structure()?;
        let atoms = surfaces::get_surface_atoms(&struc, tolerance);
        Ok(serde_json::to_string(&atoms).unwrap_or_default())
    })();
    result.into()
}

/// Complete the velocity Verlet step after computing new forces.
#[wasm_bindgen]
pub fn md_velocity_verlet_finalize(
    state: &mut JsMDState,
    new_forces: Vec<f64>,
    dt_fs: f64,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        if new_forces.len() != n_atoms * 3 {
            return Err(format!(
                "new_forces length {} must be {} (3 * n_atoms)",
                new_forces.len(),
                n_atoms * 3
            ));
        }

        let force_vec: Vec<Vector3<f64>> = new_forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();

        state.inner.set_forces(&force_vec);

        let dt_internal = dt_fs * integrators::units::FS_TO_INTERNAL;
        let half_dt = 0.5 * dt_internal;

        for idx in 0..n_atoms {
            let mass = state.inner.masses[idx];
            let accel = state.inner.forces[idx] / mass;
            state.inner.velocities[idx] += half_dt * accel;
        }

        Ok(())
    })();
    result.into()
}

/// Calculate surface area of a slab.
#[wasm_bindgen]
pub fn surface_area(slab: JsCrystal) -> WasmResult<f64> {
    let result: Result<f64, String> = (|| {
        let struc = slab.to_structure()?;
        Ok(surfaces::surface_area(&struc))
    })();
    result.into()
}

/// Calculate surface energy from slab and bulk energies.
#[wasm_bindgen]
pub fn surface_calculate_energy(
    slab_energy: f64,
    bulk_energy_per_atom: f64,
    n_atoms: u32,
    surface_area: f64,
) -> f64 {
    // Validate surface_area: return NaN for zero or non-finite values to avoid division-by-zero
    if surface_area == 0.0 || !surface_area.is_finite() {
        return f64::NAN;
    }
    surfaces::calculate_surface_energy(
        slab_energy,
        bulk_energy_per_atom,
        n_atoms as usize,
        surface_area,
    )
}

/// Find adsorption sites on a slab surface.
///
/// Returns JSON array of adsorption site objects.
#[wasm_bindgen]
pub fn surface_find_adsorption_sites(
    slab: JsCrystal,
    height: f64,
    site_types_json: &str,
    neighbor_cutoff: Option<f64>,
    surface_tolerance: Option<f64>,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        // Validate height: must be finite and non-negative (zero = on surface plane)
        if !height.is_finite() || height < 0.0 {
            return Err("height must be non-negative and finite".to_string());
        }
        // Validate neighbor_cutoff if provided: must be finite and positive
        if let Some(cutoff) = neighbor_cutoff {
            if !cutoff.is_finite() || cutoff <= 0.0 {
                return Err("neighbor_cutoff must be positive and finite".to_string());
            }
        }

        let struc = slab.to_structure()?;
        let site_types: Option<Vec<surfaces::AdsorptionSiteType>> = if site_types_json.is_empty() {
            None
        } else {
            let strings: Vec<String> = serde_json::from_str(site_types_json)
                .map_err(|err| format!("Invalid site types JSON: {err}"))?;
            let parsed: Vec<surfaces::AdsorptionSiteType> = strings
                .iter()
                .filter_map(|s| surfaces::AdsorptionSiteType::parse(s))
                .collect();
            if parsed.is_empty() {
                None
            } else {
                Some(parsed)
            }
        };
        let sites = surfaces::find_adsorption_sites(
            &struc,
            height,
            site_types.as_deref(),
            neighbor_cutoff,
            surface_tolerance,
        )
        .map_err(|err| err.to_string())?;
        let json_sites: Vec<serde_json::Value> = sites
            .into_iter()
            .map(|site| {
                serde_json::json!({
                    "site_type": site.site_type,
                    "position": site.position.as_slice(),
                    "cart_position": site.cart_position.as_slice(),
                    "height": site.height,
                    "coordinating_atoms": site.coordinating_atoms,
                })
            })
            .collect();
        Ok(serde_json::to_string(&json_sites).unwrap_or_default())
    })();
    result.into()
}

/// Compute Wulff shape from surface energies.
///
/// surface_energies_json: JSON array of [[h,k,l], energy] pairs.
/// Returns JSON object with facets, total_surface_area, volume, sphericity.
#[wasm_bindgen]
pub fn surface_compute_wulff(
    structure: JsCrystal,
    surface_energies_json: &str,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let raw: Vec<(Vec<i32>, f64)> = serde_json::from_str(surface_energies_json)
            .map_err(|err| format!("Invalid surface energies JSON: {err}"))?;
        let mut surface_energies: Vec<(surfaces::MillerIndex, f64)> = Vec::with_capacity(raw.len());
        for (hkl, energy) in raw {
            if hkl.len() < 3 {
                return Err(format!(
                    "Invalid Miller index: expected 3 components, got {}",
                    hkl.len()
                ));
            }
            surface_energies.push((surfaces::MillerIndex::new(hkl[0], hkl[1], hkl[2]), energy));
        }
        let wulff = surfaces::compute_wulff_shape(&struc.lattice, &surface_energies)
            .map_err(|err| err.to_string())?;
        let facets_json: Vec<serde_json::Value> = wulff
            .facets
            .iter()
            .map(|facet| {
                serde_json::json!({
                    "miller_index": facet.miller_index.to_array(),
                    "surface_energy": facet.surface_energy,
                    "normal": facet.normal.as_slice(),
                    "area_fraction": facet.area_fraction,
                })
            })
            .collect();
        let json = serde_json::json!({
            "facets": facets_json,
            "total_surface_area": wulff.total_surface_area,
            "volume": wulff.volume,
            "sphericity": wulff.sphericity,
        });
        Ok(json.to_string())
    })();
    result.into()
}

/// Langevin dynamics integrator for NVT ensemble.
#[wasm_bindgen]
pub struct JsLangevinIntegrator {
    inner: integrators::LangevinIntegrator,
}

#[wasm_bindgen]
impl JsLangevinIntegrator {
    /// Create a new Langevin integrator.
    ///
    /// temperature_k: target temperature in Kelvin
    /// friction: friction coefficient in 1/fs
    /// dt: timestep in femtoseconds
    /// seed: optional RNG seed for reproducibility
    #[wasm_bindgen(constructor)]
    pub fn new(
        temperature_k: f64,
        friction: f64,
        dt: f64,
        seed: Option<u64>,
    ) -> JsLangevinIntegrator {
        JsLangevinIntegrator {
            inner: integrators::LangevinIntegrator::new(temperature_k, friction, dt, seed),
        }
    }

    /// Set target temperature.
    #[wasm_bindgen]
    pub fn set_temperature(&mut self, temperature_k: f64) {
        self.inner.set_temperature(temperature_k);
    }

    /// Set friction coefficient.
    #[wasm_bindgen]
    pub fn set_friction(&mut self, friction: f64) {
        self.inner.set_friction(friction);
    }

    /// Set timestep.
    #[wasm_bindgen]
    pub fn set_dt(&mut self, dt: f64) {
        self.inner.set_dt(dt);
    }
}

/// Perform one Langevin dynamics step (for use with JS force callback).
///
/// This version takes forces directly rather than a callback,
/// since JS callbacks across WASM boundary are complex.
#[wasm_bindgen]
pub fn langevin_step_with_forces(
    integrator: &mut JsLangevinIntegrator,
    state: &mut JsMDState,
    forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }

        // Set forces on state before step (integrator uses state.forces for first half-step)
        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        state.inner.forces = force_vec.clone();

        integrator
            .inner
            .step(&mut state.inner, |_positions| force_vec.clone());
        Ok(())
    })();
    result.into()
}

// === Cell Operations (WASM) - JSON-returning variants ===

/// Calculate minimum image distance between two fractional positions.
#[wasm_bindgen]
pub fn cell_minimum_image_distance(
    structure: JsCrystal,
    frac1: Vec<f64>,
    frac2: Vec<f64>,
) -> WasmResult<f64> {
    let result: Result<f64, String> = (|| {
        let struc = structure.to_structure()?;
        if frac1.len() != 3 || frac2.len() != 3 {
            return Err("Fractional coords must have 3 components".to_string());
        }
        let f1 = Vector3::new(frac1[0], frac1[1], frac1[2]);
        let f2 = Vector3::new(frac2[0], frac2[1], frac2[2]);
        Ok(cell_ops::minimum_image_distance(
            &struc.lattice,
            &f1,
            &f2,
            [true, true, true],
        ))
    })();
    result.into()
}

/// Calculate minimum image vector between two fractional positions.
///
/// Returns JSON array [x, y, z] of the Cartesian displacement.
#[wasm_bindgen]
pub fn cell_minimum_image_vector(
    structure: JsCrystal,
    frac1: Vec<f64>,
    frac2: Vec<f64>,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        if frac1.len() != 3 || frac2.len() != 3 {
            return Err("Fractional coords must have 3 components".to_string());
        }
        let f1 = Vector3::new(frac1[0], frac1[1], frac1[2]);
        let f2 = Vector3::new(frac2[0], frac2[1], frac2[2]);
        let delta = f2 - f1;
        let vec = cell_ops::minimum_image_vector(&struc.lattice, &delta, [true, true, true]);
        Ok(serde_json::to_string(vec.as_slice()).unwrap_or_default())
    })();
    result.into()
}

/// Perform Niggli reduction on a lattice.
///
/// Returns JSON object with reduced lattice matrix and transformation matrix.
#[wasm_bindgen]
pub fn cell_niggli_reduce(structure: JsCrystal, tolerance: f64) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let niggli =
            cell_ops::niggli_reduce(&struc.lattice, tolerance).map_err(|err| err.to_string())?;
        let lattice_matrix: Vec<Vec<f64>> = (0..3)
            .map(|idx| niggli.matrix.row(idx).iter().copied().collect())
            .collect();
        let json = serde_json::json!({
            "lattice_matrix": lattice_matrix,
            "transformation": niggli.transformation,
        });
        Ok(json.to_string())
    })();
    result.into()
}

// === Thermostats ===

/// Nose-Hoover chain thermostat for NVT ensemble.
#[wasm_bindgen]
pub struct JsNoseHooverChain {
    inner: integrators::NoseHooverChain,
}

#[wasm_bindgen]
impl JsNoseHooverChain {
    /// Create a new Nose-Hoover chain thermostat.
    ///
    /// target_temp: target temperature in Kelvin
    /// tau: coupling time constant in femtoseconds
    /// dt: timestep in femtoseconds
    /// n_dof: number of degrees of freedom (typically 3 * n_atoms - 3)
    #[wasm_bindgen(constructor)]
    pub fn new(target_temp: f64, tau: f64, dt: f64, n_dof: usize) -> JsNoseHooverChain {
        JsNoseHooverChain {
            inner: integrators::NoseHooverChain::new(target_temp, tau, dt, n_dof),
        }
    }

    /// Set target temperature.
    #[wasm_bindgen]
    pub fn set_temperature(&mut self, target_temp: f64) {
        self.inner.set_temperature(target_temp);
    }
}

/// Perform one Nose-Hoover chain step with provided forces.
#[wasm_bindgen]
pub fn nose_hoover_step_with_forces(
    thermostat: &mut JsNoseHooverChain,
    state: &mut JsMDState,
    forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }

        // Set forces on state before step (integrator uses state.forces for first half-step)
        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        state.inner.forces = force_vec.clone();

        thermostat
            .inner
            .step(&mut state.inner, |_positions| force_vec.clone());
        Ok(())
    })();
    result.into()
}

/// Perform Delaunay reduction on a lattice.
///
/// Returns JSON object with reduced lattice matrix and transformation matrix.
#[wasm_bindgen]
pub fn cell_delaunay_reduce(structure: JsCrystal, tolerance: f64) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let delaunay =
            cell_ops::delaunay_reduce(&struc.lattice, tolerance).map_err(|err| err.to_string())?;
        let lattice_matrix: Vec<Vec<f64>> = (0..3)
            .map(|idx| delaunay.matrix.row(idx).iter().copied().collect())
            .collect();
        let json = serde_json::json!({
            "lattice_matrix": lattice_matrix,
            "transformation": delaunay.transformation,
        });
        Ok(json.to_string())
    })();
    result.into()
}

/// Velocity rescaling thermostat (stochastic, canonical sampling).
#[wasm_bindgen]
pub struct JsVelocityRescale {
    inner: integrators::VelocityRescale,
}

#[wasm_bindgen]
impl JsVelocityRescale {
    /// Create a new velocity rescale thermostat.
    ///
    /// target_temp: target temperature in Kelvin
    /// tau: coupling time constant in femtoseconds
    /// dt: timestep in femtoseconds
    /// n_dof: number of degrees of freedom
    /// seed: optional RNG seed
    #[wasm_bindgen(constructor)]
    pub fn new(
        target_temp: f64,
        tau: f64,
        dt: f64,
        n_dof: usize,
        seed: Option<u64>,
    ) -> JsVelocityRescale {
        JsVelocityRescale {
            inner: integrators::VelocityRescale::new(target_temp, tau, dt, n_dof, seed),
        }
    }

    /// Set target temperature.
    #[wasm_bindgen]
    pub fn set_temperature(&mut self, target_temp: f64) {
        self.inner.set_temperature(target_temp);
    }
}

/// Perform one velocity rescale step with provided forces.
#[wasm_bindgen]
pub fn velocity_rescale_step_with_forces(
    thermostat: &mut JsVelocityRescale,
    state: &mut JsMDState,
    forces: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }

        // Set forces on state before step (integrator uses state.forces for first half-step)
        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        state.inner.forces = force_vec.clone();

        thermostat
            .inner
            .step(&mut state.inner, |_positions| force_vec.clone());
        Ok(())
    })();
    result.into()
}

/// Find supercell transformation matrix for target atom count.
///
/// Returns JSON array [[a1,a2,a3],[b1,b2,b3],[c1,c2,c3]].
#[wasm_bindgen]
pub fn cell_find_supercell_matrix(structure: JsCrystal, target_atoms: u32) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let matrix = cell_ops::find_supercell_for_target_atoms(
            &struc.lattice,
            struc.num_sites(),
            target_atoms as usize,
        );
        Ok(serde_json::to_string(&matrix).unwrap_or_default())
    })();
    result.into()
}

// === NPT Ensemble ===

/// State for NPT molecular dynamics with variable cell.
#[wasm_bindgen]
pub struct JsNPTState {
    inner: integrators::NPTState,
}

#[wasm_bindgen]
impl JsNPTState {
    /// Create a new NPT state.
    ///
    /// positions: flat array [x0, y0, z0, ...] in Angstrom
    /// masses: array of atomic masses in amu
    /// cell: 9-element cell matrix (row-major) in Angstrom
    /// pbc_x, pbc_y, pbc_z: periodic boundary conditions
    #[wasm_bindgen(constructor)]
    pub fn new(
        positions: Vec<f64>,
        masses: Vec<f64>,
        cell: Vec<f64>,
        pbc_x: bool,
        pbc_y: bool,
        pbc_z: bool,
    ) -> Result<JsNPTState, JsError> {
        let n_atoms = masses.len();
        if positions.len() != n_atoms * 3 {
            return Err(JsError::new("positions length must be 3 * n_atoms"));
        }
        if cell.len() != 9 {
            return Err(JsError::new("cell must have 9 elements"));
        }

        let pos_vec: Vec<Vector3<f64>> = positions
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        let cell_mat = nalgebra::Matrix3::new(
            cell[0], cell[1], cell[2], cell[3], cell[4], cell[5], cell[6], cell[7], cell[8],
        );

        Ok(JsNPTState {
            inner: integrators::NPTState::new(pos_vec, masses, cell_mat, [pbc_x, pbc_y, pbc_z]),
        })
    }

    /// Get positions as flat array.
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f64> {
        self.inner
            .positions
            .iter()
            .flat_map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get velocities as flat array.
    #[wasm_bindgen(getter)]
    pub fn velocities(&self) -> Vec<f64> {
        self.inner
            .velocities
            .iter()
            .flat_map(|v| [v.x, v.y, v.z])
            .collect()
    }

    /// Get cell matrix as flat array.
    #[wasm_bindgen(getter)]
    pub fn cell(&self) -> Vec<f64> {
        let c = &self.inner.cell;
        vec![
            c[(0, 0)],
            c[(0, 1)],
            c[(0, 2)],
            c[(1, 0)],
            c[(1, 1)],
            c[(1, 2)],
            c[(2, 0)],
            c[(2, 1)],
            c[(2, 2)],
        ]
    }

    /// Get cell volume in Angstrom³.
    #[wasm_bindgen]
    pub fn volume(&self) -> f64 {
        self.inner.volume()
    }

    /// Get kinetic energy in eV.
    #[wasm_bindgen]
    pub fn kinetic_energy(&self) -> f64 {
        self.inner.kinetic_energy()
    }

    /// Get temperature in Kelvin.
    #[wasm_bindgen]
    pub fn temperature(&self) -> f64 {
        self.inner.temperature()
    }

    /// Number of atoms.
    #[wasm_bindgen(getter)]
    pub fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }
}

/// NPT integrator using Parrinello-Rahman barostat.
#[wasm_bindgen]
pub struct JsNPTIntegrator {
    inner: integrators::NPTIntegrator,
}

#[wasm_bindgen]
impl JsNPTIntegrator {
    /// Create a new NPT integrator.
    ///
    /// temperature: target temperature in Kelvin
    /// pressure: target pressure in GPa
    /// tau_t: thermostat time constant in femtoseconds
    /// tau_p: barostat time constant in femtoseconds
    /// dt: timestep in femtoseconds
    /// n_atoms: number of atoms
    /// total_mass: total system mass in amu
    #[wasm_bindgen(constructor)]
    pub fn new(
        temperature: f64,
        pressure: f64,
        tau_t: f64,
        tau_p: f64,
        dt: f64,
        n_atoms: usize,
        total_mass: f64,
    ) -> JsNPTIntegrator {
        let config = integrators::NPTConfig::new(temperature, pressure, tau_t, tau_p, dt);
        JsNPTIntegrator {
            inner: integrators::NPTIntegrator::new(config, n_atoms, total_mass),
        }
    }

    /// Get instantaneous pressure from stress tensor.
    #[wasm_bindgen]
    pub fn pressure(&self, stress: Vec<f64>) -> WasmResult<f64> {
        if stress.len() != 9 {
            return WasmResult::err("stress must have 9 elements");
        }
        let stress_mat = nalgebra::Matrix3::new(
            stress[0], stress[1], stress[2], stress[3], stress[4], stress[5], stress[6], stress[7],
            stress[8],
        );
        WasmResult::ok(self.inner.pressure(&stress_mat))
    }
}

/// Perform one NPT step with provided forces and stress.
#[wasm_bindgen]
pub fn npt_step_with_forces_and_stress(
    integrator: &mut JsNPTIntegrator,
    state: &mut JsNPTState,
    forces: Vec<f64>,
    stress: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }
        if stress.len() != 9 {
            return Err("stress must have 9 elements".to_string());
        }

        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        let stress_mat = nalgebra::Matrix3::new(
            stress[0], stress[1], stress[2], stress[3], stress[4], stress[5], stress[6], stress[7],
            stress[8],
        );

        integrator
            .inner
            .step(&mut state.inner, |_, _| (force_vec.clone(), stress_mat));
        Ok(())
    })();
    result.into()
}

/// Get perpendicular distances for each lattice axis.
///
/// Returns JSON array [d_a, d_b, d_c].
#[wasm_bindgen]
pub fn cell_perpendicular_distances(structure: JsCrystal) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let dists = cell_ops::perpendicular_distances(&struc.lattice);
        Ok(serde_json::to_string(dists.as_slice()).unwrap_or_default())
    })();
    result.into()
}

// === FIRE Optimizer ===

/// FIRE optimizer configuration.
#[wasm_bindgen]
pub struct JsFireConfig {
    inner: optimizers::FireConfig,
}

#[wasm_bindgen]
impl JsFireConfig {
    /// Create a new FIRE configuration with default parameters.
    #[wasm_bindgen(constructor)]
    pub fn new() -> JsFireConfig {
        JsFireConfig {
            inner: optimizers::FireConfig::default(),
        }
    }

    /// Set initial timestep.
    #[wasm_bindgen]
    pub fn set_dt_start(&mut self, dt_start: f64) {
        self.inner.dt_start = dt_start;
    }

    /// Set maximum timestep.
    #[wasm_bindgen]
    pub fn set_dt_max(&mut self, dt_max: f64) {
        self.inner.dt_max = dt_max;
    }

    /// Set minimum steps before dt increase.
    #[wasm_bindgen]
    pub fn set_n_min(&mut self, n_min: usize) {
        self.inner.n_min = n_min;
    }

    /// Set maximum step size in Angstrom.
    #[wasm_bindgen]
    pub fn set_max_step(&mut self, max_step: f64) {
        self.inner.max_step = max_step;
    }
}

impl Default for JsFireConfig {
    fn default() -> Self {
        Self::new()
    }
}

/// FIRE optimizer state.
#[wasm_bindgen]
pub struct JsFireState {
    inner: optimizers::FireState,
    config: optimizers::FireConfig,
}

#[wasm_bindgen]
impl JsFireState {
    /// Create a new FIRE state.
    ///
    /// positions: flat array [x0, y0, z0, ...] in Angstrom
    /// config: optional FIRE configuration (uses defaults if not provided)
    #[wasm_bindgen(constructor)]
    pub fn new(positions: Vec<f64>, config: Option<JsFireConfig>) -> JsFireState {
        let pos_vec: Vec<Vector3<f64>> = positions
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        let fire_config = config.map(|c| c.inner).unwrap_or_default();
        let state = optimizers::FireState::new(pos_vec, &fire_config);
        JsFireState {
            inner: state,
            config: fire_config,
        }
    }

    /// Get positions as flat array.
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f64> {
        self.inner
            .positions
            .iter()
            .flat_map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get maximum force component.
    #[wasm_bindgen]
    pub fn max_force(&self) -> f64 {
        self.inner.max_force()
    }

    /// Check if optimization has converged.
    #[wasm_bindgen]
    pub fn is_converged(&self, fmax: f64) -> bool {
        self.inner.is_converged(fmax)
    }

    /// Number of atoms.
    #[wasm_bindgen(getter)]
    pub fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }

    /// Current timestep.
    #[wasm_bindgen(getter)]
    pub fn dt(&self) -> f64 {
        self.inner.dt
    }
}

/// Perform one FIRE optimization step with provided forces.
#[wasm_bindgen]
pub fn fire_step_with_forces(state: &mut JsFireState, forces: Vec<f64>) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }

        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();

        state
            .inner
            .step(|_positions| force_vec.clone(), &state.config);
        Ok(())
    })();
    result.into()
}

/// Check if two lattices are equivalent under rotation/permutation.
#[wasm_bindgen]
pub fn cell_lattices_equivalent(
    structure1: JsCrystal,
    structure2: JsCrystal,
    tolerance: f64,
) -> WasmResult<bool> {
    let result: Result<bool, String> = (|| {
        let struc1 = structure1.to_structure()?;
        let struc2 = structure2.to_structure()?;
        Ok(cell_ops::lattices_equivalent(
            &struc1.lattice,
            &struc2.lattice,
            tolerance,
            tolerance,
        ))
    })();
    result.into()
}

/// Check if one lattice is a supercell of another.
///
/// Returns JSON: null if not a supercell, or [[a,b,c],[d,e,f],[g,h,i]] transformation.
#[wasm_bindgen]
pub fn cell_is_supercell(
    structure: JsCrystal,
    other: JsCrystal,
    tolerance: f64,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let other_struc = other.to_structure()?;
        let matrix = cell_ops::is_supercell(&struc.lattice, &other_struc.lattice, tolerance);
        Ok(serde_json::to_string(&matrix).unwrap_or_default())
    })();
    result.into()
}

/// FIRE optimizer state with cell optimization.
#[wasm_bindgen]
pub struct JsCellFireState {
    inner: optimizers::CellFireState,
    config: optimizers::FireConfig,
}

#[wasm_bindgen]
impl JsCellFireState {
    /// Create a new CellFIRE state.
    ///
    /// positions: flat array [x0, y0, z0, ...] in Angstrom
    /// cell: 9-element cell matrix (row-major)
    /// config: optional FIRE configuration
    /// cell_factor: scaling factor for cell DOF (default: 1.0)
    #[wasm_bindgen(constructor)]
    pub fn new(
        positions: Vec<f64>,
        cell: Vec<f64>,
        config: Option<JsFireConfig>,
        cell_factor: Option<f64>,
    ) -> Result<JsCellFireState, JsError> {
        if cell.len() != 9 {
            return Err(JsError::new("cell must have 9 elements"));
        }

        let pos_vec: Vec<Vector3<f64>> = positions
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        let cell_mat = nalgebra::Matrix3::new(
            cell[0], cell[1], cell[2], cell[3], cell[4], cell[5], cell[6], cell[7], cell[8],
        );
        let fire_config = config.map(|c| c.inner).unwrap_or_default();
        let factor = cell_factor.unwrap_or(1.0);

        Ok(JsCellFireState {
            inner: optimizers::CellFireState::new(pos_vec, cell_mat, &fire_config, factor),
            config: fire_config,
        })
    }

    /// Get positions as flat array.
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f64> {
        self.inner
            .positions
            .iter()
            .flat_map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get cell matrix as flat array.
    #[wasm_bindgen(getter)]
    pub fn cell(&self) -> Vec<f64> {
        let c = &self.inner.cell;
        vec![
            c[(0, 0)],
            c[(0, 1)],
            c[(0, 2)],
            c[(1, 0)],
            c[(1, 1)],
            c[(1, 2)],
            c[(2, 0)],
            c[(2, 1)],
            c[(2, 2)],
        ]
    }

    /// Get maximum force component.
    #[wasm_bindgen]
    pub fn max_force(&self) -> f64 {
        optimizers::cell_max_force(&self.inner)
    }

    /// Get maximum stress component.
    #[wasm_bindgen]
    pub fn max_stress(&self) -> f64 {
        optimizers::cell_max_stress(&self.inner)
    }

    /// Check if optimization has converged.
    #[wasm_bindgen]
    pub fn is_converged(&self, fmax: f64, smax: f64) -> bool {
        optimizers::cell_is_converged(&self.inner, fmax, smax)
    }

    /// Number of atoms.
    #[wasm_bindgen(getter)]
    pub fn num_atoms(&self) -> usize {
        self.inner.positions.len()
    }
}

/// Perform one CellFIRE optimization step with provided forces and stress.
#[wasm_bindgen]
pub fn cell_fire_step_with_forces_and_stress(
    state: &mut JsCellFireState,
    forces: Vec<f64>,
    stress: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.positions.len();
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }
        if stress.len() != 9 {
            return Err("stress must have 9 elements".to_string());
        }

        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        let stress_mat = nalgebra::Matrix3::new(
            stress[0], stress[1], stress[2], stress[3], stress[4], stress[5], stress[6], stress[7],
            stress[8],
        );

        state
            .inner
            .step(|_, _| (force_vec.clone(), stress_mat), &state.config);
        Ok(())
    })();
    result.into()
}
