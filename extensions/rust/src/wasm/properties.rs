//! Physical property WASM bindings.

use wasm_bindgen::prelude::*;

use crate::wasm_types::{JsCrystal, JsStructureMetadata, WasmResult};

#[wasm_bindgen]
pub fn get_volume(structure: JsCrystal) -> WasmResult<f64> {
    structure.to_structure().map(|s| s.volume()).into()
}

#[wasm_bindgen]
pub fn get_total_mass(structure: JsCrystal) -> WasmResult<f64> {
    structure.to_structure().map(|s| s.total_mass()).into()
}

#[wasm_bindgen]
pub fn get_density(structure: JsCrystal) -> WasmResult<f64> {
    structure
        .to_structure()
        .and_then(|s| {
            s.density()
                .ok_or_else(|| "Cannot compute density for zero-volume structure".to_string())
        })
        .into()
}

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
