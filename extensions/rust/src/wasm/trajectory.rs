//! Trajectory analysis WASM bindings (MSD, VACF, diffusion).

use wasm_bindgen::prelude::*;

use crate::trajectory::{MsdCalculator, VacfCalculator};
use crate::wasm::parse_flat_vec3;
use crate::wasm_types::WasmResult;

#[wasm_bindgen]
pub struct JsMsdCalculator {
    inner: MsdCalculator,
}

#[wasm_bindgen]
impl JsMsdCalculator {
    #[wasm_bindgen(constructor)]
    pub fn new(
        n_atoms: usize,
        max_lag: usize,
        origin_interval: usize,
    ) -> Result<JsMsdCalculator, JsError> {
        if n_atoms == 0 {
            return Err(JsError::new("n_atoms must be > 0"));
        }
        if origin_interval == 0 {
            return Err(JsError::new("origin_interval must be > 0"));
        }
        Ok(JsMsdCalculator {
            inner: MsdCalculator::new(n_atoms, max_lag, origin_interval),
        })
    }

    #[wasm_bindgen]
    pub fn add_frame(&mut self, positions: Vec<f64>) -> WasmResult<()> {
        match parse_flat_vec3(&positions, self.inner.n_atoms()) {
            Ok(pos_vec) => {
                self.inner.add_frame(&pos_vec);
                WasmResult::ok(())
            }
            Err(err) => WasmResult::err(err),
        }
    }

    #[wasm_bindgen]
    pub fn compute_msd(&self) -> Vec<f64> {
        self.inner.compute_msd()
    }

    #[wasm_bindgen]
    pub fn compute_msd_per_atom(&self) -> Vec<f64> {
        self.inner
            .compute_msd_per_atom()
            .into_iter()
            .flatten()
            .collect()
    }

    #[wasm_bindgen]
    pub fn n_atoms(&self) -> usize {
        self.inner.n_atoms()
    }

    #[wasm_bindgen]
    pub fn max_lag(&self) -> usize {
        self.inner.max_lag()
    }
}

#[wasm_bindgen]
pub struct JsVacfCalculator {
    inner: VacfCalculator,
}

#[wasm_bindgen]
impl JsVacfCalculator {
    #[wasm_bindgen(constructor)]
    pub fn new(
        n_atoms: usize,
        max_lag: usize,
        origin_interval: usize,
    ) -> Result<JsVacfCalculator, JsError> {
        if n_atoms == 0 {
            return Err(JsError::new("n_atoms must be > 0"));
        }
        if origin_interval == 0 {
            return Err(JsError::new("origin_interval must be > 0"));
        }
        Ok(JsVacfCalculator {
            inner: VacfCalculator::new(n_atoms, max_lag, origin_interval),
        })
    }

    #[wasm_bindgen]
    pub fn add_frame(&mut self, velocities: Vec<f64>) -> WasmResult<()> {
        match parse_flat_vec3(&velocities, self.inner.n_atoms()) {
            Ok(vel_vec) => {
                self.inner.add_frame(&vel_vec);
                WasmResult::ok(())
            }
            Err(err) => WasmResult::err(err),
        }
    }

    #[wasm_bindgen]
    pub fn compute_vacf(&self) -> Vec<f64> {
        self.inner.compute_vacf()
    }

    #[wasm_bindgen]
    pub fn compute_normalized_vacf(&self) -> Vec<f64> {
        self.inner.compute_normalized_vacf()
    }

    #[wasm_bindgen]
    pub fn n_atoms(&self) -> usize {
        self.inner.n_atoms()
    }

    #[wasm_bindgen]
    pub fn max_lag(&self) -> usize {
        self.inner.max_lag()
    }
}

#[wasm_bindgen]
pub fn diffusion_from_msd(
    msd: Vec<f64>,
    times: Vec<f64>,
    dim: usize,
    start_fraction: f64,
    end_fraction: f64,
) -> WasmResult<Vec<f64>> {
    if msd.len() != times.len() {
        return WasmResult::err("MSD and times must have same length");
    }
    if dim == 0 {
        return WasmResult::err("dim must be > 0");
    }
    if !(0.0..=1.0).contains(&start_fraction) || !(0.0..=1.0).contains(&end_fraction) {
        return WasmResult::err("start_fraction and end_fraction must be in [0, 1]");
    }
    if start_fraction >= end_fraction {
        return WasmResult::err("start_fraction must be < end_fraction");
    }
    let (diff, r2) = crate::trajectory::diffusion_coefficient_from_msd(
        &msd,
        &times,
        dim,
        start_fraction,
        end_fraction,
    );
    WasmResult::ok(vec![diff, r2])
}

#[wasm_bindgen]
pub fn diffusion_from_vacf(vacf: Vec<f64>, dt: f64, dim: usize) -> WasmResult<f64> {
    if dim == 0 {
        return WasmResult::err("dim must be > 0");
    }
    if dt <= 0.0 {
        return WasmResult::err("dt must be positive");
    }
    WasmResult::ok(crate::trajectory::diffusion_coefficient_from_vacf(
        &vacf, dt, dim,
    ))
}
