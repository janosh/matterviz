//! Elastic tensor WASM bindings.

use wasm_bindgen::prelude::*;

use crate::elastic;
use crate::wasm_types::{JsMatrix3x3, WasmResult};

fn js_to_matrix3(m: &JsMatrix3x3) -> nalgebra::Matrix3<f64> {
    nalgebra::Matrix3::from_row_slice(&[
        m.0[0][0], m.0[0][1], m.0[0][2], m.0[1][0], m.0[1][1], m.0[1][2], m.0[2][0], m.0[2][1],
        m.0[2][2],
    ])
}

fn matrix3_to_js(m: &nalgebra::Matrix3<f64>) -> JsMatrix3x3 {
    JsMatrix3x3([
        [m[(0, 0)], m[(0, 1)], m[(0, 2)]],
        [m[(1, 0)], m[(1, 1)], m[(1, 2)]],
        [m[(2, 0)], m[(2, 1)], m[(2, 2)]],
    ])
}

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

#[wasm_bindgen]
pub fn elastic_apply_strain(cell: JsMatrix3x3, strain: JsMatrix3x3) -> JsMatrix3x3 {
    let result = elastic::apply_strain(&js_to_matrix3(&cell), &js_to_matrix3(&strain));
    matrix3_to_js(&result)
}

#[wasm_bindgen]
pub fn elastic_stress_to_voigt(stress: JsMatrix3x3) -> Vec<f64> {
    elastic::stress_to_voigt(&js_to_matrix3(&stress)).to_vec()
}

#[wasm_bindgen]
pub fn elastic_strain_to_voigt(strain: JsMatrix3x3) -> Vec<f64> {
    elastic::strain_to_voigt(&js_to_matrix3(&strain)).to_vec()
}

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
    WasmResult::ok(tensor.iter().flat_map(|row| row.iter().copied()).collect())
}

#[wasm_bindgen]
pub fn elastic_bulk_modulus(tensor: Vec<f64>) -> WasmResult<f64> {
    match tensor_flat_to_array(&tensor) {
        Ok(arr) => WasmResult::ok(elastic::bulk_modulus(&arr)),
        Err(err) => WasmResult::err(err),
    }
}

#[wasm_bindgen]
pub fn elastic_shear_modulus(tensor: Vec<f64>) -> WasmResult<f64> {
    match tensor_flat_to_array(&tensor) {
        Ok(arr) => WasmResult::ok(elastic::shear_modulus(&arr)),
        Err(err) => WasmResult::err(err),
    }
}

#[wasm_bindgen]
pub fn elastic_youngs_modulus(bulk: f64, shear: f64) -> f64 {
    elastic::youngs_modulus(bulk, shear)
}

#[wasm_bindgen]
pub fn elastic_poisson_ratio(bulk: f64, shear: f64) -> f64 {
    elastic::poisson_ratio(bulk, shear)
}

#[wasm_bindgen]
pub fn elastic_is_stable(tensor: Vec<f64>) -> WasmResult<bool> {
    match tensor_flat_to_array(&tensor) {
        Ok(arr) => WasmResult::ok(elastic::is_mechanically_stable(&arr)),
        Err(err) => WasmResult::err(err),
    }
}

#[wasm_bindgen]
pub fn elastic_zener_ratio(c11: f64, c12: f64, c44: f64) -> f64 {
    elastic::zener_ratio(c11, c12, c44)
}
