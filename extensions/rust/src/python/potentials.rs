//! Classical interatomic potentials (LJ, Morse, harmonic bonds, etc.).

use nalgebra::Matrix3;
use pyo3::exceptions::{PyIndexError, PyValueError};
use pyo3::prelude::*;
use pyo3_stub_gen::derive::gen_stub_pyfunction;

use crate::potentials;

use super::helpers::{
    array_to_mat3, default_pbc, mat3_to_array, positions_to_vec3, validate_array_index,
    vec3_to_positions,
};

#[inline]
fn cell_to_matrix3(cell: Option<[[f64; 3]; 3]>) -> Option<Matrix3<f64>> {
    cell.map(array_to_mat3)
}

// === Lennard-Jones ===

/// Validate Lennard-Jones parameters.
#[inline]
fn validate_lj_params(sigma: f64, epsilon: f64, cutoff: Option<f64>) -> PyResult<()> {
    if !sigma.is_finite() || sigma <= 0.0 {
        return Err(PyValueError::new_err("sigma must be positive and finite"));
    }
    if !epsilon.is_finite() {
        return Err(PyValueError::new_err("epsilon must be finite"));
    }
    if let Some(cut) = cutoff {
        if !cut.is_finite() || cut <= 0.0 {
            return Err(PyValueError::new_err("cutoff must be positive and finite"));
        }
    }
    Ok(())
}

/// Compute Lennard-Jones energy and forces.
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (positions, cell = None, pbc = None, sigma = 3.4, epsilon = 0.0103, cutoff = None))]
fn compute_lennard_jones(
    positions: Vec<[f64; 3]>,
    cell: Option<[[f64; 3]; 3]>,
    pbc: Option<[bool; 3]>,
    sigma: f64,
    epsilon: f64,
    cutoff: Option<f64>,
) -> PyResult<(f64, Vec<[f64; 3]>)> {
    validate_lj_params(sigma, epsilon, cutoff)?;
    let pos_vec = positions_to_vec3(&positions);
    let cell_mat = cell_to_matrix3(cell);
    let pbc_arr = default_pbc(pbc, cell.is_some());

    let params = potentials::LennardJonesParams::new(sigma, epsilon, cutoff);
    let result = potentials::compute_lennard_jones(&pos_vec, cell_mat.as_ref(), pbc_arr, &params)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    Ok((result.energy, vec3_to_positions(&result.forces)))
}

/// Compute Lennard-Jones forces only.
///
/// Note: Energy is still computed internally but discarded. If you need both
/// energy and forces, use `compute_lennard_jones` instead.
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (positions, cell = None, pbc = None, sigma = 3.4, epsilon = 0.0103, cutoff = None))]
fn compute_lennard_jones_forces(
    positions: Vec<[f64; 3]>,
    cell: Option<[[f64; 3]; 3]>,
    pbc: Option<[bool; 3]>,
    sigma: f64,
    epsilon: f64,
    cutoff: Option<f64>,
) -> PyResult<Vec<[f64; 3]>> {
    validate_lj_params(sigma, epsilon, cutoff)?;
    let pos_vec = positions_to_vec3(&positions);
    let cell_mat = cell_to_matrix3(cell);
    let pbc_arr = default_pbc(pbc, cell.is_some());
    let params = potentials::LennardJonesParams::new(sigma, epsilon, cutoff);
    let forces =
        potentials::compute_lennard_jones_forces(&pos_vec, cell_mat.as_ref(), pbc_arr, &params)
            .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(vec3_to_positions(&forces))
}

// === Morse ===

/// Compute Morse potential energy and forces.
/// V(r) = D * (1 - exp(-alpha*(r - r0)))^2 - D
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (positions, cell = None, pbc = None, d = 1.0, alpha = 1.0, r0 = 1.0, cutoff = 10.0, compute_stress = false))]
fn compute_morse(
    positions: Vec<[f64; 3]>,
    cell: Option<[[f64; 3]; 3]>,
    pbc: Option<[bool; 3]>,
    d: f64,
    alpha: f64,
    r0: f64,
    cutoff: f64,
    compute_stress: bool,
) -> PyResult<(f64, Vec<[f64; 3]>, Option<[[f64; 3]; 3]>)> {
    let pos_vec = positions_to_vec3(&positions);
    let cell_mat = cell_to_matrix3(cell);
    let pbc_arr = default_pbc(pbc, cell.is_some());

    let result = potentials::compute_morse_simple(
        &pos_vec,
        cell_mat.as_ref(),
        pbc_arr,
        d,
        alpha,
        r0,
        cutoff,
        compute_stress,
    )
    .map_err(|err| PyValueError::new_err(err.to_string()))?;

    Ok((
        result.energy,
        vec3_to_positions(&result.forces),
        result.stress.as_ref().map(mat3_to_array),
    ))
}

// === Soft Sphere ===

/// Compute Soft Sphere potential energy and forces.
/// V(r) = epsilon * (sigma/r)^alpha
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (positions, cell = None, pbc = None, sigma = 1.0, epsilon = 1.0, alpha = 12.0, cutoff = 10.0, compute_stress = false))]
fn compute_soft_sphere(
    positions: Vec<[f64; 3]>,
    cell: Option<[[f64; 3]; 3]>,
    pbc: Option<[bool; 3]>,
    sigma: f64,
    epsilon: f64,
    alpha: f64,
    cutoff: f64,
    compute_stress: bool,
) -> PyResult<(f64, Vec<[f64; 3]>, Option<[[f64; 3]; 3]>)> {
    let pos_vec = positions_to_vec3(&positions);
    let cell_mat = cell_to_matrix3(cell);
    let pbc_arr = default_pbc(pbc, cell.is_some());

    let result = potentials::compute_soft_sphere_simple(
        &pos_vec,
        cell_mat.as_ref(),
        pbc_arr,
        sigma,
        epsilon,
        alpha,
        cutoff,
        compute_stress,
    )
    .map_err(|err| PyValueError::new_err(err.to_string()))?;

    Ok((
        result.energy,
        vec3_to_positions(&result.forces),
        result.stress.as_ref().map(mat3_to_array),
    ))
}

// === Harmonic Bonds ===

/// Compute harmonic bond energy and forces.
/// V = 0.5 * k * (r - r0)^2
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (positions, bonds, cell = None, pbc = None, compute_stress = false))]
fn compute_harmonic_bonds(
    positions: Vec<[f64; 3]>,
    bonds: Vec<[f64; 4]>,
    cell: Option<[[f64; 3]; 3]>,
    pbc: Option<[bool; 3]>,
    compute_stress: bool,
) -> PyResult<(f64, Vec<[f64; 3]>, Option<[[f64; 3]; 3]>)> {
    let pos_vec = positions_to_vec3(&positions);
    let cell_mat = cell_to_matrix3(cell);
    let pbc_arr = default_pbc(pbc, cell.is_some());
    let n_atoms = pos_vec.len();

    // Convert bonds with validation
    let mut bond_vec: Vec<potentials::HarmonicBond> = Vec::with_capacity(bonds.len());

    for (bond_idx, bond) in bonds.iter().enumerate() {
        let idx_i = validate_array_index(bond[0], &format!("bond {bond_idx}: atom index i"))?;
        let idx_j = validate_array_index(bond[1], &format!("bond {bond_idx}: atom index j"))?;

        // Check bounds
        if idx_i >= n_atoms {
            return Err(PyIndexError::new_err(format!(
                "bond {bond_idx}: atom index i={idx_i} out of bounds (n_atoms={n_atoms})"
            )));
        }
        if idx_j >= n_atoms {
            return Err(PyIndexError::new_err(format!(
                "bond {bond_idx}: atom index j={idx_j} out of bounds (n_atoms={n_atoms})"
            )));
        }

        bond_vec.push(potentials::HarmonicBond::new(
            idx_i, idx_j, bond[2], bond[3],
        ));
    }

    let result = potentials::compute_harmonic_bonds(
        &pos_vec,
        &bond_vec,
        cell_mat.as_ref(),
        pbc_arr,
        compute_stress,
    )
    .map_err(|err| PyValueError::new_err(err.to_string()))?;

    Ok((
        result.energy,
        vec3_to_positions(&result.forces),
        result.stress.as_ref().map(mat3_to_array),
    ))
}

/// Register the potentials submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "potentials")?;
    submod.add_function(wrap_pyfunction!(compute_lennard_jones, &submod)?)?;
    submod.add_function(wrap_pyfunction!(compute_lennard_jones_forces, &submod)?)?;
    submod.add_function(wrap_pyfunction!(compute_morse, &submod)?)?;
    submod.add_function(wrap_pyfunction!(compute_soft_sphere, &submod)?)?;
    submod.add_function(wrap_pyfunction!(compute_harmonic_bonds, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
