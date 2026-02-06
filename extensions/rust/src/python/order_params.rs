//! Order parameter calculations (Steinhardt Q).

use pyo3::prelude::*;
use pyo3_stub_gen::derive::gen_stub_pyfunction;

use crate::order_params::{self, LocalStructure};

use super::helpers::{StructureJson, parse_struct};

/// Convert LocalStructure enum to lowercase string.
fn local_structure_to_str(ls: LocalStructure) -> &'static str {
    match ls {
        LocalStructure::Fcc => "fcc",
        LocalStructure::Bcc => "bcc",
        LocalStructure::Hcp => "hcp",
        LocalStructure::Icosahedral => "icosahedral",
        LocalStructure::Liquid => "liquid",
        LocalStructure::Unknown => "unknown",
    }
}

/// Compute Steinhardt Q order parameter for all atoms.
#[gen_stub_pyfunction]
#[pyfunction]
fn compute_steinhardt_q(structure: StructureJson, deg: i32, cutoff: f64) -> PyResult<Vec<f64>> {
    let struc = parse_struct(&structure)?;
    Ok(order_params::compute_steinhardt_q(&struc, deg, cutoff))
}

/// Classify local structure based on Q4 and Q6 values.
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (q4, q6, tolerance = 0.1))]
fn classify_local_structure(q4: f64, q6: f64, tolerance: f64) -> &'static str {
    local_structure_to_str(order_params::classify_local_structure(q4, q6, tolerance))
}

/// Classify all atoms in a structure.
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure, cutoff, tolerance = 0.1))]
fn classify_all_atoms(
    structure: StructureJson,
    cutoff: f64,
    tolerance: f64,
) -> PyResult<Vec<&'static str>> {
    let struc = parse_struct(&structure)?;
    let classifications = order_params::classify_all_atoms(&struc, cutoff, tolerance);
    Ok(classifications
        .into_iter()
        .map(local_structure_to_str)
        .collect())
}

/// Register the order_params submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "order_params")?;
    submod.add_function(wrap_pyfunction!(compute_steinhardt_q, &submod)?)?;
    submod.add_function(wrap_pyfunction!(classify_local_structure, &submod)?)?;
    submod.add_function(wrap_pyfunction!(classify_all_atoms, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
