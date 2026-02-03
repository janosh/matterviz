//! Physical property Python bindings.

use pyo3::prelude::*;
use pyo3::types::PyDict;

use super::helpers::{StructureJson, parse_struct};

/// Get the volume of a structure in Angstrom^3.
#[pyfunction]
fn get_volume(structure: StructureJson) -> PyResult<f64> {
    let struc = parse_struct(&structure)?;
    Ok(struc.volume())
}

/// Get the total mass of a structure in atomic mass units (amu).
#[pyfunction]
fn get_total_mass(structure: StructureJson) -> PyResult<f64> {
    let struc = parse_struct(&structure)?;
    Ok(struc.total_mass())
}

/// Get the density of a structure in g/cm^3.
///
/// Returns None for non-periodic or zero-volume structures.
#[pyfunction]
fn get_density(structure: StructureJson) -> PyResult<Option<f64>> {
    let struc = parse_struct(&structure)?;
    Ok(struc.density())
}

/// Get structure metadata as a dictionary.
#[pyfunction]
fn get_structure_metadata(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let comp = struc.composition();
    let lengths = struc.lattice.lengths();
    let angles = struc.lattice.angles();

    let dict = PyDict::new(py);
    dict.set_item("n_sites", struc.num_sites())?;
    dict.set_item("formula", comp.reduced_formula())?;
    dict.set_item("formula_anonymous", comp.anonymous_formula())?;
    dict.set_item("formula_hill", comp.hill_formula())?;
    dict.set_item("volume", struc.volume())?;
    dict.set_item("density", struc.density())?;
    dict.set_item("lattice_params", [lengths.x, lengths.y, lengths.z])?;
    dict.set_item("lattice_angles", [angles.x, angles.y, angles.z])?;
    dict.set_item("is_ordered", struc.is_ordered())?;
    dict.set_item(
        "elements",
        struc
            .species()
            .into_iter()
            .map(|s| s.element.symbol().to_string())
            .collect::<Vec<_>>(),
    )?;
    Ok(dict.into())
}

/// Register the properties submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "properties")?;
    submod.add_function(wrap_pyfunction!(get_volume, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_total_mass, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_density, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_structure_metadata, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
