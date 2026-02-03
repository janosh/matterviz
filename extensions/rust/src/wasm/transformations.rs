//! Transformation WASM bindings.

use nalgebra::Vector3;
use wasm_bindgen::prelude::*;

use crate::species::Species;
use crate::wasm_types::{JsCrystal, JsMatrix3x3, JsVector3, WasmResult};

/// Validate site indices are within bounds.
#[inline]
fn validate_site_indices(indices: &[usize], num_sites: usize) -> Result<(), String> {
    for &site_idx in indices {
        if site_idx >= num_sites {
            return Err(format!(
                "Index {site_idx} out of bounds for structure with {num_sites} sites"
            ));
        }
    }
    Ok(())
}

#[wasm_bindgen]
pub fn get_sorted_structure(structure: JsCrystal, reverse: bool) -> WasmResult<JsCrystal> {
    structure
        .to_structure()
        .map(|struc| JsCrystal::from_structure(&struc.get_sorted_structure(reverse)))
        .into()
}

#[wasm_bindgen]
pub fn get_sorted_by_electronegativity(
    structure: JsCrystal,
    reverse: bool,
) -> WasmResult<JsCrystal> {
    structure
        .to_structure()
        .map(|struc| JsCrystal::from_structure(&struc.get_sorted_by_electronegativity(reverse)))
        .into()
}

#[wasm_bindgen]
pub fn interpolate_structures(
    start: JsCrystal,
    end: JsCrystal,
    n_images: u32,
    interpolate_lattices: bool,
    use_pbc: bool,
) -> WasmResult<Vec<JsCrystal>> {
    let result: Result<Vec<JsCrystal>, String> = (|| {
        let s1 = start.to_structure()?;
        let s2 = end.to_structure()?;
        let images = s1
            .interpolate(&s2, n_images as usize, interpolate_lattices, use_pbc)
            .map_err(|err| err.to_string())?;
        Ok(images.iter().map(JsCrystal::from_structure).collect())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn copy_structure(structure: JsCrystal, sanitize: bool) -> WasmResult<JsCrystal> {
    structure
        .to_structure()
        .map(|struc| JsCrystal::from_structure(&struc.copy(sanitize)))
        .into()
}

#[wasm_bindgen]
pub fn wrap_to_unit_cell(structure: JsCrystal) -> WasmResult<JsCrystal> {
    structure
        .to_structure()
        .map(|mut struc| {
            struc.wrap_to_unit_cell();
            JsCrystal::from_structure(&struc)
        })
        .into()
}

#[wasm_bindgen]
pub fn translate_sites(
    structure: JsCrystal,
    indices: Vec<u32>,
    vector: JsVector3,
    fractional: bool,
) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let mut struc = structure.to_structure()?;
        let idx: Vec<usize> = indices.into_iter().map(|idx| idx as usize).collect();
        validate_site_indices(&idx, struc.num_sites())?;
        struc.translate_sites(&idx, Vector3::from(vector.0), fractional);
        Ok(JsCrystal::from_structure(&struc))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn perturb_structure(
    structure: JsCrystal,
    distance: f64,
    min_distance: Option<f64>,
    seed: Option<u64>,
) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        if distance < 0.0 {
            return Err("distance must be non-negative".to_string());
        }
        if let Some(min_dist) = min_distance {
            if min_dist < 0.0 {
                return Err("min_distance must be non-negative".to_string());
            }
            if min_dist > distance {
                return Err(format!(
                    "distance ({distance}) must be >= min_distance ({min_dist})"
                ));
            }
        }
        let mut struc = structure.to_structure()?;
        struc.perturb(distance, min_distance, seed);
        Ok(JsCrystal::from_structure(&struc))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn apply_operation(
    structure: JsCrystal,
    rotation: JsMatrix3x3,
    translation: JsVector3,
    fractional: bool,
) -> WasmResult<JsCrystal> {
    use crate::structure::SymmOp;
    use nalgebra::Matrix3;

    structure
        .to_structure()
        .map(|struc| {
            let r = &rotation.0;
            let rot_mat = Matrix3::from_row_slice(&[
                r[0][0], r[0][1], r[0][2], r[1][0], r[1][1], r[1][2], r[2][0], r[2][1], r[2][2],
            ]);
            let op = SymmOp::new(rot_mat, Vector3::from(translation.0));
            JsCrystal::from_structure(&struc.apply_operation_copy(&op, fractional))
        })
        .into()
}

#[wasm_bindgen]
pub fn apply_inversion(structure: JsCrystal, fractional: bool) -> WasmResult<JsCrystal> {
    use crate::structure::SymmOp;
    structure
        .to_structure()
        .map(|struc| {
            JsCrystal::from_structure(&struc.apply_operation_copy(&SymmOp::inversion(), fractional))
        })
        .into()
}

#[wasm_bindgen]
pub fn substitute_species(
    structure: JsCrystal,
    old_species: &str,
    new_species: &str,
) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let struc = structure.to_structure()?;
        let old = Species::from_string(old_species)
            .ok_or_else(|| format!("Invalid species string: {old_species}"))?;
        let new = Species::from_string(new_species)
            .ok_or_else(|| format!("Invalid species string: {new_species}"))?;
        let substituted = struc.substitute(old, new).map_err(|err| err.to_string())?;
        Ok(JsCrystal::from_structure(&substituted))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn remove_species(structure: JsCrystal, species: Vec<String>) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let struc = structure.to_structure()?;
        let species_vec: Vec<Species> = species
            .iter()
            .map(|s| Species::from_string(s).ok_or_else(|| format!("Invalid species string: {s}")))
            .collect::<Result<_, _>>()?;
        let new_s = struc
            .remove_species(&species_vec)
            .map_err(|err| err.to_string())?;
        Ok(JsCrystal::from_structure(&new_s))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn remove_sites(structure: JsCrystal, indices: Vec<u32>) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let struc = structure.to_structure()?;
        let idx: Vec<usize> = indices.into_iter().map(|idx| idx as usize).collect();
        validate_site_indices(&idx, struc.num_sites())?;
        let new_s = struc.remove_sites(&idx).map_err(|err| err.to_string())?;
        Ok(JsCrystal::from_structure(&new_s))
    })();
    result.into()
}
