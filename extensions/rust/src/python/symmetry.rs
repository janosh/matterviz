//! Symmetry and space group functions.

use nalgebra::{Matrix3, Vector3};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::structure::{SymmOp, spacegroup_to_crystal_system};

use super::helpers::{StructureJson, parse_struct, structure_to_pydict};

/// Get the space group number.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_spacegroup_number(structure: StructureJson, symprec: f64) -> PyResult<i32> {
    let struc = parse_struct(&structure)?;
    struc
        .get_spacegroup_number(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))
}

/// Get the space group symbol.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_spacegroup_symbol(structure: StructureJson, symprec: f64) -> PyResult<String> {
    let struc = parse_struct(&structure)?;
    struc
        .get_spacegroup_symbol(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))
}

/// Get the Hall number.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_hall_number(structure: StructureJson, symprec: f64) -> PyResult<i32> {
    let struc = parse_struct(&structure)?;
    struc
        .get_hall_number(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))
}

/// Get the crystal system.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_crystal_system(structure: StructureJson, symprec: f64) -> PyResult<String> {
    let struc = parse_struct(&structure)?;
    let spg = struc
        .get_spacegroup_number(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(spacegroup_to_crystal_system(spg).to_string())
}

/// Get the Pearson symbol.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_pearson_symbol(structure: StructureJson, symprec: f64) -> PyResult<String> {
    let struc = parse_struct(&structure)?;
    struc
        .get_pearson_symbol(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))
}

/// Get Wyckoff letters for all sites.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_wyckoff_letters(structure: StructureJson, symprec: f64) -> PyResult<Vec<String>> {
    let struc = parse_struct(&structure)?;
    let letters = struc
        .get_wyckoff_letters(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(letters.into_iter().map(|c| c.to_string()).collect())
}

/// Get symmetry operations.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_symmetry_operations(
    py: Python<'_>,
    structure: StructureJson,
    symprec: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    let struc = parse_struct(&structure)?;
    let ops = struc
        .get_symmetry_operations(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    ops.iter()
        .map(|(rot, trans)| {
            let dict = PyDict::new(py);
            dict.set_item("rotation", rot.to_vec())?;
            dict.set_item("translation", trans.to_vec())?;
            Ok(dict.unbind())
        })
        .collect()
}

/// Get equivalent sites.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_equivalent_sites(structure: StructureJson, symprec: f64) -> PyResult<Vec<usize>> {
    let struc = parse_struct(&structure)?;
    struc
        .get_equivalent_sites(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))
}

/// Get the primitive cell.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_primitive(py: Python<'_>, structure: StructureJson, symprec: f64) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let primitive = struc
        .get_primitive(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(structure_to_pydict(py, &primitive)?.unbind())
}

/// Get the conventional cell.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_conventional(
    py: Python<'_>,
    structure: StructureJson,
    symprec: f64,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let conventional = struc
        .get_conventional_structure(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(structure_to_pydict(py, &conventional)?.unbind())
}

/// Get the full symmetry dataset.
#[pyfunction]
#[pyo3(signature = (structure, symprec = 0.01))]
fn get_symmetry_dataset(
    py: Python<'_>,
    structure: StructureJson,
    symprec: f64,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let dataset = struc
        .get_symmetry_dataset(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let dict = PyDict::new(py);
    dict.set_item("spacegroup_number", dataset.number)?;
    dict.set_item("spacegroup_symbol", &dataset.hm_symbol)?;
    dict.set_item("hall_number", dataset.hall_number)?;
    dict.set_item("hm_symbol", &dataset.hm_symbol)?;
    dict.set_item("pearson_symbol", &dataset.pearson_symbol)?;
    dict.set_item("num_operations", dataset.operations.len())?;

    dict.set_item(
        "crystal_system",
        spacegroup_to_crystal_system(dataset.number),
    )?;

    // Add wyckoff letters
    let wyckoff = struc
        .get_wyckoff_letters(symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    let wyckoff_strs: Vec<String> = wyckoff.into_iter().map(|c| c.to_string()).collect();
    dict.set_item("wyckoff_letters", wyckoff_strs)?;

    // Add equivalent sites
    let equiv = struc
        .get_equivalent_sites(symprec)
        .map_err(|err: crate::FerroxError| PyValueError::new_err(err.to_string()))?;
    dict.set_item("equivalent_sites", equiv)?;

    // Placeholder for site symmetry symbols (not available in current spglib wrapper)
    let site_syms: Vec<&str> = (0..struc.num_sites()).map(|_| "").collect();
    dict.set_item("site_symmetry_symbols", site_syms)?;

    // Add symmetry operations as list of (rotation, translation) tuples
    // Convert from Moyo Operations to arrays
    let ops: Vec<(Vec<Vec<i32>>, Vec<f64>)> = dataset
        .operations
        .iter()
        .map(|op| {
            let rot_vec: Vec<Vec<i32>> = (0..3)
                .map(|i| (0..3).map(|j| op.rotation[(i, j)]).collect())
                .collect();
            let trans_vec = vec![op.translation.x, op.translation.y, op.translation.z];
            (rot_vec, trans_vec)
        })
        .collect();
    dict.set_item("symmetry_operations", ops)?;

    Ok(dict.unbind())
}

/// Apply a symmetry operation (rotation + translation) to a structure.
#[pyfunction]
#[pyo3(signature = (structure, rotation, translation, fractional = true))]
fn apply_operation(
    py: Python<'_>,
    structure: StructureJson,
    rotation: [[f64; 3]; 3],
    translation: [f64; 3],
    fractional: bool,
) -> PyResult<Py<PyDict>> {
    let mut struc = parse_struct(&structure)?;
    let rot = Matrix3::from_row_slice(&rotation.concat());
    let op = SymmOp::new(rot, Vector3::from(translation));
    struc.apply_operation(&op, fractional);
    Ok(structure_to_pydict(py, &struc)?.unbind())
}

/// Apply inversion through the origin.
#[pyfunction]
#[pyo3(signature = (structure, fractional = true))]
fn apply_inversion(
    py: Python<'_>,
    structure: StructureJson,
    fractional: bool,
) -> PyResult<Py<PyDict>> {
    let mut struc = parse_struct(&structure)?;
    struc.apply_operation(&SymmOp::inversion(), fractional);
    Ok(structure_to_pydict(py, &struc)?.unbind())
}

/// Apply a translation to all sites.
#[pyfunction]
#[pyo3(signature = (structure, translation, fractional = true))]
fn apply_translation(
    py: Python<'_>,
    structure: StructureJson,
    translation: [f64; 3],
    fractional: bool,
) -> PyResult<Py<PyDict>> {
    let mut struc = parse_struct(&structure)?;
    struc.apply_operation(&SymmOp::translation(Vector3::from(translation)), fractional);
    Ok(structure_to_pydict(py, &struc)?.unbind())
}

/// Register the symmetry submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "symmetry")?;
    submod.add_function(wrap_pyfunction!(get_spacegroup_number, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_spacegroup_symbol, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_hall_number, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_crystal_system, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_pearson_symbol, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_wyckoff_letters, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_symmetry_operations, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_equivalent_sites, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_primitive, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_conventional, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_symmetry_dataset, &submod)?)?;
    submod.add_function(wrap_pyfunction!(apply_operation, &submod)?)?;
    submod.add_function(wrap_pyfunction!(apply_inversion, &submod)?)?;
    submod.add_function(wrap_pyfunction!(apply_translation, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
