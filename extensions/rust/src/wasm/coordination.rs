//! Coordination number WASM bindings.

use wasm_bindgen::prelude::*;

use super::helpers::validate_cutoff;
use crate::coordination;
use crate::wasm_types::{JsCrystal, WasmResult};

/// Get coordination numbers for all sites using cutoff distance.
#[wasm_bindgen]
pub fn get_coordination_numbers_wasm(structure: JsCrystal, cutoff: f64) -> WasmResult<Vec<usize>> {
    if let Err(err) = validate_cutoff(cutoff) {
        return WasmResult::err(&err);
    }
    structure
        .to_structure()
        .map(|struc| coordination::get_coordination_numbers(&struc, cutoff))
        .into()
}

/// Get average coordination number for the structure.
#[wasm_bindgen]
pub fn get_average_coordination_number(structure: JsCrystal, cutoff: f64) -> WasmResult<f64> {
    if let Err(err) = validate_cutoff(cutoff) {
        return WasmResult::err(&err);
    }
    structure
        .to_structure()
        .map(|struc| {
            let cn_list = coordination::get_coordination_numbers(&struc, cutoff);
            if cn_list.is_empty() {
                0.0
            } else {
                cn_list.iter().sum::<usize>() as f64 / cn_list.len() as f64
            }
        })
        .into()
}

/// Get coordination number for a single site.
#[wasm_bindgen]
pub fn get_coordination_number(
    structure: JsCrystal,
    site_idx: usize,
    cutoff: f64,
) -> WasmResult<usize> {
    if let Err(err) = validate_cutoff(cutoff) {
        return WasmResult::err(&err);
    }
    structure
        .to_structure()
        .and_then(|struc| {
            let num_sites = struc.num_sites();
            if site_idx >= num_sites {
                return Err(format!(
                    "site_idx {site_idx} out of bounds for structure with {num_sites} sites"
                ));
            }
            Ok(coordination::get_coordination_number(
                &struc, site_idx, cutoff,
            ))
        })
        .into()
}
