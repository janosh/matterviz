//! Element WASM bindings.

use wasm_bindgen::prelude::*;

use crate::element::Element;
use crate::wasm_types::WasmResult;

/// JavaScript-accessible Element wrapper.
#[wasm_bindgen]
pub struct JsElement {
    inner: Element,
}

#[wasm_bindgen]
impl JsElement {
    /// Create an element from its symbol (e.g., "Fe", "O", "Na").
    #[wasm_bindgen(constructor)]
    pub fn new(symbol: &str) -> Result<JsElement, JsError> {
        Element::from_symbol(symbol)
            .map(|elem| JsElement { inner: elem })
            .ok_or_else(|| JsError::new(&format!("Unknown element symbol: {symbol}")))
    }

    /// Create an element from its atomic number.
    #[wasm_bindgen(js_name = "from_atomic_number")]
    pub fn from_atomic_number(atomic_num: u8) -> Result<JsElement, JsError> {
        Element::from_atomic_number(atomic_num)
            .map(|elem| JsElement { inner: elem })
            .ok_or_else(|| {
                JsError::new(&format!(
                    "Invalid atomic number: {atomic_num} (valid: 1-118)"
                ))
            })
    }

    #[wasm_bindgen(getter)]
    pub fn symbol(&self) -> String {
        self.inner.symbol().to_string()
    }

    #[wasm_bindgen(getter, js_name = "atomic_number")]
    pub fn atomic_number(&self) -> u8 {
        self.inner.atomic_number()
    }

    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.inner.name().to_string()
    }

    #[wasm_bindgen(getter, js_name = "atomic_mass")]
    pub fn atomic_mass(&self) -> f64 {
        self.inner.atomic_mass()
    }

    #[wasm_bindgen(getter)]
    pub fn electronegativity(&self) -> f64 {
        self.inner.electronegativity().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter)]
    pub fn row(&self) -> u8 {
        self.inner.row()
    }

    #[wasm_bindgen(getter)]
    pub fn group(&self) -> u8 {
        self.inner.group()
    }

    #[wasm_bindgen(getter)]
    pub fn block(&self) -> String {
        self.inner.block().as_str().to_string()
    }

    #[wasm_bindgen(getter, js_name = "atomic_radius")]
    pub fn atomic_radius(&self) -> f64 {
        self.inner.atomic_radius().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter, js_name = "covalent_radius")]
    pub fn covalent_radius(&self) -> f64 {
        self.inner.covalent_radius().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(js_name = "is_noble_gas")]
    pub fn is_noble_gas(&self) -> bool {
        self.inner.is_noble_gas()
    }

    #[wasm_bindgen(js_name = "is_alkali")]
    pub fn is_alkali(&self) -> bool {
        self.inner.is_alkali()
    }

    #[wasm_bindgen(js_name = "is_alkaline")]
    pub fn is_alkaline(&self) -> bool {
        self.inner.is_alkaline()
    }

    #[wasm_bindgen(js_name = "is_halogen")]
    pub fn is_halogen(&self) -> bool {
        self.inner.is_halogen()
    }

    #[wasm_bindgen(js_name = "is_chalcogen")]
    pub fn is_chalcogen(&self) -> bool {
        self.inner.is_chalcogen()
    }

    #[wasm_bindgen(js_name = "is_lanthanoid")]
    pub fn is_lanthanoid(&self) -> bool {
        self.inner.is_lanthanoid()
    }

    #[wasm_bindgen(js_name = "is_actinoid")]
    pub fn is_actinoid(&self) -> bool {
        self.inner.is_actinoid()
    }

    #[wasm_bindgen(js_name = "is_transition_metal")]
    pub fn is_transition_metal(&self) -> bool {
        self.inner.is_transition_metal()
    }

    #[wasm_bindgen(js_name = "is_post_transition_metal")]
    pub fn is_post_transition_metal(&self) -> bool {
        self.inner.is_post_transition_metal()
    }

    #[wasm_bindgen(js_name = "is_metalloid")]
    pub fn is_metalloid(&self) -> bool {
        self.inner.is_metalloid()
    }

    #[wasm_bindgen(js_name = "is_metal")]
    pub fn is_metal(&self) -> bool {
        self.inner.is_metal()
    }

    #[wasm_bindgen(js_name = "is_radioactive")]
    pub fn is_radioactive(&self) -> bool {
        self.inner.is_radioactive()
    }

    #[wasm_bindgen(js_name = "is_rare_earth")]
    pub fn is_rare_earth(&self) -> bool {
        self.inner.is_rare_earth()
    }

    #[wasm_bindgen(js_name = "is_pseudo")]
    pub fn is_pseudo(&self) -> bool {
        self.inner.is_pseudo()
    }

    #[wasm_bindgen(js_name = "oxidation_states")]
    pub fn oxidation_states(&self) -> Vec<i8> {
        self.inner.oxidation_states().to_vec()
    }

    #[wasm_bindgen(js_name = "common_oxidation_states")]
    pub fn common_oxidation_states(&self) -> Vec<i8> {
        self.inner.common_oxidation_states().to_vec()
    }

    #[wasm_bindgen(js_name = "icsd_oxidation_states")]
    pub fn icsd_oxidation_states(&self) -> Vec<i8> {
        self.inner.icsd_oxidation_states().to_vec()
    }

    #[wasm_bindgen(getter, js_name = "max_oxidation_state")]
    pub fn max_oxidation_state(&self) -> i8 {
        self.inner.max_oxidation_state().unwrap_or(0)
    }

    #[wasm_bindgen(getter, js_name = "min_oxidation_state")]
    pub fn min_oxidation_state(&self) -> i8 {
        self.inner.min_oxidation_state().unwrap_or(0)
    }

    #[wasm_bindgen(js_name = "ionic_radius")]
    pub fn ionic_radius(&self, oxidation_state: i8) -> f64 {
        self.inner.ionic_radius(oxidation_state).unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(js_name = "ionic_radii")]
    pub fn ionic_radii(&self) -> Option<String> {
        self.inner
            .ionic_radii()
            .map(|radii| serde_json::to_string(radii).unwrap_or_default())
    }

    #[wasm_bindgen(js_name = "shannon_ionic_radius")]
    pub fn shannon_ionic_radius(&self, oxidation_state: i8, coordination: &str, spin: &str) -> f64 {
        self.inner
            .shannon_ionic_radius(oxidation_state, coordination, spin)
            .unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(js_name = "shannon_radii")]
    pub fn shannon_radii(&self) -> Option<String> {
        self.inner
            .shannon_radii()
            .map(|radii| serde_json::to_string(radii).unwrap_or_default())
    }

    #[wasm_bindgen(getter, js_name = "melting_point")]
    pub fn melting_point(&self) -> f64 {
        self.inner.melting_point().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter, js_name = "boiling_point")]
    pub fn boiling_point(&self) -> f64 {
        self.inner.boiling_point().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter)]
    pub fn density(&self) -> f64 {
        self.inner.density().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter, js_name = "electron_affinity")]
    pub fn electron_affinity(&self) -> f64 {
        self.inner.electron_affinity().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter, js_name = "first_ionization_energy")]
    pub fn first_ionization_energy(&self) -> f64 {
        self.inner.first_ionization_energy().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(js_name = "ionization_energies")]
    pub fn ionization_energies(&self) -> Vec<f64> {
        self.inner.ionization_energies().to_vec()
    }

    #[wasm_bindgen(getter, js_name = "molar_heat")]
    pub fn molar_heat(&self) -> f64 {
        self.inner.molar_heat().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter, js_name = "specific_heat")]
    pub fn specific_heat(&self) -> f64 {
        self.inner.specific_heat().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter, js_name = "n_valence")]
    pub fn n_valence(&self) -> u8 {
        self.inner.n_valence().unwrap_or(0)
    }

    #[wasm_bindgen(getter, js_name = "electron_configuration")]
    pub fn electron_configuration(&self) -> String {
        self.inner
            .electron_configuration()
            .unwrap_or("")
            .to_string()
    }

    #[wasm_bindgen(getter, js_name = "electron_configuration_semantic")]
    pub fn electron_configuration_semantic(&self) -> String {
        self.inner
            .electron_configuration_semantic()
            .unwrap_or("")
            .to_string()
    }
}

#[wasm_bindgen]
pub fn get_atomic_mass(symbol: &str) -> WasmResult<f64> {
    let result = Element::from_symbol(symbol)
        .map(|elem| elem.atomic_mass())
        .ok_or_else(|| format!("Unknown element: {symbol}"));
    result.into()
}

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
