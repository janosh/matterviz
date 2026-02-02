//! Bond orientational order parameters (Steinhardt) WASM bindings.

use wasm_bindgen::prelude::*;

use super::helpers::{validate_cutoff, validate_cutoff_nonneg};
use crate::order_params;
use crate::wasm_types::{JsCrystal, WasmResult};

#[wasm_bindgen]
pub fn compute_steinhardt_q(
    structure: JsCrystal,
    degree: i32,
    cutoff: f64,
) -> WasmResult<Vec<f64>> {
    if degree < 0 {
        return WasmResult::err(&format!("degree must be non-negative, got {degree}"));
    }
    if let Err(err) = validate_cutoff(cutoff) {
        return WasmResult::err(&err);
    }
    structure
        .to_structure()
        .map(|struc| order_params::compute_steinhardt_q(&struc, degree, cutoff))
        .into()
}

#[wasm_bindgen]
pub fn classify_local_structure(q4: f64, q6: f64, tolerance: f64) -> WasmResult<String> {
    if !q4.is_finite() {
        return WasmResult::err(&format!("q4 must be finite, got {q4}"));
    }
    if !q6.is_finite() {
        return WasmResult::err(&format!("q6 must be finite, got {q6}"));
    }
    if let Err(err) = validate_cutoff_nonneg(tolerance) {
        return WasmResult::err(&err);
    }
    WasmResult::ok(
        order_params::classify_local_structure(q4, q6, tolerance)
            .as_str()
            .to_string(),
    )
}

#[wasm_bindgen]
pub fn classify_all_atoms(
    structure: JsCrystal,
    cutoff: f64,
    tolerance: f64,
) -> WasmResult<Vec<String>> {
    if let Err(err) = validate_cutoff(cutoff) {
        return WasmResult::err(&err);
    }
    if let Err(err) = validate_cutoff_nonneg(tolerance) {
        return WasmResult::err(&err);
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
