//! Lattice WASM bindings for reduction and properties.

use wasm_bindgen::prelude::*;

use super::helpers::validate_positive_f64;
use crate::wasm::mat3_to_array;
use crate::wasm_types::{JsCrystal, JsReductionAlgo, WasmResult};

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

#[wasm_bindgen]
pub fn get_primitive(structure: JsCrystal, symprec: f64) -> WasmResult<JsCrystal> {
    validate_positive_f64(symprec, "symprec")
        .and_then(|()| structure.to_structure())
        .and_then(|struc| struc.get_primitive(symprec).map_err(|e| e.to_string()))
        .map(|prim| JsCrystal::from_structure(&prim))
        .into()
}

#[wasm_bindgen]
pub fn get_conventional(structure: JsCrystal, symprec: f64) -> WasmResult<JsCrystal> {
    validate_positive_f64(symprec, "symprec")
        .and_then(|()| structure.to_structure())
        .and_then(|struc| {
            struc
                .get_conventional_structure(symprec)
                .map_err(|e| e.to_string())
        })
        .map(|conv| JsCrystal::from_structure(&conv))
        .into()
}

#[wasm_bindgen]
pub fn get_lattice_metric_tensor(structure: JsCrystal) -> WasmResult<[[f64; 3]; 3]> {
    structure
        .to_structure()
        .map(|s| mat3_to_array(&s.lattice.metric_tensor()))
        .into()
}

#[wasm_bindgen]
pub fn get_lattice_inv_matrix(structure: JsCrystal) -> WasmResult<[[f64; 3]; 3]> {
    structure
        .to_structure()
        .map(|s| mat3_to_array(&s.lattice.inv_matrix()))
        .into()
}

#[wasm_bindgen]
pub fn get_reciprocal_lattice(structure: JsCrystal) -> WasmResult<[[f64; 3]; 3]> {
    structure
        .to_structure()
        .map(|s| mat3_to_array(s.lattice.reciprocal().matrix()))
        .into()
}

#[wasm_bindgen]
pub fn get_lll_reduced_lattice(structure: JsCrystal) -> WasmResult<[[f64; 3]; 3]> {
    structure
        .to_structure()
        .map(|s| mat3_to_array(&s.lattice.lll_matrix()))
        .into()
}

#[wasm_bindgen]
pub fn get_lll_mapping(structure: JsCrystal) -> WasmResult<[[f64; 3]; 3]> {
    structure
        .to_structure()
        .map(|s| mat3_to_array(&s.lattice.lll_mapping()))
        .into()
}
