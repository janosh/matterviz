//! FIRE and CellFIRE optimizer WASM bindings.

use wasm_bindgen::prelude::*;

use crate::optimizers;
use crate::wasm_types::WasmResult;

use super::helpers::{parse_flat_cell, parse_flat_vec3, validate_positive_f64};

/// FIRE optimizer configuration.
#[wasm_bindgen]
pub struct JsFireConfig {
    inner: optimizers::FireConfig,
}

#[wasm_bindgen]
impl JsFireConfig {
    /// Create a new FIRE configuration with default parameters.
    #[wasm_bindgen(constructor)]
    pub fn new() -> JsFireConfig {
        JsFireConfig {
            inner: optimizers::FireConfig::default(),
        }
    }

    /// Set initial timestep.
    #[wasm_bindgen]
    pub fn set_dt_start(&mut self, dt_start: f64) {
        self.inner.dt_start = dt_start;
    }

    /// Set maximum timestep.
    #[wasm_bindgen]
    pub fn set_dt_max(&mut self, dt_max: f64) {
        self.inner.dt_max = dt_max;
    }

    /// Set minimum steps before dt increase.
    #[wasm_bindgen]
    pub fn set_n_min(&mut self, n_min: usize) {
        self.inner.n_min = n_min;
    }

    /// Set maximum step size in Angstrom.
    #[wasm_bindgen]
    pub fn set_max_step(&mut self, max_step: f64) {
        self.inner.max_step = max_step;
    }
}

impl Default for JsFireConfig {
    fn default() -> Self {
        Self::new()
    }
}

/// FIRE optimizer state.
#[wasm_bindgen]
pub struct JsFireState {
    inner: optimizers::FireState,
    config: optimizers::FireConfig,
}

#[wasm_bindgen]
impl JsFireState {
    /// Create a new FIRE state.
    ///
    /// positions: flat array [x0, y0, z0, ...] in Angstrom
    /// config: optional FIRE configuration (uses defaults if not provided)
    ///
    /// Returns an error if positions length is not a multiple of 3 or contains non-finite values.
    #[wasm_bindgen(constructor)]
    pub fn new(positions: Vec<f64>, config: Option<JsFireConfig>) -> Result<JsFireState, JsError> {
        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms).map_err(|err| JsError::new(&err))?;
        let fire_config = config.map(|cfg| cfg.inner).unwrap_or_default();
        let state = optimizers::FireState::new(pos_vec, &fire_config);
        Ok(JsFireState {
            inner: state,
            config: fire_config,
        })
    }

    /// Get positions as flat array.
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f64> {
        self.inner
            .positions
            .iter()
            .flat_map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get maximum force component.
    #[wasm_bindgen]
    pub fn max_force(&self) -> f64 {
        self.inner.max_force()
    }

    /// Check if optimization has converged.
    /// Returns false for non-positive f_max thresholds.
    #[wasm_bindgen]
    pub fn is_converged(&self, f_max: f64) -> bool {
        if !f_max.is_finite() || f_max <= 0.0 {
            return false;
        }
        self.inner.is_converged(f_max)
    }

    /// Number of atoms.
    #[wasm_bindgen(getter)]
    pub fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }

    /// Current timestep.
    #[wasm_bindgen(getter)]
    pub fn dt(&self) -> f64 {
        self.inner.dt
    }
}

/// Perform one FIRE optimization step with provided forces.
#[wasm_bindgen]
pub fn fire_step_with_forces(state: &mut JsFireState, forces: Vec<f64>) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.num_atoms();
        let force_vec = parse_flat_vec3(&forces, n_atoms)?;
        state
            .inner
            .step(|_positions| force_vec.clone(), &state.config);
        Ok(())
    })();
    result.into()
}

/// FIRE optimizer state with cell optimization.
#[wasm_bindgen]
pub struct JsCellFireState {
    inner: optimizers::CellFireState,
    config: optimizers::FireConfig,
}

#[wasm_bindgen]
impl JsCellFireState {
    /// Create a new CellFIRE state.
    ///
    /// positions: flat array [x0, y0, z0, ...] in Angstrom
    /// cell: 9-element cell matrix (row-major)
    /// config: optional FIRE configuration
    /// cell_factor: scaling factor for cell DOF (default: 1.0, must be positive)
    ///
    /// Returns an error if positions/cell contain non-finite values or cell_factor is invalid.
    #[wasm_bindgen(constructor)]
    pub fn new(
        positions: Vec<f64>,
        cell: Vec<f64>,
        config: Option<JsFireConfig>,
        cell_factor: Option<f64>,
    ) -> Result<JsCellFireState, JsError> {
        let n_atoms = positions.len() / 3;
        let pos_vec = parse_flat_vec3(&positions, n_atoms).map_err(|err| JsError::new(&err))?;
        let cell_mat = parse_flat_cell(Some(&cell))
            .map_err(|err| JsError::new(&err))?
            .unwrap();
        let factor = cell_factor.unwrap_or(1.0);
        validate_positive_f64(factor, "cell_factor").map_err(|err| JsError::new(&err))?;
        let fire_config = config.map(|cfg| cfg.inner).unwrap_or_default();
        Ok(JsCellFireState {
            inner: optimizers::CellFireState::new(pos_vec, cell_mat, &fire_config, factor),
            config: fire_config,
        })
    }

    /// Get positions as flat array.
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f64> {
        self.inner
            .positions
            .iter()
            .flat_map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get cell matrix as flat array.
    #[wasm_bindgen(getter)]
    pub fn cell(&self) -> Vec<f64> {
        let c = &self.inner.cell;
        vec![
            c[(0, 0)],
            c[(0, 1)],
            c[(0, 2)],
            c[(1, 0)],
            c[(1, 1)],
            c[(1, 2)],
            c[(2, 0)],
            c[(2, 1)],
            c[(2, 2)],
        ]
    }

    /// Get maximum force component.
    #[wasm_bindgen]
    pub fn max_force(&self) -> f64 {
        optimizers::cell_max_force(&self.inner)
    }

    /// Get maximum stress component.
    #[wasm_bindgen]
    pub fn max_stress(&self) -> f64 {
        optimizers::cell_max_stress(&self.inner)
    }

    /// Check if optimization has converged.
    ///
    /// f_max: force convergence threshold (must be finite and positive)
    /// s_max: stress convergence threshold (must be finite and positive)
    #[wasm_bindgen]
    pub fn is_converged(&self, f_max: f64, s_max: f64) -> Result<bool, JsError> {
        if !f_max.is_finite() || f_max <= 0.0 {
            return Err(JsError::new("f_max must be finite and positive"));
        }
        if !s_max.is_finite() || s_max <= 0.0 {
            return Err(JsError::new("s_max must be finite and positive"));
        }
        Ok(optimizers::cell_is_converged(&self.inner, f_max, s_max))
    }

    /// Number of atoms.
    #[wasm_bindgen(getter)]
    pub fn num_atoms(&self) -> usize {
        self.inner.positions.len()
    }
}

/// Perform one CellFIRE optimization step with provided forces and stress.
#[wasm_bindgen]
pub fn cell_fire_step_with_forces_and_stress(
    state: &mut JsCellFireState,
    forces: Vec<f64>,
    stress: Vec<f64>,
) -> WasmResult<()> {
    let result: Result<(), String> = (|| {
        let n_atoms = state.inner.positions.len();
        let force_vec = parse_flat_vec3(&forces, n_atoms)?;
        let stress_mat = parse_flat_cell(Some(&stress))?.unwrap();
        state
            .inner
            .step(|_, _| (force_vec.clone(), stress_mat), &state.config);
        Ok(())
    })();
    result.into()
}
