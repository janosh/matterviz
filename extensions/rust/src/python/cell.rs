//! Cell reduction and transformation functions.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::cell_ops;

use super::helpers::{StructureJson, parse_struct, structure_to_pydict};

/// Calculate the minimum image distance between two points (in fractional coords).
#[pyfunction]
fn minimum_image_distance(
    structure: StructureJson,
    point1: [f64; 3],
    point2: [f64; 3],
) -> PyResult<f64> {
    let struc = parse_struct(&structure)?;
    let p1 = nalgebra::Vector3::new(point1[0], point1[1], point1[2]);
    let p2 = nalgebra::Vector3::new(point2[0], point2[1], point2[2]);
    Ok(cell_ops::minimum_image_distance(
        &struc.lattice,
        &p1,
        &p2,
        struc.pbc,
    ))
}

/// Calculate the minimum image vector (fractional delta -> cartesian vector).
#[pyfunction]
fn minimum_image_vector(
    structure: StructureJson,
    point1: [f64; 3],
    point2: [f64; 3],
) -> PyResult<[f64; 3]> {
    let struc = parse_struct(&structure)?;
    let p1 = nalgebra::Vector3::new(point1[0], point1[1], point1[2]);
    let p2 = nalgebra::Vector3::new(point2[0], point2[1], point2[2]);
    let delta = p2 - p1;
    let vec = cell_ops::minimum_image_vector(&struc.lattice, &delta, struc.pbc);
    Ok([vec.x, vec.y, vec.z])
}

/// Perform Niggli reduction on the lattice.
#[pyfunction]
fn niggli_reduce(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let reduced = struc
        .get_reduced_structure(crate::structure::ReductionAlgo::Niggli)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(structure_to_pydict(py, &reduced)?.unbind())
}

/// Check if a structure is Niggli reduced (compares against reducing it).
#[pyfunction]
#[pyo3(signature = (structure, tolerance = 1e-5))]
fn is_niggli_reduced(structure: StructureJson, tolerance: f64) -> PyResult<bool> {
    let struc = parse_struct(&structure)?;
    // Compare lattice vectors before and after reduction
    let reduced = struc
        .lattice
        .get_niggli_reduced(tolerance)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    let orig = struc.lattice.matrix();
    let red_mat = reduced.matrix();
    // Check if matrices are approximately equal
    for row in 0..3 {
        for col in 0..3 {
            if (orig[(row, col)] - red_mat[(row, col)]).abs() > tolerance {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// Perform Delaunay reduction on the lattice (uses LLL).
#[pyfunction]
fn delaunay_reduce(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let reduced = struc
        .get_reduced_structure(crate::structure::ReductionAlgo::LLL)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(structure_to_pydict(py, &reduced)?.unbind())
}

/// Find the supercell matrix for a target number of atoms.
#[pyfunction]
#[pyo3(signature = (structure, target_atoms = 100))]
fn find_supercell_matrix(structure: StructureJson, target_atoms: usize) -> PyResult<[[i32; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    Ok(cell_ops::find_supercell_matrix(
        &struc.lattice,
        struc.num_sites(),
        cell_ops::SupercellStrategy::TargetAtoms(target_atoms),
    ))
}

/// Check if two lattices are equivalent.
#[pyfunction]
#[pyo3(signature = (structure1, structure2, length_tol = 0.01, angle_tol = 1.0))]
fn lattices_equivalent(
    structure1: StructureJson,
    structure2: StructureJson,
    length_tol: f64,
    angle_tol: f64,
) -> PyResult<bool> {
    let s1 = parse_struct(&structure1)?;
    let s2 = parse_struct(&structure2)?;
    Ok(cell_ops::lattices_equivalent(
        &s1.lattice,
        &s2.lattice,
        length_tol,
        angle_tol,
    ))
}

/// Check if one structure is a supercell of another, returning the transformation matrix if so.
#[pyfunction]
#[pyo3(signature = (structure, potential_supercell, tolerance = 0.01))]
fn is_supercell(
    structure: StructureJson,
    potential_supercell: StructureJson,
    tolerance: f64,
) -> PyResult<Option<[[i32; 3]; 3]>> {
    let s1 = parse_struct(&structure)?;
    let s2 = parse_struct(&potential_supercell)?;
    Ok(cell_ops::is_supercell(&s1.lattice, &s2.lattice, tolerance))
}

/// Get perpendicular distances for each lattice direction.
#[pyfunction]
fn perpendicular_distances(structure: StructureJson) -> PyResult<[f64; 3]> {
    let struc = parse_struct(&structure)?;
    let perp = cell_ops::perpendicular_distances(&struc.lattice);
    Ok([perp[0], perp[1], perp[2]])
}

/// Register the cell submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "cell")?;
    submod.add_function(wrap_pyfunction!(minimum_image_distance, &submod)?)?;
    submod.add_function(wrap_pyfunction!(minimum_image_vector, &submod)?)?;
    submod.add_function(wrap_pyfunction!(niggli_reduce, &submod)?)?;
    submod.add_function(wrap_pyfunction!(is_niggli_reduced, &submod)?)?;
    submod.add_function(wrap_pyfunction!(delaunay_reduce, &submod)?)?;
    submod.add_function(wrap_pyfunction!(find_supercell_matrix, &submod)?)?;
    submod.add_function(wrap_pyfunction!(lattices_equivalent, &submod)?)?;
    submod.add_function(wrap_pyfunction!(is_supercell, &submod)?)?;
    submod.add_function(wrap_pyfunction!(perpendicular_distances, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
