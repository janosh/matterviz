//! XRD WASM bindings.

use wasm_bindgen::prelude::*;

use crate::wasm_types::{JsCrystal, JsHklInfo, JsXrdOptions, JsXrdPattern, WasmResult};

#[wasm_bindgen]
pub fn compute_xrd(
    structure: JsCrystal,
    options: Option<JsXrdOptions>,
) -> WasmResult<JsXrdPattern> {
    use crate::xrd::{XrdConfig, compute_xrd as xrd_compute};

    let result: Result<JsXrdPattern, String> = (|| {
        let struc = structure.to_structure()?;
        let opts = options.unwrap_or_default();

        if opts.wavelength <= 0.0 {
            return Err("wavelength must be positive".to_string());
        }

        let two_theta_range = opts
            .two_theta_range
            .map(|[min, max]| {
                if min < 0.0 || max > 180.0 || min >= max {
                    Err("two_theta_range must be [min, max] with 0 <= min < max <= 180".to_string())
                } else {
                    Ok((min, max))
                }
            })
            .transpose()?;

        let config = XrdConfig {
            wavelength: opts.wavelength,
            two_theta_range,
            debye_waller_factors: opts.debye_waller_factors,
            scaled: opts.scaled,
            ..Default::default()
        };

        let pattern = xrd_compute(&struc, &config);

        let hkls: Vec<Vec<JsHklInfo>> = pattern
            .hkls
            .into_iter()
            .map(|families| {
                families
                    .into_iter()
                    .map(|info| JsHklInfo {
                        hkl: info.hkl,
                        multiplicity: info.multiplicity,
                    })
                    .collect()
            })
            .collect();

        Ok(JsXrdPattern {
            two_theta: pattern.two_theta,
            intensities: pattern.intensities,
            hkls,
            d_spacings: pattern.d_spacings,
        })
    })();
    result.into()
}

#[wasm_bindgen]
pub fn get_atomic_scattering_params() -> String {
    crate::xrd::SCATTERING_PARAMS_JSON.to_string()
}
