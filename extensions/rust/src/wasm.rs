//! WASM bindings for ferrox types.
//!
//! This module provides JavaScript-accessible wrappers for Element, Species,
//! and Composition types via wasm-bindgen.

#![cfg(feature = "wasm")]

use wasm_bindgen::prelude::*;

use crate::element::{Block, Element};
use crate::species::Species;

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
    /// Create an element from its symbol.
    #[wasm_bindgen(constructor)]
    pub fn new(symbol: &str) -> Result<JsElement, JsError> {
        Element::from_symbol(symbol)
            .map(|e| JsElement { inner: e })
            .ok_or_else(|| JsError::new(&format!("Unknown element symbol: {symbol}")))
    }

    /// Create an element from its atomic number (1-118).
    #[wasm_bindgen(js_name = "fromAtomicNumber")]
    pub fn from_atomic_number(z: u8) -> Result<JsElement, JsError> {
        Element::from_atomic_number(z)
            .map(|e| JsElement { inner: e })
            .ok_or_else(|| JsError::new(&format!("Invalid atomic number: {z}")))
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
        format!("{:?}", self.inner.block())
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
