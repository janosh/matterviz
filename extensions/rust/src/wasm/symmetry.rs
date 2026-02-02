//! Symmetry WASM bindings.

use wasm_bindgen::prelude::*;

use crate::wasm_types::{JsCrystal, JsSymmetryDataset, JsSymmetryOperation, WasmResult};

#[wasm_bindgen]
pub fn get_spacegroup_number(structure: JsCrystal, symprec: f64) -> WasmResult<u16> {
    structure
        .to_structure()
        .and_then(|struc| {
            struc
                .get_spacegroup_number(symprec)
                .map_err(|e| e.to_string())
        })
        .map(|sg| sg as u16)
        .into()
}

#[wasm_bindgen]
pub fn get_spacegroup_symbol(structure: JsCrystal, symprec: f64) -> WasmResult<String> {
    structure
        .to_structure()
        .and_then(|struc| {
            struc
                .get_spacegroup_symbol(symprec)
                .map_err(|e| e.to_string())
        })
        .into()
}

#[wasm_bindgen]
pub fn get_crystal_system(structure: JsCrystal, symprec: f64) -> WasmResult<String> {
    structure
        .to_structure()
        .and_then(|struc| struc.get_crystal_system(symprec).map_err(|e| e.to_string()))
        .into()
}

#[wasm_bindgen]
pub fn get_wyckoff_letters(structure: JsCrystal, symprec: f64) -> WasmResult<Vec<String>> {
    let result: Result<Vec<String>, String> = (|| {
        let struc = structure.to_structure()?;
        let letters = struc
            .get_wyckoff_letters(symprec)
            .map_err(|err| err.to_string())?;
        Ok(letters
            .into_iter()
            .map(|letter| letter.to_string())
            .collect())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn get_symmetry_operations(
    structure: JsCrystal,
    symprec: f64,
) -> WasmResult<Vec<JsSymmetryOperation>> {
    let result: Result<Vec<JsSymmetryOperation>, String> = (|| {
        let struc = structure.to_structure()?;
        let ops = struc
            .get_symmetry_operations(symprec)
            .map_err(|err| err.to_string())?;
        Ok(ops
            .into_iter()
            .map(|(rot, trans)| JsSymmetryOperation {
                rotation: rot,
                translation: trans,
            })
            .collect())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn get_symmetry_dataset(structure: JsCrystal, symprec: f64) -> WasmResult<JsSymmetryDataset> {
    use crate::structure::{moyo_ops_to_arrays, spacegroup_to_crystal_system};

    let result: Result<JsSymmetryDataset, String> = (|| {
        let struc = structure.to_structure()?;
        let dataset = struc
            .get_symmetry_dataset(symprec)
            .map_err(|err| err.to_string())?;
        let operations = moyo_ops_to_arrays(&dataset.operations);
        Ok(JsSymmetryDataset {
            spacegroup_number: dataset.number as u16,
            spacegroup_symbol: dataset.hm_symbol,
            hall_number: dataset.hall_number as u16,
            crystal_system: spacegroup_to_crystal_system(dataset.number).to_string(),
            wyckoff_letters: dataset
                .wyckoffs
                .into_iter()
                .map(|letter| letter.to_string())
                .collect(),
            site_symmetry_symbols: dataset.site_symmetry_symbols,
            equivalent_atoms: dataset.orbits.into_iter().map(|idx| idx as u32).collect(),
            operations: operations
                .into_iter()
                .map(|(rot, trans)| JsSymmetryOperation {
                    rotation: rot,
                    translation: trans,
                })
                .collect(),
        })
    })();
    result.into()
}

#[wasm_bindgen]
pub fn get_pearson_symbol(structure: JsCrystal, symprec: f64) -> WasmResult<String> {
    structure
        .to_structure()
        .and_then(|struc| struc.get_pearson_symbol(symprec).map_err(|e| e.to_string()))
        .into()
}

#[wasm_bindgen]
pub fn get_hall_number(structure: JsCrystal, symprec: f64) -> WasmResult<i32> {
    structure
        .to_structure()
        .and_then(|struc| struc.get_hall_number(symprec).map_err(|e| e.to_string()))
        .into()
}

#[wasm_bindgen]
pub fn get_site_symmetry_symbols(structure: JsCrystal, symprec: f64) -> WasmResult<Vec<String>> {
    structure
        .to_structure()
        .and_then(|struc| {
            struc
                .get_site_symmetry_symbols(symprec)
                .map_err(|e| e.to_string())
        })
        .into()
}

#[wasm_bindgen]
pub fn get_equivalent_sites(structure: JsCrystal, symprec: f64) -> WasmResult<Vec<u32>> {
    structure
        .to_structure()
        .and_then(|struc| {
            struc
                .get_equivalent_sites(symprec)
                .map(|v| v.into_iter().map(|x| x as u32).collect())
                .map_err(|e| e.to_string())
        })
        .into()
}

#[wasm_bindgen]
pub fn is_periodic_image(
    structure: JsCrystal,
    site_i: u32,
    site_j: u32,
    tolerance: f64,
) -> WasmResult<bool> {
    if !tolerance.is_finite() || tolerance < 0.0 {
        return WasmResult::err(format!(
            "tolerance must be finite and >= 0, got {tolerance}"
        ));
    }
    structure
        .to_structure()
        .and_then(|struc| {
            let num_sites = struc.num_sites();
            if site_i as usize >= num_sites {
                return Err(format!(
                    "site_i={site_i} out of bounds for structure with {num_sites} sites"
                ));
            }
            if site_j as usize >= num_sites {
                return Err(format!(
                    "site_j={site_j} out of bounds for structure with {num_sites} sites"
                ));
            }
            Ok(struc.is_periodic_image(site_i as usize, site_j as usize, tolerance))
        })
        .into()
}
