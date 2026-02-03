//! Species WASM bindings.

use wasm_bindgen::prelude::*;

use crate::species::Species;

#[wasm_bindgen]
pub struct JsSpecies {
    inner: Species,
}

#[wasm_bindgen]
impl JsSpecies {
    #[wasm_bindgen(constructor)]
    pub fn new(species_str: &str) -> Result<JsSpecies, JsError> {
        Species::from_string(species_str)
            .map(|species| JsSpecies { inner: species })
            .ok_or_else(|| JsError::new(&format!("Invalid species string: {species_str}")))
    }

    #[wasm_bindgen(getter)]
    pub fn symbol(&self) -> String {
        self.inner.element.symbol().to_string()
    }

    #[wasm_bindgen(getter, js_name = "atomic_number")]
    pub fn atomic_number(&self) -> u8 {
        self.inner.element.atomic_number()
    }

    #[wasm_bindgen(getter, js_name = "oxidation_state")]
    pub fn oxidation_state(&self) -> Option<i8> {
        self.inner.oxidation_state
    }

    #[wasm_bindgen(js_name = "to_string")]
    pub fn to_string_js(&self) -> String {
        self.inner.to_string()
    }

    #[wasm_bindgen(getter, js_name = "ionic_radius")]
    pub fn ionic_radius(&self) -> f64 {
        self.inner.ionic_radius().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter, js_name = "atomic_radius")]
    pub fn atomic_radius(&self) -> f64 {
        self.inner.atomic_radius().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter)]
    pub fn electronegativity(&self) -> f64 {
        self.inner.electronegativity().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(js_name = "shannon_ionic_radius")]
    pub fn shannon_ionic_radius(&self, coordination: &str, spin: &str) -> f64 {
        self.inner
            .shannon_ionic_radius(coordination, spin)
            .unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter, js_name = "covalent_radius")]
    pub fn covalent_radius(&self) -> f64 {
        self.inner.covalent_radius().unwrap_or(f64::NAN)
    }

    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.inner.name().to_string()
    }
}
