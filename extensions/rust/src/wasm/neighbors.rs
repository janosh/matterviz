//! Neighbor and coordination WASM bindings.

use wasm_bindgen::prelude::*;

use crate::wasm_types::{
    JsCrystal, JsLocalEnvironment, JsNeighborInfo, JsNeighborList, WasmResult,
};

#[wasm_bindgen]
pub fn get_neighbor_list(
    structure: JsCrystal,
    cutoff_radius: f64,
    numerical_tol: f64,
    exclude_self: bool,
) -> WasmResult<JsNeighborList> {
    let result: Result<JsNeighborList, String> = (|| {
        if !cutoff_radius.is_finite() || cutoff_radius < 0.0 {
            return Err("Cutoff radius must be finite and non-negative".to_string());
        }
        let struc = structure.to_structure()?;
        let (center_indices, neighbor_indices, image_offsets, distances) =
            struc.get_neighbor_list(cutoff_radius, numerical_tol, exclude_self);
        Ok(JsNeighborList {
            center_indices: center_indices.into_iter().map(|idx| idx as u32).collect(),
            neighbor_indices: neighbor_indices.into_iter().map(|idx| idx as u32).collect(),
            image_offsets,
            distances,
        })
    })();
    result.into()
}

#[wasm_bindgen]
pub fn get_distance(structure: JsCrystal, site_idx_1: u32, site_idx_2: u32) -> WasmResult<f64> {
    let result: Result<f64, String> = (|| {
        let struc = structure.to_structure()?;
        let num_sites = struc.num_sites();
        let idx_1 = site_idx_1 as usize;
        let idx_2 = site_idx_2 as usize;
        if idx_1 >= num_sites || idx_2 >= num_sites {
            return Err(format!(
                "Site indices ({idx_1}, {idx_2}) out of bounds for structure with {num_sites} sites"
            ));
        }
        Ok(struc.get_distance(idx_1, idx_2))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn get_distance_matrix(structure: JsCrystal) -> WasmResult<Vec<Vec<f64>>> {
    let result = structure
        .to_structure()
        .map(|struc| struc.distance_matrix());
    result.into()
}

#[wasm_bindgen]
pub fn get_coordination_numbers(structure: JsCrystal, cutoff: f64) -> WasmResult<Vec<u32>> {
    if !cutoff.is_finite() || cutoff < 0.0 {
        return WasmResult::err("Cutoff must be finite and non-negative");
    }
    structure
        .to_structure()
        .map(|struc| {
            struc
                .get_coordination_numbers(cutoff)
                .into_iter()
                .map(|cn| cn as u32)
                .collect()
        })
        .into()
}

#[wasm_bindgen]
pub fn get_coordination_number(
    structure: JsCrystal,
    site_index: u32,
    cutoff: f64,
) -> WasmResult<u32> {
    if !cutoff.is_finite() || cutoff < 0.0 {
        return WasmResult::err("Cutoff must be finite and non-negative");
    }
    let result: Result<u32, String> = (|| {
        let struc = structure.to_structure()?;
        let idx = site_index as usize;
        if idx >= struc.num_sites() {
            return Err(format!(
                "Site index {idx} out of bounds for structure with {} sites",
                struc.num_sites()
            ));
        }
        Ok(struc.get_coordination_number(idx, cutoff) as u32)
    })();
    result.into()
}

#[wasm_bindgen]
pub fn get_local_environment(
    structure: JsCrystal,
    site_index: u32,
    cutoff: f64,
) -> WasmResult<JsLocalEnvironment> {
    if !cutoff.is_finite() || cutoff < 0.0 {
        return WasmResult::err("Cutoff must be finite and non-negative");
    }
    let result: Result<JsLocalEnvironment, String> = (|| {
        let struc = structure.to_structure()?;
        let idx = site_index as usize;
        if idx >= struc.num_sites() {
            return Err(format!(
                "Site index {idx} out of bounds for structure with {} sites",
                struc.num_sites()
            ));
        }
        let neighbors_raw = struc.get_local_environment(idx, cutoff);
        let neighbors: Vec<JsNeighborInfo> = neighbors_raw
            .into_iter()
            .map(|neighbor| JsNeighborInfo {
                site_index: neighbor.site_idx as u32,
                element: neighbor.species.element.symbol().to_string(),
                distance: neighbor.distance,
                image: neighbor.image,
            })
            .collect();
        let center_species = struc.species()[idx];
        Ok(JsLocalEnvironment {
            center_index: idx as u32,
            center_element: center_species.element.symbol().to_string(),
            coordination_number: neighbors.len() as u32,
            neighbors,
        })
    })();
    result.into()
}
