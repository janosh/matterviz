//! StructureMatcher WASM bindings.

use wasm_bindgen::prelude::*;

use crate::structure_matcher::{ComparatorType, StructureMatcher};
use crate::wasm_types::{JsCrystal, JsRmsDistResult, WasmResult};

#[wasm_bindgen]
pub struct WasmStructureMatcher {
    inner: StructureMatcher,
}

#[wasm_bindgen]
impl WasmStructureMatcher {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmStructureMatcher {
        WasmStructureMatcher {
            inner: StructureMatcher::new(),
        }
    }

    #[wasm_bindgen]
    pub fn with_latt_len_tol(mut self, tol: f64) -> WasmStructureMatcher {
        self.inner = self.inner.with_latt_len_tol(tol);
        self
    }

    #[wasm_bindgen]
    pub fn with_site_pos_tol(mut self, tol: f64) -> WasmStructureMatcher {
        self.inner = self.inner.with_site_pos_tol(tol);
        self
    }

    #[wasm_bindgen]
    pub fn with_angle_tol(mut self, tol: f64) -> WasmStructureMatcher {
        self.inner = self.inner.with_angle_tol(tol);
        self
    }

    #[wasm_bindgen]
    pub fn with_primitive_cell(mut self, val: bool) -> WasmStructureMatcher {
        self.inner = self.inner.with_primitive_cell(val);
        self
    }

    #[wasm_bindgen]
    pub fn with_scale(mut self, val: bool) -> WasmStructureMatcher {
        self.inner = self.inner.with_scale(val);
        self
    }

    #[wasm_bindgen]
    pub fn with_element_comparator(mut self, val: bool) -> WasmStructureMatcher {
        let comparator = if val {
            ComparatorType::Element
        } else {
            ComparatorType::Species
        };
        self.inner = self.inner.with_comparator(comparator);
        self
    }

    #[wasm_bindgen]
    pub fn fit(&self, struct1: JsCrystal, struct2: JsCrystal) -> WasmResult<bool> {
        let result: Result<bool, String> = (|| {
            let s1 = struct1.to_structure()?;
            let s2 = struct2.to_structure()?;
            Ok(self.inner.fit(&s1, &s2))
        })();
        result.into()
    }

    #[wasm_bindgen]
    pub fn fit_anonymous(&self, struct1: JsCrystal, struct2: JsCrystal) -> WasmResult<bool> {
        let result: Result<bool, String> = (|| {
            let s1 = struct1.to_structure()?;
            let s2 = struct2.to_structure()?;
            Ok(self.inner.fit_anonymous(&s1, &s2))
        })();
        result.into()
    }

    #[wasm_bindgen]
    pub fn get_rms_dist(
        &self,
        struct1: JsCrystal,
        struct2: JsCrystal,
    ) -> WasmResult<Option<JsRmsDistResult>> {
        let result: Result<Option<JsRmsDistResult>, String> = (|| {
            let s1 = struct1.to_structure()?;
            let s2 = struct2.to_structure()?;
            Ok(self
                .inner
                .get_rms_dist(&s1, &s2)
                .map(|(rms, max_dist)| JsRmsDistResult { rms, max_dist }))
        })();
        result.into()
    }

    #[wasm_bindgen(js_name = "get_structure_distance")]
    pub fn get_structure_distance(
        &self,
        struct1: JsCrystal,
        struct2: JsCrystal,
    ) -> WasmResult<f64> {
        let result: Result<f64, String> = (|| {
            let s1 = struct1.to_structure()?;
            let s2 = struct2.to_structure()?;
            let dist = self.inner.get_structure_distance(&s1, &s2);
            Ok(if dist.is_finite() { dist } else { 1e9 })
        })();
        result.into()
    }

    #[wasm_bindgen]
    pub fn deduplicate(&self, structures: Vec<JsCrystal>) -> WasmResult<Vec<u32>> {
        let result: Result<Vec<u32>, String> = (|| {
            let structs: Vec<_> = structures
                .into_iter()
                .map(|js| js.to_structure())
                .collect::<Result<Vec<_>, _>>()?;
            let indices = self
                .inner
                .deduplicate(&structs)
                .map_err(|err| err.to_string())?;
            Ok(indices.into_iter().map(|idx| idx as u32).collect())
        })();
        result.into()
    }

    #[wasm_bindgen]
    pub fn find_matches(
        &self,
        new_structures: Vec<JsCrystal>,
        existing_structures: Vec<JsCrystal>,
    ) -> WasmResult<Vec<Option<u32>>> {
        let result: Result<Vec<Option<u32>>, String> = (|| {
            let new_structs: Vec<_> = new_structures
                .into_iter()
                .map(|js| js.to_structure())
                .collect::<Result<Vec<_>, _>>()?;
            let existing_structs: Vec<_> = existing_structures
                .into_iter()
                .map(|js| js.to_structure())
                .collect::<Result<Vec<_>, _>>()?;
            let matches = self
                .inner
                .find_matches(&new_structs, &existing_structs)
                .map_err(|err| err.to_string())?;
            Ok(matches
                .into_iter()
                .map(|opt| opt.map(|idx| idx as u32))
                .collect())
        })();
        result.into()
    }
}

impl Default for WasmStructureMatcher {
    fn default() -> Self {
        Self::new()
    }
}
