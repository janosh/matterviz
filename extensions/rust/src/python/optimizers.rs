//! FIRE and CellFIRE optimizer Python bindings.

use nalgebra::{Matrix3, Vector3};
use pyo3::prelude::*;

use crate::optimizers;

use super::helpers::mat3_to_array;

/// FIRE optimizer configuration.
#[pyclass(name = "FireConfig")]
#[derive(Clone)]
pub struct PyFireConfig {
    pub(crate) inner: optimizers::FireConfig,
}

#[pymethods]
impl PyFireConfig {
    /// Create a new FIRE configuration with default parameters.
    #[new]
    #[pyo3(signature = (dt_start=None, dt_max=None, n_min=None, max_step=None))]
    fn new(
        dt_start: Option<f64>,
        dt_max: Option<f64>,
        n_min: Option<usize>,
        max_step: Option<f64>,
    ) -> Self {
        let mut config = optimizers::FireConfig::default();
        if let Some(val) = dt_start {
            config.dt_start = val;
        }
        if let Some(val) = dt_max {
            config.dt_max = val;
        }
        if let Some(val) = n_min {
            config.n_min = val;
        }
        if let Some(val) = max_step {
            config.max_step = val;
        }
        PyFireConfig { inner: config }
    }

    #[getter]
    fn dt_start(&self) -> f64 {
        self.inner.dt_start
    }

    #[setter]
    fn set_dt_start(&mut self, val: f64) {
        self.inner.dt_start = val;
    }

    #[getter]
    fn dt_max(&self) -> f64 {
        self.inner.dt_max
    }

    #[setter]
    fn set_dt_max(&mut self, val: f64) {
        self.inner.dt_max = val;
    }

    #[getter]
    fn n_min(&self) -> usize {
        self.inner.n_min
    }

    #[setter]
    fn set_n_min(&mut self, val: usize) {
        self.inner.n_min = val;
    }

    #[getter]
    fn max_step(&self) -> f64 {
        self.inner.max_step
    }

    #[setter]
    fn set_max_step(&mut self, val: f64) {
        self.inner.max_step = val;
    }
}

/// FIRE optimizer state.
#[pyclass(name = "FireState")]
pub struct PyFireState {
    inner: optimizers::FireState,
    config: optimizers::FireConfig,
}

#[pymethods]
impl PyFireState {
    /// Create a new FIRE state.
    ///
    /// Args:
    ///     positions: List of [x, y, z] positions in Angstrom
    ///     config: Optional FIRE configuration
    #[new]
    #[pyo3(signature = (positions, config=None))]
    fn new(positions: Vec<[f64; 3]>, config: Option<PyFireConfig>) -> PyResult<Self> {
        let pos_vec: Vec<Vector3<f64>> = positions
            .iter()
            .map(|p| Vector3::new(p[0], p[1], p[2]))
            .collect();
        let fire_config = config.map(|c| c.inner).unwrap_or_default();
        let state = optimizers::FireState::new(pos_vec, &fire_config);
        Ok(PyFireState {
            inner: state,
            config: fire_config,
        })
    }

    /// Get positions.
    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        self.inner
            .positions
            .iter()
            .map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get velocities.
    #[getter]
    fn velocities(&self) -> Vec<[f64; 3]> {
        self.inner
            .velocities
            .iter()
            .map(|v| [v.x, v.y, v.z])
            .collect()
    }

    /// Get maximum force component.
    fn max_force(&self) -> f64 {
        self.inner.max_force()
    }

    /// Check if optimization has converged.
    fn is_converged(&self, fmax: f64) -> PyResult<bool> {
        if !fmax.is_finite() || fmax <= 0.0 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "fmax must be positive and finite",
            ));
        }
        Ok(self.inner.is_converged(fmax))
    }

    /// Number of atoms.
    #[getter]
    fn num_atoms(&self) -> usize {
        self.inner.num_atoms()
    }

    /// Current timestep.
    #[getter]
    fn dt(&self) -> f64 {
        self.inner.dt
    }

    /// Perform one FIRE step with provided forces.
    fn step(&mut self, forces: Vec<[f64; 3]>) -> PyResult<()> {
        let n_atoms = self.inner.num_atoms();
        if forces.len() != n_atoms {
            return Err(pyo3::exceptions::PyValueError::new_err(format!(
                "forces length {} must be {} (n_atoms)",
                forces.len(),
                n_atoms
            )));
        }
        let force_vec: Vec<Vector3<f64>> = forces
            .iter()
            .map(|f| Vector3::new(f[0], f[1], f[2]))
            .collect();
        self.inner
            .step(|_positions| force_vec.clone(), &self.config);
        Ok(())
    }
}

/// CellFIRE optimizer state (optimizes both positions and cell).
#[pyclass(name = "CellFireState")]
pub struct PyCellFireState {
    inner: optimizers::CellFireState,
    config: optimizers::FireConfig,
}

#[pymethods]
impl PyCellFireState {
    /// Create a new CellFIRE state.
    ///
    /// Args:
    ///     positions: List of [x, y, z] positions in Angstrom
    ///     cell: 3x3 cell matrix (row vectors)
    ///     config: Optional FIRE configuration
    ///     cell_factor: Scaling factor for cell DOF (default: 1.0)
    #[new]
    #[pyo3(signature = (positions, cell, config=None, cell_factor=1.0))]
    fn new(
        positions: Vec<[f64; 3]>,
        cell: [[f64; 3]; 3],
        config: Option<PyFireConfig>,
        cell_factor: f64,
    ) -> PyResult<Self> {
        let pos_vec: Vec<Vector3<f64>> = positions
            .iter()
            .map(|p| Vector3::new(p[0], p[1], p[2]))
            .collect();
        let cell_mat = Matrix3::new(
            cell[0][0], cell[0][1], cell[0][2], cell[1][0], cell[1][1], cell[1][2], cell[2][0],
            cell[2][1], cell[2][2],
        );
        let fire_config = config.map(|c| c.inner).unwrap_or_default();
        Ok(PyCellFireState {
            inner: optimizers::CellFireState::new(pos_vec, cell_mat, &fire_config, cell_factor),
            config: fire_config,
        })
    }

    /// Get positions.
    #[getter]
    fn positions(&self) -> Vec<[f64; 3]> {
        self.inner
            .positions
            .iter()
            .map(|p| [p.x, p.y, p.z])
            .collect()
    }

    /// Get cell matrix.
    #[getter]
    fn cell(&self) -> [[f64; 3]; 3] {
        mat3_to_array(&self.inner.cell)
    }

    /// Get maximum force component.
    fn max_force(&self) -> f64 {
        optimizers::cell_max_force(&self.inner)
    }

    /// Get maximum stress component.
    fn max_stress(&self) -> f64 {
        optimizers::cell_max_stress(&self.inner)
    }

    /// Check if optimization has converged.
    fn is_converged(&self, fmax: f64, smax: f64) -> PyResult<bool> {
        if !fmax.is_finite() || fmax <= 0.0 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "fmax must be positive and finite",
            ));
        }
        if !smax.is_finite() || smax <= 0.0 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "smax must be positive and finite",
            ));
        }
        Ok(optimizers::cell_is_converged(&self.inner, fmax, smax))
    }

    /// Number of atoms.
    #[getter]
    fn num_atoms(&self) -> usize {
        self.inner.positions.len()
    }

    /// Perform one CellFIRE step with provided forces and stress.
    fn step(&mut self, forces: Vec<[f64; 3]>, stress: [[f64; 3]; 3]) -> PyResult<()> {
        let n_atoms = self.inner.positions.len();
        if forces.len() != n_atoms {
            return Err(pyo3::exceptions::PyValueError::new_err(format!(
                "forces length {} must be {} (n_atoms)",
                forces.len(),
                n_atoms
            )));
        }
        let force_vec: Vec<Vector3<f64>> = forces
            .iter()
            .map(|f| Vector3::new(f[0], f[1], f[2]))
            .collect();
        let stress_mat = Matrix3::new(
            stress[0][0],
            stress[0][1],
            stress[0][2],
            stress[1][0],
            stress[1][1],
            stress[1][2],
            stress[2][0],
            stress[2][1],
            stress[2][2],
        );
        self.inner
            .step(|_, _| (force_vec.clone(), stress_mat), &self.config);
        Ok(())
    }
}

/// Register the optimizers submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "optimizers")?;
    submod.add_class::<PyFireConfig>()?;
    submod.add_class::<PyFireState>()?;
    submod.add_class::<PyCellFireState>()?;
    parent.add_submodule(&submod)?;
    Ok(())
}
