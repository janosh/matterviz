//! StructureMatcher WASM bindings.

use std::collections::HashMap;

use serde_wasm_bindgen::from_value;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::*;

use crate::element::Element;
use crate::structure_matcher::{
    AnonymousClassMapping, AnonymousMatchMode, ComparatorType, StructureMatcher,
};
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
    pub fn fit_anonymous(
        &self,
        struct1: JsCrystal,
        struct2: JsCrystal,
        mapping_name: Option<String>,
        mapping: Option<JsValue>,
    ) -> WasmResult<bool> {
        let result: Result<bool, String> = (|| {
            let s1 = struct1.to_structure()?;
            let s2 = struct2.to_structure()?;
            if mapping_name.is_some() && mapping.is_some() {
                return Err("Provide only one of mapping_name or mapping".to_string());
            }
            if let Some(predefined_mapping_name) = mapping_name {
                let mapping_kind = AnonymousClassMapping::from_name(&predefined_mapping_name)
                    .ok_or_else(|| {
                        format!(
                            "Invalid mapping_name: {predefined_mapping_name}. Use one of: ACX, CEA, Metal/Non-metal"
                        )
                    })?;
                Ok(self.inner.fit_anonymous(
                    &s1,
                    &s2,
                    Some(AnonymousMatchMode::Predefined(mapping_kind)),
                ))
            } else if let Some(custom_mapping_value) = mapping {
                let mapping_by_symbol: HashMap<String, String> =
                    from_value(custom_mapping_value)
                        .map_err(|err| format!("Failed to parse mapping object: {err}"))?;
                let class_mapping = parse_class_mapping_by_symbol(mapping_by_symbol)?;
                Ok(self.inner.fit_anonymous(
                    &s1,
                    &s2,
                    Some(AnonymousMatchMode::Custom(&class_mapping)),
                ))
            } else {
                Ok(self.inner.fit_anonymous(&s1, &s2, None))
            }
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

    #[wasm_bindgen(js_name = "get_structure_distance_anonymous_mapped")]
    pub fn get_structure_distance_anonymous_mapped(
        &self,
        struct1: JsCrystal,
        struct2: JsCrystal,
        mapping: JsValue,
    ) -> WasmResult<Option<f64>> {
        let result: Result<Option<f64>, String> = (|| {
            let s1 = struct1.to_structure()?;
            let s2 = struct2.to_structure()?;
            let mapping_by_symbol: HashMap<String, String> = from_value(mapping)
                .map_err(|err| format!("Failed to parse mapping object: {err}"))?;
            let class_mapping = parse_class_mapping_by_symbol(mapping_by_symbol)?;
            Ok(self
                .inner
                .get_structure_distance_anonymous_mapped(&s1, &s2, &class_mapping))
        })();
        result.into()
    }

    #[wasm_bindgen(js_name = "get_structure_distance_anonymous_predefined")]
    pub fn get_structure_distance_anonymous_predefined(
        &self,
        struct1: JsCrystal,
        struct2: JsCrystal,
        mapping_name: String,
    ) -> WasmResult<Option<f64>> {
        let result: Result<Option<f64>, String> = (|| {
            let s1 = struct1.to_structure()?;
            let s2 = struct2.to_structure()?;
            let mapping_kind = AnonymousClassMapping::from_name(&mapping_name).ok_or_else(|| {
                format!(
                    "Invalid mapping_name: {mapping_name}. Use one of: ACX, CEA, Metal/Non-metal"
                )
            })?;
            Ok(self
                .inner
                .get_structure_distance_anonymous_predefined(&s1, &s2, mapping_kind))
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

fn parse_class_mapping_by_symbol(
    mapping_by_symbol: HashMap<String, String>,
) -> Result<HashMap<Element, String>, String> {
    let mut class_mapping = HashMap::new();
    for (element_symbol, class_label) in mapping_by_symbol {
        let trimmed_class_label = class_label.trim();
        if trimmed_class_label.is_empty() {
            return Err(format!(
                "Class label cannot be empty for element '{element_symbol}'"
            ));
        }
        let element = Element::from_symbol(&element_symbol)
            .ok_or_else(|| format!("Invalid element symbol in mapping: '{element_symbol}'"))?;
        class_mapping.insert(element, trimmed_class_label.to_string());
    }
    Ok(class_mapping)
}
