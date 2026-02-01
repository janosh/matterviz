//! WASM bindings for ferrox types.
//!
//! This module provides JavaScript-accessible wrappers for Element, Species,
//! Structure, and StructureMatcher types via wasm-bindgen.
//!
//! All structure functions use strongly-typed `JsCrystal` inputs/outputs.
//! Results are returned as `WasmResult<T>` = `{ ok: T }` | `{ error: string }`.

use std::path::Path;

use nalgebra::Vector3;
use wasm_bindgen::prelude::*;

use crate::cif::parse_cif_str;
use crate::element::Element;
use crate::io::parse_poscar_str;
use crate::species::Species;
use crate::structure_matcher::{ComparatorType, StructureMatcher};
use crate::wasm_types::{
    JsCompositionInfo, JsCrystal, JsIntMatrix3x3, JsLocalEnvironment, JsMatrix3x3, JsMillerIndex,
    JsNeighborInfo, JsNeighborList, JsReductionAlgo, JsRmsDistResult, JsStructureMetadata,
    JsSymmetryDataset, JsSymmetryOperation, JsVector3, WasmResult,
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
    #[wasm_bindgen(js_name = "fromAtomicNumber")]
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

    /// Get all ionic radii as JSON string: {"oxi_state": radius, ...}.
    ///
    /// Returns null if no ionic radii data is available.
    #[wasm_bindgen(js_name = "ionicRadii")]
    pub fn ionic_radii(&self) -> Option<String> {
        self.inner
            .ionic_radii()
            .map(|radii| serde_json::to_string(radii).unwrap_or_default())
    }

    /// Get Shannon ionic radius (or NaN if not defined).
    #[wasm_bindgen(js_name = "shannonIonicRadius")]
    pub fn shannon_ionic_radius(&self, oxidation_state: i8, coordination: &str, spin: &str) -> f64 {
        self.inner
            .shannon_ionic_radius(oxidation_state, coordination, spin)
            .unwrap_or(f64::NAN)
    }

    /// Get full Shannon radii as JSON string.
    ///
    /// Structure: {oxi_state: {coordination: {spin: {crystal_radius, ionic_radius}}}}
    /// Returns null if no Shannon radii data is available.
    #[wasm_bindgen(js_name = "shannonRadii")]
    pub fn shannon_radii(&self) -> Option<String> {
        self.inner
            .shannon_radii()
            .map(|radii| serde_json::to_string(radii).unwrap_or_default())
    }

    // Physical properties

    /// Get melting point in Kelvin (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "meltingPoint")]
    pub fn melting_point(&self) -> f64 {
        self.inner.melting_point().unwrap_or(f64::NAN)
    }

    /// Get boiling point in Kelvin (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "boilingPoint")]
    pub fn boiling_point(&self) -> f64 {
        self.inner.boiling_point().unwrap_or(f64::NAN)
    }

    /// Get density in g/cm³ (or NaN if not defined).
    #[wasm_bindgen(getter)]
    pub fn density(&self) -> f64 {
        self.inner.density().unwrap_or(f64::NAN)
    }

    /// Get electron affinity in kJ/mol (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "electronAffinity")]
    pub fn electron_affinity(&self) -> f64 {
        self.inner.electron_affinity().unwrap_or(f64::NAN)
    }

    /// Get first ionization energy in kJ/mol (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "firstIonizationEnergy")]
    pub fn first_ionization_energy(&self) -> f64 {
        self.inner.first_ionization_energy().unwrap_or(f64::NAN)
    }

    /// Get all ionization energies in kJ/mol.
    #[wasm_bindgen(js_name = "ionizationEnergies")]
    pub fn ionization_energies(&self) -> Vec<f64> {
        self.inner.ionization_energies().to_vec()
    }

    /// Get molar heat capacity (Cp) in J/(mol·K) (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "molarHeat")]
    pub fn molar_heat(&self) -> f64 {
        self.inner.molar_heat().unwrap_or(f64::NAN)
    }

    /// Get specific heat capacity in J/(g·K) (or NaN if not defined).
    #[wasm_bindgen(getter, js_name = "specificHeat")]
    pub fn specific_heat(&self) -> f64 {
        self.inner.specific_heat().unwrap_or(f64::NAN)
    }

    /// Get number of valence electrons (or 0 if not defined).
    #[wasm_bindgen(getter, js_name = "nValence")]
    pub fn n_valence(&self) -> u8 {
        self.inner.n_valence().unwrap_or(0)
    }

    /// Get electron configuration string (or empty string if not defined).
    #[wasm_bindgen(getter, js_name = "electronConfiguration")]
    pub fn electron_configuration(&self) -> String {
        self.inner
            .electron_configuration()
            .unwrap_or("")
            .to_string()
    }

    /// Get semantic electron configuration with noble gas core (or empty string if not defined).
    #[wasm_bindgen(getter, js_name = "electronConfigurationSemantic")]
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
    #[wasm_bindgen(js_name = "getStructureDistance")]
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

        // Build species map as Vec of (symbol, amount) tuples
        let species: Vec<(String, f64)> = comp
            .iter()
            .map(|(sp, amt)| (sp.to_string(), *amt))
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

/// Element-amount pair for composition results.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, tsify_next::Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsElementAmount {
    /// Element symbol
    pub element: String,
    /// Amount (count or fraction)
    pub amount: f64,
}

fn comp_to_element_amounts(comp: &crate::composition::Composition) -> Vec<JsElementAmount> {
    comp.iter()
        .map(|(sp, amt)| JsElementAmount {
            element: sp.element.symbol().to_string(),
            amount: *amt,
        })
        .collect()
}

/// Get reduced composition as array of {element, amount} objects.
#[wasm_bindgen]
pub fn reduced_composition(formula: &str) -> WasmResult<Vec<JsElementAmount>> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| comp_to_element_amounts(&c.reduced_composition()))
        .map_err(|e| e.to_string())
        .into()
}

/// Get fractional composition (atomic fractions) as array of {element, amount} objects.
#[wasm_bindgen]
pub fn fractional_composition(formula: &str) -> WasmResult<Vec<JsElementAmount>> {
    crate::composition::Composition::from_formula(formula)
        .map(|c| comp_to_element_amounts(&c.fractional_composition()))
        .map_err(|e| e.to_string())
        .into()
}

/// Check if two compositions are approximately equal.
///
/// Uses relative tolerance of 0.1 and absolute tolerance of 1e-8.
#[wasm_bindgen]
pub fn compositions_almost_equal(formula1: &str, formula2: &str) -> WasmResult<bool> {
    use crate::composition::Composition;
    Composition::from_formula(formula1)
        .and_then(|c1| {
            Composition::from_formula(formula2).map(|c2| c1.almost_equals(&c2, 0.1, 1e-8))
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
    structure
        .to_structure()
        .map(|struc| struc.is_periodic_image(site_i as usize, site_j as usize, tolerance))
        .into()
}
