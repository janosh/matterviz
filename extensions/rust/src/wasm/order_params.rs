//! Bond orientational order parameters (Steinhardt) WASM bindings.

use wasm_bindgen::prelude::*;

use crate::order_params;
use crate::wasm_types::{JsCrystal, WasmResult};

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

#[wasm_bindgen]
pub fn classify_local_structure(q4: f64, q6: f64, tolerance: f64) -> String {
    order_params::classify_local_structure(q4, q6, tolerance)
        .as_str()
        .to_string()
}

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
