//! Interatomic potentials WASM bindings.

use serde::{Deserialize, Serialize};
use tsify_next::Tsify;
use wasm_bindgen::prelude::*;

use crate::potentials;
use crate::wasm::{parse_flat_cell, parse_flat_vec3};
use crate::wasm_types::WasmResult;

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct JsPotentialResult {
    pub energy: f64,
    pub forces: Vec<f64>,
    pub stress: Option<[f64; 6]>,
}

fn potential_result_to_js(result: &potentials::PotentialResult) -> JsPotentialResult {
    let forces: Vec<f64> = result.forces.iter().flat_map(|f| [f.x, f.y, f.z]).collect();
    let stress = result.stress.as_ref().map(|s| {
        [
            s[(0, 0)],
            s[(1, 1)],
            s[(2, 2)],
            s[(1, 2)],
            s[(0, 2)],
            s[(0, 1)],
        ]
    });
    JsPotentialResult {
        energy: result.energy,
        forces,
        stress,
    }
}

#[wasm_bindgen]
pub fn compute_lennard_jones(
    positions: Vec<f64>,
    cell: Option<Vec<f64>>,
    pbc_x: bool,
    pbc_y: bool,
    pbc_z: bool,
    sigma: f64,
    epsilon: f64,
    cutoff: Option<f64>,
    compute_stress: bool,
) -> WasmResult<JsPotentialResult> {
    let result: Result<JsPotentialResult, String> = (|| {
        if sigma <= 0.0 {
            return Err("sigma must be positive".to_string());
        }
        if !sigma.is_finite() || !epsilon.is_finite() {
            return Err("sigma and epsilon must be finite".to_string());
        }
        if cutoff.is_some_and(|cut| cut <= 0.0 || !cut.is_finite()) {
            return Err("cutoff must be positive and finite".to_string());
        }

        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms)?;
        let cell_mat = parse_flat_cell(cell.as_deref())?;
        let pbc = [pbc_x, pbc_y, pbc_z];

        let params = potentials::LennardJonesParams::new(sigma, epsilon, cutoff);
        let result =
            potentials::compute_lj_full(&pos_vec, cell_mat.as_ref(), pbc, &params, compute_stress)
                .map_err(|e| e.to_string())?;
        Ok(potential_result_to_js(&result))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn compute_lennard_jones_forces(
    positions: Vec<f64>,
    cell: Option<Vec<f64>>,
    pbc_x: bool,
    pbc_y: bool,
    pbc_z: bool,
    sigma: f64,
    epsilon: f64,
    cutoff: Option<f64>,
) -> WasmResult<Vec<f64>> {
    let result: Result<Vec<f64>, String> = (|| {
        if sigma <= 0.0 || !sigma.is_finite() {
            return Err("sigma must be positive and finite".to_string());
        }
        if !epsilon.is_finite() {
            return Err("epsilon must be finite".to_string());
        }
        if cutoff.is_some_and(|cut| cut <= 0.0 || !cut.is_finite()) {
            return Err("cutoff must be positive and finite".to_string());
        }

        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms)?;
        let cell_mat = parse_flat_cell(cell.as_deref())?;
        let pbc = [pbc_x, pbc_y, pbc_z];

        let params = potentials::LennardJonesParams::new(sigma, epsilon, cutoff);
        let result = potentials::compute_lennard_jones(&pos_vec, cell_mat.as_ref(), pbc, &params)
            .map_err(|e| e.to_string())?;
        Ok(result.forces.iter().flat_map(|f| [f.x, f.y, f.z]).collect())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn compute_morse(
    positions: Vec<f64>,
    cell: Option<Vec<f64>>,
    pbc_x: bool,
    pbc_y: bool,
    pbc_z: bool,
    d: f64,
    alpha: f64,
    r0: f64,
    cutoff: f64,
    compute_stress: bool,
) -> WasmResult<JsPotentialResult> {
    let result: Result<JsPotentialResult, String> = (|| {
        if d < 0.0 || !d.is_finite() {
            return Err("d (well depth) must be non-negative and finite".to_string());
        }
        if alpha <= 0.0 || !alpha.is_finite() {
            return Err("alpha must be positive and finite".to_string());
        }
        if r0 <= 0.0 || !r0.is_finite() {
            return Err("r0 (equilibrium distance) must be positive and finite".to_string());
        }
        if cutoff <= 0.0 || !cutoff.is_finite() {
            return Err("cutoff must be positive and finite".to_string());
        }

        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms)?;
        let cell_mat = parse_flat_cell(cell.as_deref())?;
        let pbc = [pbc_x, pbc_y, pbc_z];

        let result = potentials::compute_morse_simple(
            &pos_vec,
            cell_mat.as_ref(),
            pbc,
            d,
            alpha,
            r0,
            cutoff,
            compute_stress,
        )
        .map_err(|e| e.to_string())?;
        Ok(potential_result_to_js(&result))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn compute_soft_sphere(
    positions: Vec<f64>,
    cell: Option<Vec<f64>>,
    pbc_x: bool,
    pbc_y: bool,
    pbc_z: bool,
    sigma: f64,
    epsilon: f64,
    alpha: f64,
    cutoff: f64,
    compute_stress: bool,
) -> WasmResult<JsPotentialResult> {
    let result: Result<JsPotentialResult, String> = (|| {
        if sigma <= 0.0 || !sigma.is_finite() {
            return Err("sigma must be positive and finite".to_string());
        }
        if !epsilon.is_finite() {
            return Err("epsilon must be finite".to_string());
        }
        if alpha <= 0.0 || !alpha.is_finite() {
            return Err("alpha (exponent) must be positive and finite".to_string());
        }
        if cutoff <= 0.0 || !cutoff.is_finite() {
            return Err("cutoff must be positive and finite".to_string());
        }

        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms)?;
        let cell_mat = parse_flat_cell(cell.as_deref())?;
        let pbc = [pbc_x, pbc_y, pbc_z];

        let result = potentials::compute_soft_sphere_simple(
            &pos_vec,
            cell_mat.as_ref(),
            pbc,
            sigma,
            epsilon,
            alpha,
            cutoff,
            compute_stress,
        )
        .map_err(|e| e.to_string())?;
        Ok(potential_result_to_js(&result))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn compute_harmonic_bonds(
    positions: Vec<f64>,
    bonds: Vec<f64>,
    cell: Option<Vec<f64>>,
    pbc_x: bool,
    pbc_y: bool,
    pbc_z: bool,
    compute_stress: bool,
) -> WasmResult<JsPotentialResult> {
    let result: Result<JsPotentialResult, String> = (|| {
        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms)?;
        let cell_mat = parse_flat_cell(cell.as_deref())?;
        let pbc = [pbc_x, pbc_y, pbc_z];

        if !bonds.len().is_multiple_of(4) {
            return Err("bonds array length must be divisible by 4".to_string());
        }
        let mut bond_vec: Vec<potentials::HarmonicBond> = Vec::with_capacity(bonds.len() / 4);
        for (bond_idx, chunk) in bonds.chunks(4).enumerate() {
            let idx_i = chunk[0];
            let idx_j = chunk[1];

            if !idx_i.is_finite() || idx_i < 0.0 || idx_i.fract() != 0.0 {
                return Err(format!("bond {bond_idx}: atom index i={idx_i} is invalid"));
            }
            if !idx_j.is_finite() || idx_j < 0.0 || idx_j.fract() != 0.0 {
                return Err(format!("bond {bond_idx}: atom index j={idx_j} is invalid"));
            }

            let idx_i_usize = idx_i as usize;
            let idx_j_usize = idx_j as usize;

            if idx_i_usize >= n_atoms {
                return Err(format!(
                    "bond {bond_idx}: atom index i={idx_i_usize} out of bounds"
                ));
            }
            if idx_j_usize >= n_atoms {
                return Err(format!(
                    "bond {bond_idx}: atom index j={idx_j_usize} out of bounds"
                ));
            }

            if !chunk[2].is_finite() {
                return Err(format!(
                    "bond {bond_idx}: spring constant k={} must be finite",
                    chunk[2]
                ));
            }
            if !chunk[3].is_finite() {
                return Err(format!(
                    "bond {bond_idx}: equilibrium distance r0={} must be finite",
                    chunk[3]
                ));
            }

            bond_vec.push(potentials::HarmonicBond::new(
                idx_i_usize,
                idx_j_usize,
                chunk[2],
                chunk[3],
            ));
        }

        let result = potentials::compute_harmonic_bonds(
            &pos_vec,
            &bond_vec,
            cell_mat.as_ref(),
            pbc,
            compute_stress,
        )
        .map_err(|e| e.to_string())?;
        Ok(potential_result_to_js(&result))
    })();
    result.into()
}
