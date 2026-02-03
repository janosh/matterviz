//! Cell operations WASM bindings.

use nalgebra::Vector3;
use serde::{Deserialize, Serialize};
use tsify_next::Tsify;
use wasm_bindgen::prelude::*;

use crate::cell_ops;
use crate::wasm_types::{JsCrystal, JsIntMatrix3x3, WasmResult};

#[wasm_bindgen]
pub fn make_supercell_diag(
    structure: JsCrystal,
    scale_a: i32,
    scale_b: i32,
    scale_c: i32,
) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        if scale_a <= 0 || scale_b <= 0 || scale_c <= 0 {
            return Err(format!(
                "Supercell factors must be positive, got [{scale_a}, {scale_b}, {scale_c}]"
            ));
        }
        let struc = structure.to_structure()?;
        let supercell = struc.make_supercell_diag([scale_a, scale_b, scale_c]);
        Ok(JsCrystal::from_structure(&supercell))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn make_supercell(structure: JsCrystal, matrix: JsIntMatrix3x3) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let struc = structure.to_structure()?;
        let supercell = struc
            .make_supercell(matrix.0)
            .map_err(|err| err.to_string())?;
        Ok(JsCrystal::from_structure(&supercell))
    })();
    result.into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsNiggliResult {
    pub matrix: Vec<f64>,
    pub transformation: Vec<f64>,
    pub form: String,
}

#[wasm_bindgen]
pub fn cell_wrap_to_unit_cell(structure: JsCrystal) -> WasmResult<JsCrystal> {
    let result: Result<JsCrystal, String> = (|| {
        let mut struc = structure.to_structure()?;
        struc.wrap_to_unit_cell();
        Ok(JsCrystal::from_structure(&struc))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn cell_is_niggli_reduced(structure: JsCrystal, tolerance: f64) -> WasmResult<bool> {
    let result: Result<bool, String> = (|| {
        let struc = structure.to_structure()?;
        Ok(cell_ops::is_niggli_reduced(&struc.lattice, tolerance))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn cell_minimum_image_distance(
    structure: JsCrystal,
    frac1: Vec<f64>,
    frac2: Vec<f64>,
) -> WasmResult<f64> {
    let result: Result<f64, String> = (|| {
        let struc = structure.to_structure()?;
        if frac1.len() != 3 || frac2.len() != 3 {
            return Err("Fractional coords must have 3 components".to_string());
        }
        let f1 = Vector3::new(frac1[0], frac1[1], frac1[2]);
        let f2 = Vector3::new(frac2[0], frac2[1], frac2[2]);
        Ok(cell_ops::minimum_image_distance(
            &struc.lattice,
            &f1,
            &f2,
            [true, true, true],
        ))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn cell_minimum_image_vector(
    structure: JsCrystal,
    frac1: Vec<f64>,
    frac2: Vec<f64>,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        if frac1.len() != 3 || frac2.len() != 3 {
            return Err("Fractional coords must have 3 components".to_string());
        }
        let f1 = Vector3::new(frac1[0], frac1[1], frac1[2]);
        let f2 = Vector3::new(frac2[0], frac2[1], frac2[2]);
        let delta = f2 - f1;
        let vec = cell_ops::minimum_image_vector(&struc.lattice, &delta, [true, true, true]);
        Ok(serde_json::to_string(vec.as_slice()).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn cell_niggli_reduce(structure: JsCrystal, tolerance: f64) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let niggli =
            cell_ops::niggli_reduce(&struc.lattice, tolerance).map_err(|err| err.to_string())?;
        let lattice_matrix: Vec<Vec<f64>> = (0..3)
            .map(|idx| niggli.matrix.row(idx).iter().copied().collect())
            .collect();
        let json = serde_json::json!({
            "lattice_matrix": lattice_matrix,
            "transformation": niggli.transformation,
        });
        Ok(json.to_string())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn cell_delaunay_reduce(structure: JsCrystal, tolerance: f64) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let delaunay =
            cell_ops::delaunay_reduce(&struc.lattice, tolerance).map_err(|err| err.to_string())?;
        let lattice_matrix: Vec<Vec<f64>> = (0..3)
            .map(|idx| delaunay.matrix.row(idx).iter().copied().collect())
            .collect();
        let json = serde_json::json!({
            "lattice_matrix": lattice_matrix,
            "transformation": delaunay.transformation,
        });
        Ok(json.to_string())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn cell_find_supercell_matrix(structure: JsCrystal, target_atoms: u32) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let matrix = cell_ops::find_supercell_for_target_atoms(
            &struc.lattice,
            struc.num_sites(),
            target_atoms as usize,
        );
        Ok(serde_json::to_string(&matrix).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn cell_perpendicular_distances(structure: JsCrystal) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let dists = cell_ops::perpendicular_distances(&struc.lattice);
        Ok(serde_json::to_string(dists.as_slice()).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn cell_lattices_equivalent(
    structure1: JsCrystal,
    structure2: JsCrystal,
    tolerance: f64,
) -> WasmResult<bool> {
    let result: Result<bool, String> = (|| {
        let struc1 = structure1.to_structure()?;
        let struc2 = structure2.to_structure()?;
        Ok(cell_ops::lattices_equivalent(
            &struc1.lattice,
            &struc2.lattice,
            tolerance,
            tolerance,
        ))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn cell_is_supercell(
    structure: JsCrystal,
    other: JsCrystal,
    tolerance: f64,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let other_struc = other.to_structure()?;
        let matrix = cell_ops::is_supercell(&struc.lattice, &other_struc.lattice, tolerance);
        Ok(serde_json::to_string(&matrix).unwrap_or_default())
    })();
    result.into()
}
