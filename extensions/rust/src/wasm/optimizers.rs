//! FIRE and CellFIRE optimizer WASM bindings.

use nalgebra::Vector3;
use wasm_bindgen::prelude::*;

use crate::optimizers;
use crate::wasm_types::WasmResult;

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
    /// Returns an error if positions length is not a multiple of 3.
    #[wasm_bindgen(constructor)]
    pub fn new(positions: Vec<f64>, config: Option<JsFireConfig>) -> Result<JsFireState, JsError> {
        if positions.len() % 3 != 0 {
            return Err(JsError::new(&format!(
                "positions length {} must be a multiple of 3",
                positions.len()
            )));
        }
        let pos_vec: Vec<Vector3<f64>> = positions
            .chunks_exact(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        let fire_config = config.map(|c| c.inner).unwrap_or_default();
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
    #[wasm_bindgen]
    pub fn is_converged(&self, fmax: f64) -> bool {
        self.inner.is_converged(fmax)
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
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }

        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();

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
    /// cell_factor: scaling factor for cell DOF (default: 1.0)
    ///
    /// Returns an error if positions length is not a multiple of 3 or cell is not 9 elements.
    #[wasm_bindgen(constructor)]
    pub fn new(
        positions: Vec<f64>,
        cell: Vec<f64>,
        config: Option<JsFireConfig>,
        cell_factor: Option<f64>,
    ) -> Result<JsCellFireState, JsError> {
        if positions.len() % 3 != 0 {
            return Err(JsError::new(&format!(
                "positions length {} must be a multiple of 3",
                positions.len()
            )));
        }
        if cell.len() != 9 {
            return Err(JsError::new("cell must have 9 elements"));
        }

        let pos_vec: Vec<Vector3<f64>> = positions
            .chunks_exact(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        let cell_mat = nalgebra::Matrix3::new(
            cell[0], cell[1], cell[2], cell[3], cell[4], cell[5], cell[6], cell[7], cell[8],
        );
        let fire_config = config.map(|c| c.inner).unwrap_or_default();
        let factor = cell_factor.unwrap_or(1.0);

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
    /// fmax: force convergence threshold (must be positive)
    /// smax: stress convergence threshold (must be positive)
    #[wasm_bindgen]
    pub fn is_converged(&self, fmax: f64, smax: f64) -> Result<bool, JsError> {
        if fmax <= 0.0 {
            return Err(JsError::new("fmax must be positive"));
        }
        if smax <= 0.0 {
            return Err(JsError::new("smax must be positive"));
        }
        Ok(optimizers::cell_is_converged(&self.inner, fmax, smax))
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
        if forces.len() != n_atoms * 3 {
            return Err(format!(
                "forces length {} must be {} (3 * n_atoms)",
                forces.len(),
                n_atoms * 3
            ));
        }
        if stress.len() != 9 {
            return Err("stress must have 9 elements".to_string());
        }

        let force_vec: Vec<Vector3<f64>> = forces
            .chunks(3)
            .map(|c| Vector3::new(c[0], c[1], c[2]))
            .collect();
        let stress_mat = nalgebra::Matrix3::new(
            stress[0], stress[1], stress[2], stress[3], stress[4], stress[5], stress[6], stress[7],
            stress[8],
        );

        state
            .inner
            .step(|_, _| (force_vec.clone(), stress_mat), &state.config);
        Ok(())
    })();
    result.into()
}
