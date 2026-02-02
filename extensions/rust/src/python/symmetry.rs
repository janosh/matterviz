//! Symmetry and space group functions.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::structure::spacegroup_to_crystal_system;

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
    dict.set_item("hall_number", dataset.hall_number)?;
    dict.set_item("hm_symbol", &dataset.hm_symbol)?;
    dict.set_item("pearson_symbol", &dataset.pearson_symbol)?;
    dict.set_item("n_operations", dataset.operations.len())?;

    Ok(dict.unbind())
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
    parent.add_submodule(&submod)?;
    Ok(())
}
