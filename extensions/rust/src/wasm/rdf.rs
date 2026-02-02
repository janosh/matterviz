//! Radial distribution function WASM bindings.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::element::Element;
use crate::rdf::{self, RdfOptions};
use crate::wasm_types::{JsCrystal, WasmResult};

/// RDF result containing bins and g(r) values.
#[wasm_bindgen]
#[derive(Serialize)]
pub struct JsRdfResult {
    /// Bin center positions (in Angstrom)
    #[wasm_bindgen(skip)]
    pub radii: Vec<f64>,
    /// g(r) values for each bin
    #[wasm_bindgen(skip)]
    pub g_of_r: Vec<f64>,
}

#[wasm_bindgen]
impl JsRdfResult {
    /// Get bin centers.
    #[wasm_bindgen(getter)]
    pub fn radii(&self) -> Vec<f64> {
        self.radii.clone()
    }

    /// Get g(r) values.
    #[wasm_bindgen(getter)]
    pub fn g_of_r(&self) -> Vec<f64> {
        self.g_of_r.clone()
    }
}

/// Compute radial distribution function.
#[wasm_bindgen]
pub fn compute_rdf_wasm(
    structure: JsCrystal,
    r_max: f64,
    n_bins: usize,
) -> WasmResult<JsRdfResult> {
    if !r_max.is_finite() || r_max <= 0.0 {
        return WasmResult::err("r_max must be a finite positive number");
    }
    if n_bins == 0 {
        return WasmResult::err("n_bins must be greater than 0");
    }

    structure
        .to_structure()
        .map(|struc| {
            let options = RdfOptions::new(r_max, n_bins);
            let result = rdf::compute_rdf(&struc, &options);
            JsRdfResult {
                radii: result.radii,
                g_of_r: result.g_of_r,
            }
        })
        .into()
}

/// Compute element-specific radial distribution function.
#[wasm_bindgen]
pub fn compute_element_rdf(
    structure: JsCrystal,
    r_max: f64,
    n_bins: usize,
    element1: &str,
    element2: &str,
) -> WasmResult<JsRdfResult> {
    if !r_max.is_finite() || r_max <= 0.0 {
        return WasmResult::err("r_max must be a finite positive number");
    }
    if n_bins == 0 {
        return WasmResult::err("n_bins must be greater than 0");
    }

    let elem1 = Element::from_symbol(element1);
    let elem2 = Element::from_symbol(element2);

    if elem1.is_none() {
        return WasmResult::err(&format!("Unknown element: {element1}"));
    }
    if elem2.is_none() {
        return WasmResult::err(&format!("Unknown element: {element2}"));
    }

    structure
        .to_structure()
        .map(|struc| {
            let options = RdfOptions::new(r_max, n_bins);
            let result = rdf::compute_element_rdf(&struc, elem1.unwrap(), elem2.unwrap(), &options);
            JsRdfResult {
                radii: result.radii,
                g_of_r: result.g_of_r,
            }
        })
        .into()
}
