//! Composition handling.
//!
//! This module provides the `Composition` type for representing chemical compositions
//! with support for reduced formulas, Species (with oxidation states), and fast hashing.

use crate::element::Element;
use crate::error::{FerroxError, Result};
use crate::species::Species;
use indexmap::IndexMap;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::ops::{Add, Div, Mul, Sub};
use std::sync::LazyLock;

/// Tolerance for floating point comparisons.
const AMOUNT_TOLERANCE: f64 = 1e-8;

/// Quantize an amount to an integer for consistent Eq/Hash behavior.
/// Uses AMOUNT_TOLERANCE as the quantization step.
#[inline]
fn quantize_amount(amt: f64) -> i64 {
    (amt / AMOUNT_TOLERANCE).round() as i64
}

/// Helper for serde skip_serializing_if: returns true if value is false.
fn is_false(v: &bool) -> bool {
    !*v
}

/// Regex for parsing element-amount pairs in formulas.
static ELEMENT_AMOUNT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"([A-Z][a-z]*)(\d*\.?\d*)").expect("Invalid ELEMENT_AMOUNT_RE regex")
});

/// Regex for finding parenthesized groups with multipliers.
static PAREN_GROUP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\(([^\(\)]+)\)\s*(\d*\.?\d*)").expect("Invalid PAREN_GROUP_RE regex")
});

/// A chemical composition mapping species to amounts.
///
/// # Examples
///
/// ```
/// use ferrox::composition::Composition;
/// use ferrox::element::Element;
///
/// let comp = Composition::from_elements([(Element::Fe, 2.0), (Element::O, 3.0)]);
/// assert_eq!(comp.reduced_formula(), "Fe2O3");
/// assert_eq!(comp.chemical_system(), "Fe-O");
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Composition {
    /// Species and their amounts (preserved insertion order).
    species: IndexMap<Species, f64>,
    /// Whether to allow negative amounts (default: false).
    #[serde(default, skip_serializing_if = "is_false")]
    allow_negative: bool,
}

impl Composition {
    // =========================================================================
    // Constructors
    // =========================================================================

    /// Create a new composition from species-amount pairs.
    ///
    /// Zero and negative amounts are filtered out (since allow_negative defaults to false).
    pub fn new(species: impl IntoIterator<Item = (Species, f64)>) -> Self {
        let species: IndexMap<Species, f64> = species
            .into_iter()
            .filter(|(_, amt)| *amt > AMOUNT_TOLERANCE)
            .collect();
        Self {
            species,
            allow_negative: false,
        }
    }

    /// Create a new composition from element-amount pairs (no oxidation states).
    ///
    /// This is a convenience constructor that converts Elements to neutral Species.
    pub fn from_elements(elements: impl IntoIterator<Item = (Element, f64)>) -> Self {
        Self::new(
            elements
                .into_iter()
                .map(|(el, amt)| (Species::neutral(el), amt)),
        )
    }

    /// Parse a composition from a formula string.
    ///
    /// Supports:
    /// - Simple formulas: "Fe2O3", "NaCl", "H2O"
    /// - Parentheses: "Ca3(PO4)2", "Mg(OH)2"
    /// - Brackets (converted to parentheses): "[Cu(NH3)4]SO4"
    /// - Metallofullerene syntax (@ stripped): "Y3N@C80"
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::composition::Composition;
    ///
    /// let comp = Composition::from_formula("LiFePO4").unwrap();
    /// assert_eq!(comp.num_atoms(), 7.0);
    ///
    /// let comp2 = Composition::from_formula("Ca3(PO4)2").unwrap();
    /// assert_eq!(comp2.num_atoms(), 13.0);  // 3 + 2 + 8
    /// ```
    pub fn from_formula(formula: &str) -> Result<Self> {
        let formula = formula.trim();
        if formula.is_empty() {
            return Err(FerroxError::ParseError {
                path: "formula".into(),
                reason: "Empty formula string".into(),
            });
        }

        // Preprocess: strip @, convert brackets to parentheses
        let formula = formula
            .replace('@', "")
            .replace('[', "(")
            .replace(']', ")")
            .replace('{', "(")
            .replace('}', ")");

        let species_amounts = parse_formula_recursive(&formula)?;
        Ok(Self::new(species_amounts))
    }

    /// Builder: set whether to allow negative amounts.
    pub fn with_allow_negative(mut self, allow: bool) -> Self {
        self.allow_negative = allow;
        self
    }

    // =========================================================================
    // Basic Accessors
    // =========================================================================

    /// Get the amount of a species in this composition.
    ///
    /// Returns 0.0 if the species is not present.
    pub fn get(&self, species: impl Into<Species>) -> f64 {
        let sp = species.into();
        self.species.get(&sp).copied().unwrap_or(0.0)
    }

    /// Get the total amount summed across all oxidation states of an element.
    ///
    /// For example, if composition has Fe2+ (2.0) and Fe3+ (1.0), this returns 3.0 for Fe.
    pub fn get_element_total(&self, element: Element) -> f64 {
        self.species
            .iter()
            .filter(|(sp, _)| sp.element == element)
            .map(|(_, amt)| amt)
            .sum()
    }

    /// Get the total number of atoms.
    pub fn num_atoms(&self) -> f64 {
        self.species.values().map(|v| v.abs()).sum()
    }

    /// Get the number of unique species.
    pub fn num_species(&self) -> usize {
        self.species.len()
    }

    /// Get the number of unique elements (ignoring oxidation states).
    pub fn num_elements(&self) -> usize {
        self.unique_elements().len()
    }

    /// Check if composition is empty.
    pub fn is_empty(&self) -> bool {
        self.species.is_empty()
    }

    /// Check if composition represents a single element.
    pub fn is_element(&self) -> bool {
        self.unique_elements().len() == 1
    }

    /// Check if composition is valid (no negative amounts unless allowed).
    pub fn is_valid(&self) -> bool {
        self.allow_negative || self.species.values().all(|&v| v >= -AMOUNT_TOLERANCE)
    }

    /// Get unique elements (ignoring oxidation states).
    pub fn unique_elements(&self) -> HashSet<Element> {
        self.species.keys().map(|sp| sp.element).collect()
    }

    /// Get all species as a vector.
    pub fn species_list(&self) -> Vec<Species> {
        self.species.keys().copied().collect()
    }

    /// Get all elements as a vector (may contain duplicates if multiple oxidation states).
    pub fn elements(&self) -> Vec<Element> {
        self.species.keys().map(|sp| sp.element).collect()
    }

    /// Iterate over (species, amount) pairs.
    pub fn iter(&self) -> impl Iterator<Item = (&Species, &f64)> {
        self.species.iter()
    }

    // =========================================================================
    // Chemical System
    // =========================================================================

    /// Get the chemical system string (e.g., "Fe-O" for Fe2O3).
    ///
    /// Elements are sorted alphabetically and joined by dashes.
    /// This format is commonly used as database keys.
    pub fn chemical_system(&self) -> String {
        let mut symbols: Vec<&str> = self.unique_elements().iter().map(|e| e.symbol()).collect();
        symbols.sort();
        symbols.join("-")
    }

    /// Get the set of element symbols in the composition.
    pub fn chemical_system_set(&self) -> HashSet<String> {
        self.unique_elements()
            .iter()
            .map(|e| e.symbol().to_string())
            .collect()
    }

    // =========================================================================
    // Weight and Fraction Calculations
    // =========================================================================

    /// Get the total molecular weight in atomic mass units.
    pub fn weight(&self) -> f64 {
        self.species
            .iter()
            .map(|(sp, amt)| sp.element.atomic_mass() * amt.abs())
            .sum()
    }

    /// Get the atomic fraction of a species.
    ///
    /// Returns the amount of the species divided by total atoms.
    pub fn get_atomic_fraction(&self, species: impl Into<Species>) -> f64 {
        let total = self.num_atoms();
        if total < AMOUNT_TOLERANCE {
            return 0.0;
        }
        self.get(species).abs() / total
    }

    /// Get the weight fraction of a species.
    ///
    /// Returns the mass contribution of the species divided by total weight.
    pub fn get_wt_fraction(&self, species: impl Into<Species>) -> f64 {
        let total_weight = self.weight();
        if total_weight < AMOUNT_TOLERANCE {
            return 0.0;
        }
        let sp = species.into();
        let el_mass = sp.element.atomic_mass() * self.get(sp).abs();
        el_mass / total_weight
    }

    /// Get the fractional composition (amounts normalized to sum to 1).
    pub fn fractional_composition(&self) -> Self {
        let total = self.num_atoms();
        if total < AMOUNT_TOLERANCE {
            return self.clone();
        }
        self.clone() / total
    }

    /// Get average electronegativity weighted by amount.
    ///
    /// Returns None if any species lacks electronegativity data.
    pub fn average_electroneg(&self) -> Option<f64> {
        if self.is_empty() {
            return None;
        }
        let mut total_en = 0.0;
        let mut total_atoms = 0.0;
        for (sp, amt) in &self.species {
            let en = sp.electronegativity()?; // Return None if any species lacks EN
            total_en += en * amt.abs();
            total_atoms += amt.abs();
        }
        if total_atoms < AMOUNT_TOLERANCE {
            return None;
        }
        Some(total_en / total_atoms)
    }

    /// Get total number of electrons in the composition.
    pub fn total_electrons(&self) -> f64 {
        self.species
            .iter()
            .map(|(sp, amt)| sp.element.atomic_number() as f64 * amt.abs())
            .sum()
    }

    // =========================================================================
    // Formula Representations
    // =========================================================================

    /// Get species sorted by electronegativity (most electropositive first).
    fn sorted_by_electronegativity(&self) -> Vec<(&Species, &f64)> {
        let mut sorted: Vec<_> = self.species.iter().collect();
        sorted.sort_by(|(a, _), (b, _)| {
            let en_a = a.electronegativity().unwrap_or(f64::MAX);
            let en_b = b.electronegativity().unwrap_or(f64::MAX);
            en_a.partial_cmp(&en_b)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.element.symbol().cmp(b.element.symbol()))
        });
        sorted
    }

    /// Get a formula string with elements sorted by electronegativity.
    ///
    /// Most electropositive elements come first (e.g., "Li4 Fe4 P4 O16").
    ///
    /// Note: Oxidation states are ignored. Species are collapsed to element
    /// symbols only. Use `iter()` to access full Species information.
    pub fn formula(&self) -> String {
        if self.is_empty() {
            return String::new();
        }
        // Aggregate by element (collapse oxidation states), then sort
        self.element_composition()
            .sorted_by_electronegativity()
            .iter()
            .map(|(sp, amt)| format_amount(sp.element.symbol(), **amt))
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Get the reduced formula string.
    ///
    /// Amounts are divided by their GCD, producing minimal integer ratios.
    ///
    /// Note: Oxidation states are ignored. Species are collapsed to element
    /// symbols only. Two compositions with identical elements but different
    /// oxidation states (e.g., Fe²⁺O vs Fe³⁺O) produce identical formulas.
    pub fn reduced_formula(&self) -> String {
        if self.is_empty() {
            return String::new();
        }
        // Aggregate by element (collapse oxidation states)
        let elem_comp = self.element_composition();
        let gcd = elem_comp.gcd_of_amounts();
        if gcd < AMOUNT_TOLERANCE {
            return self.formula().replace(' ', "");
        }

        elem_comp
            .sorted_by_electronegativity()
            .iter()
            .map(|(sp, amt)| format_amount(sp.element.symbol(), **amt / gcd))
            .collect::<Vec<_>>()
            .join("")
    }

    /// Get the anonymous formula with elements replaced by A, B, C, etc.
    ///
    /// Elements are sorted by electronegativity (same order as reduced_formula),
    /// then replaced with sequential letters. Useful for structure matching.
    ///
    /// # Example
    /// ```
    /// use ferrox::composition::Composition;
    /// let comp = Composition::from_formula("Fe2O3").unwrap();
    /// assert_eq!(comp.anonymous_formula(), "A2B3");
    /// ```
    pub fn anonymous_formula(&self) -> String {
        if self.is_empty() {
            return String::new();
        }
        let elem_comp = self.element_composition();
        let gcd = elem_comp.gcd_of_amounts();
        if gcd < AMOUNT_TOLERANCE {
            return String::new();
        }

        elem_comp
            .sorted_by_electronegativity()
            .iter()
            .enumerate()
            .map(|(idx, (_, amt))| {
                let letter = (b'A' + idx as u8) as char;
                format_amount(&letter.to_string(), **amt / gcd)
            })
            .collect::<Vec<_>>()
            .join("")
    }

    /// Get the Hill formula.
    ///
    /// Carbon first, then hydrogen, then remaining elements alphabetically.
    /// When there's no carbon, all elements are alphabetically sorted.
    pub fn hill_formula(&self) -> String {
        if self.is_empty() {
            return String::new();
        }

        // Get element composition (collapse oxidation states)
        let elem_comp = self.element_composition();
        let mut entries: Vec<(&str, f64)> = elem_comp
            .species
            .iter()
            .map(|(sp, amt)| (sp.element.symbol(), *amt))
            .collect();

        // Hill order: C first (if present), then H, then alphabetical
        let has_carbon = entries.iter().any(|(sym, _)| *sym == "C");
        entries.sort_by(|(a, _), (b, _)| {
            hill_sort_key(a, has_carbon).cmp(&hill_sort_key(b, has_carbon))
        });

        entries
            .iter()
            .map(|(sym, amt)| format_amount(sym, *amt))
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Get the alphabetical formula.
    ///
    /// Elements sorted alphabetically.
    pub fn alphabetical_formula(&self) -> String {
        let formula = self.formula();
        let mut parts: Vec<_> = formula.split_whitespace().collect();
        parts.sort();
        parts.join(" ")
    }

    // =========================================================================
    // Reduction Methods
    // =========================================================================

    /// Get the reduced composition (amounts divided by GCD).
    pub fn reduced_composition(&self) -> Self {
        let factor = self.get_reduced_factor();
        if factor < AMOUNT_TOLERANCE {
            return self.clone();
        }
        self.clone() / factor
    }

    /// Get the reduction factor (GCD of amounts).
    pub fn get_reduced_factor(&self) -> f64 {
        self.gcd_of_amounts()
    }

    /// Compute GCD of all amounts.
    fn gcd_of_amounts(&self) -> f64 {
        if self.species.is_empty() {
            return 0.0;
        }

        let amounts: Vec<f64> = self.species.values().copied().collect();
        let mut result = amounts[0].abs();

        for &amt in &amounts[1..] {
            result = gcd_float(result, amt.abs());
            if result < AMOUNT_TOLERANCE {
                return 1.0; // Fallback
            }
        }

        result
    }

    /// Get the element composition (collapse oxidation states).
    ///
    /// Species with the same element are merged. Near-zero amounts are filtered out.
    pub fn element_composition(&self) -> Self {
        let mut elem_amounts: IndexMap<Species, f64> = IndexMap::new();
        for (sp, amt) in &self.species {
            let neutral = Species::neutral(sp.element);
            *elem_amounts.entry(neutral).or_insert(0.0) += amt;
        }
        // Filter out near-zero amounts (can occur when oxidation states cancel)
        elem_amounts.retain(|_, amt| amt.abs() >= AMOUNT_TOLERANCE);
        Self {
            species: elem_amounts,
            allow_negative: self.allow_negative,
        }
    }

    // =========================================================================
    // Comparison Methods
    // =========================================================================

    /// Check if two compositions are approximately equal.
    ///
    /// Uses both relative and absolute tolerances.
    pub fn almost_equals(&self, other: &Self, rtol: f64, atol: f64) -> bool {
        let all_species: HashSet<_> = self.species.keys().chain(other.species.keys()).collect();

        for sp in all_species {
            let a = self.get(*sp);
            let b = other.get(*sp);
            let tol = atol + rtol * (a.abs() + b.abs()) / 2.0;
            if (a - b).abs() > tol {
                return false;
            }
        }
        true
    }

    // =========================================================================
    // Element Remapping
    // =========================================================================

    /// Create new composition with elements remapped according to mapping.
    ///
    /// Elements not in the mapping are preserved as-is.
    /// If multiple elements map to the same target, their amounts are summed.
    pub fn remap_elements(&self, mapping: &std::collections::HashMap<Element, Element>) -> Self {
        let mut remapped: IndexMap<Species, f64> = IndexMap::new();
        for (sp, &amt) in &self.species {
            let new_elem = mapping.get(&sp.element).copied().unwrap_or(sp.element);
            let new_sp = Species::new(new_elem, sp.oxidation_state);
            *remapped.entry(new_sp).or_insert(0.0) += amt;
        }
        Self {
            species: remapped,
            allow_negative: self.allow_negative,
        }
    }

    // =========================================================================
    // Checked Arithmetic
    // =========================================================================

    /// Subtract with error checking for negative amounts.
    ///
    /// Returns an error if the result would have negative amounts and
    /// self.allow_negative is false. The result inherits the caller's
    /// allow_negative policy, not the RHS's.
    pub fn sub_checked(&self, other: &Self) -> Result<Self> {
        let mut result = self.clone() - other.clone();
        // Enforce caller's policy, not the merged policy from the - operator
        result.allow_negative = self.allow_negative;
        if !result.is_valid() {
            return Err(FerroxError::CompositionError {
                reason: "Subtraction resulted in negative amounts".into(),
            });
        }
        Ok(result)
    }

    /// Get a hash of the reduced formula (element-only, ignores oxidation states).
    ///
    /// This is useful for grouping compositions by stoichiometry regardless of
    /// oxidation states. Note: This is different from the `Hash` trait which
    /// includes full Species information including oxidation states.
    ///
    /// Two compositions with Fe2O3 stoichiometry will have the same formula_hash
    /// even if one has Fe²⁺/Fe³⁺ and the other has neutral Fe.
    pub fn formula_hash(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.reduced_formula().hash(&mut hasher);
        hasher.finish()
    }

    /// Get a hash that includes full Species information (with oxidation states).
    ///
    /// Unlike `formula_hash()` which ignores oxidation states, this method
    /// produces different hashes for compositions with the same elements but
    /// different oxidation states (e.g., Fe²⁺O vs Fe³⁺O).
    pub fn species_hash(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        // Use the Hash trait implementation which includes oxidation states
        self.reduced_composition().hash(&mut hasher);
        hasher.finish()
    }
}

// =============================================================================
// Operator Implementations
// =============================================================================

impl Composition {
    /// Helper for Add/Sub: merge rhs into self with given sign (+1 or -1).
    fn merge_with(self, rhs: Self, sign: f64) -> Self {
        let mut result = self.species.clone();
        for (sp, amt) in rhs.species {
            *result.entry(sp).or_insert(0.0) += sign * amt;
        }
        Self {
            species: result
                .into_iter()
                .filter(|(_, amt)| amt.abs() > AMOUNT_TOLERANCE)
                .collect(),
            allow_negative: self.allow_negative || rhs.allow_negative,
        }
    }

    /// Helper for Mul/Div: scale all amounts.
    fn scale(self, factor: f64) -> Self {
        Self {
            species: self
                .species
                .into_iter()
                .map(|(sp, amt)| (sp, amt * factor))
                .filter(|(_, amt)| amt.abs() > AMOUNT_TOLERANCE)
                .collect(),
            allow_negative: self.allow_negative,
        }
    }
}

impl Add for Composition {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        self.merge_with(rhs, 1.0)
    }
}

impl Sub for Composition {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        self.merge_with(rhs, -1.0)
    }
}

impl Mul<f64> for Composition {
    type Output = Self;
    fn mul(self, scalar: f64) -> Self {
        self.scale(scalar)
    }
}

impl Div<f64> for Composition {
    type Output = Self;
    /// Divide all species amounts by a scalar.
    ///
    /// # Panics
    /// Panics if `scalar` is zero or near-zero (< AMOUNT_TOLERANCE).
    fn div(self, scalar: f64) -> Self {
        assert!(
            scalar.abs() >= AMOUNT_TOLERANCE,
            "Cannot divide Composition by zero or near-zero value"
        );
        self.scale(1.0 / scalar)
    }
}

impl Mul<Composition> for f64 {
    type Output = Composition;

    fn mul(self, rhs: Composition) -> Composition {
        rhs * self
    }
}

// =============================================================================
// Trait Implementations
// =============================================================================

/// Equality compares actual Species and amounts (with tolerance).
///
/// Two compositions are equal if they have the same Species with the same
/// amounts (using quantized comparison for Eq/Hash consistency).
/// Oxidation states matter: Fe²⁺O ≠ Fe³⁺O.
/// Scaling also matters: Fe2O3 ≠ Fe4O6 (use `reduced_composition()` first if
/// you want to compare reduced forms).
impl PartialEq for Composition {
    fn eq(&self, other: &Self) -> bool {
        // Quick check: same number of species
        if self.species.len() != other.species.len() {
            return false;
        }
        // Compare each species and quantized amount (ensures Eq/Hash consistency)
        for (sp, amt) in &self.species {
            match other.species.get(sp) {
                Some(other_amt) if quantize_amount(*amt) == quantize_amount(*other_amt) => {}
                _ => return false,
            }
        }
        true
    }
}

impl Eq for Composition {}

impl std::hash::Hash for Composition {
    fn hash<H: Hasher>(&self, state: &mut H) {
        // Hash species in a deterministic order (sorted by string representation)
        let mut entries: Vec<_> = self.species.iter().collect();
        entries.sort_by_key(|(sp, _)| sp.to_string());
        for (sp, amt) in entries {
            sp.hash(state);
            // Use same quantization as PartialEq for Eq/Hash contract consistency
            quantize_amount(*amt).hash(state);
        }
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Parse a formula string recursively, expanding parentheses.
fn parse_formula_recursive(formula: &str) -> Result<Vec<(Species, f64)>> {
    let mut formula = formula.to_string();
    let mut parse_error: Option<FerroxError> = None;

    // Recursively expand parentheses from innermost to outermost
    while PAREN_GROUP_RE.is_match(&formula) {
        let new_formula = PAREN_GROUP_RE.replace(&formula, |caps: &regex::Captures| {
            let inner = &caps[1];
            let mult_str = &caps[2];
            let multiplier: f64 = if mult_str.is_empty() {
                1.0
            } else {
                match mult_str.parse() {
                    Ok(v) => v,
                    Err(_) => {
                        parse_error = Some(FerroxError::ParseError {
                            path: "formula".into(),
                            reason: format!("Invalid multiplier '{mult_str}' for group ({inner})"),
                        });
                        1.0 // Dummy value, error will be returned after replace
                    }
                }
            };

            // Parse inner content and multiply amounts
            match parse_flat_formula(inner) {
                Ok(inner_species) => inner_species
                    .iter()
                    .map(|(sp, amt)| format!("{}{}", sp.element.symbol(), amt * multiplier))
                    .collect::<Vec<_>>()
                    .join(""),
                Err(err) => {
                    parse_error = Some(err);
                    inner.to_string()
                }
            }
        });
        formula = new_formula.to_string();

        // Propagate any error from inner parsing
        if let Some(err) = parse_error {
            return Err(err);
        }
    }

    let results = parse_flat_formula(&formula)?;
    if results.is_empty() {
        return Err(FerroxError::ParseError {
            path: "formula".into(),
            reason: "No elements found in formula".into(),
        });
    }
    Ok(results)
}

/// Parse a flat formula (no parentheses) into species-amount pairs.
fn parse_flat_formula(formula: &str) -> Result<Vec<(Species, f64)>> {
    let mut results: IndexMap<Species, f64> = IndexMap::new();

    for cap in ELEMENT_AMOUNT_RE.captures_iter(formula) {
        let symbol = &cap[1];
        let amt_str = &cap[2];
        let amt: f64 = if amt_str.is_empty() {
            1.0
        } else {
            amt_str.parse().map_err(|_| FerroxError::ParseError {
                path: "formula".into(),
                reason: format!("Invalid amount '{amt_str}' for element {symbol}"),
            })?
        };

        let element = Element::from_symbol(symbol).ok_or_else(|| FerroxError::ParseError {
            path: "formula".into(),
            reason: format!("Unknown element symbol: {symbol}"),
        })?;

        *results.entry(Species::neutral(element)).or_insert(0.0) += amt;
    }

    Ok(results.into_iter().collect())
}

/// Hill formula sort key: C=0, H=1 (only if carbon present), rest alphabetical.
fn hill_sort_key(sym: &str, has_carbon: bool) -> (u8, &str) {
    match sym {
        "C" => (0, sym),
        "H" if has_carbon => (1, sym),
        _ => (2, sym),
    }
}

/// Format a symbol-amount pair for display.
fn format_amount(symbol: &str, amt: f64) -> String {
    if (amt - 1.0).abs() < AMOUNT_TOLERANCE {
        symbol.to_string()
    } else if (amt - amt.round()).abs() < AMOUNT_TOLERANCE {
        format!("{}{}", symbol, amt.round() as i64)
    } else {
        format!("{}{:.2}", symbol, amt)
    }
}

/// Compute GCD of two floating point numbers.
fn gcd_float(mut a: f64, mut b: f64) -> f64 {
    const MAX_ITER: usize = 100;

    a = a.abs();
    b = b.abs();

    for _ in 0..MAX_ITER {
        if b < AMOUNT_TOLERANCE {
            return a;
        }
        let temp = b;
        b = a % b;
        a = temp;
    }

    1.0 // Fallback
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // =========================================================================
    // Basic Construction Tests
    // =========================================================================

    #[test]
    fn test_composition_from_elements() {
        let comp = Composition::from_elements([(Element::Fe, 2.0), (Element::O, 3.0)]);

        assert_eq!(comp.get(Element::Fe), 2.0);
        assert_eq!(comp.get(Element::O), 3.0);
        assert_eq!(comp.get(Element::H), 0.0); // missing element returns 0
        assert!((comp.num_atoms() - 5.0).abs() < AMOUNT_TOLERANCE);
        assert_eq!(comp.num_elements(), 2);
        assert!(!comp.is_empty());
    }

    #[test]
    fn test_composition_from_species() {
        let fe2 = Species::new(Element::Fe, Some(2));
        let fe3 = Species::new(Element::Fe, Some(3));
        let o2 = Species::new(Element::O, Some(-2));

        let comp = Composition::new([(fe2, 2.0), (fe3, 1.0), (o2, 4.0)]);

        assert_eq!(comp.get(fe2), 2.0);
        assert_eq!(comp.get(fe3), 1.0);
        assert_eq!(comp.get_element_total(Element::Fe), 3.0);
        assert_eq!(comp.num_species(), 3);
        assert_eq!(comp.num_elements(), 2); // Fe and O
    }

    #[test]
    fn test_constructor_filters_zero_and_negative_amounts() {
        // new() filters zero, negative, and near-zero amounts (allow_negative=false)
        let fe = Species::neutral(Element::Fe);
        let comp = Composition::new([
            (fe, 2.0),                              // positive: kept
            (Species::neutral(Element::O), 0.0),    // zero: filtered
            (Species::neutral(Element::Na), -1.0),  // negative: filtered
            (Species::neutral(Element::Cl), 1e-12), // near-zero: filtered
        ]);
        assert_eq!(comp.num_species(), 1);
        assert_eq!(comp.get(fe), 2.0);
        assert!(comp.is_valid());

        // from_elements() delegates to new(), same behavior
        let comp2 = Composition::from_elements([(Element::Fe, 2.0), (Element::O, -3.0)]);
        assert_eq!(comp2.num_elements(), 1);
    }

    // =========================================================================
    // Formula Parsing Tests
    // =========================================================================

    #[test]
    fn test_from_formula() {
        // Simple formulas: (formula, expected_atoms, chemical_system)
        let simple_cases = [
            ("Fe2O3", 5.0, "Fe-O"),
            ("NaCl", 2.0, "Cl-Na"),
            ("H2O", 3.0, "H-O"),
            ("LiFePO4", 7.0, "Fe-Li-O-P"),
            ("Cu", 1.0, "Cu"),          // single element
            ("  Fe2O3  ", 5.0, "Fe-O"), // whitespace trimmed
            ("H1000", 1000.0, "H"),     // large multiplier
        ];
        for (formula, expected_atoms, expected_system) in simple_cases {
            let comp = Composition::from_formula(formula).unwrap();
            assert!(
                (comp.num_atoms() - expected_atoms).abs() < AMOUNT_TOLERANCE,
                "{formula}: expected {expected_atoms} atoms, got {}",
                comp.num_atoms()
            );
            assert_eq!(comp.chemical_system(), expected_system, "{formula}");
        }

        // Parentheses/brackets: (formula, element_amounts)
        let paren_cases: &[(&str, &[(Element, f64)])] = &[
            (
                "Ca3(PO4)2",
                &[(Element::Ca, 3.0), (Element::P, 2.0), (Element::O, 8.0)],
            ),
            (
                "Mg(OH)2",
                &[(Element::Mg, 1.0), (Element::O, 2.0), (Element::H, 2.0)],
            ),
            (
                "Al2(SO4)3",
                &[(Element::Al, 2.0), (Element::S, 3.0), (Element::O, 12.0)],
            ),
            (
                "[Cu(NH3)4]SO4",
                &[
                    (Element::Cu, 1.0),
                    (Element::N, 4.0),
                    (Element::H, 12.0),
                    (Element::S, 1.0),
                    (Element::O, 4.0),
                ],
            ),
        ];
        for (formula, expected) in paren_cases {
            let comp = Composition::from_formula(formula).unwrap();
            for (elem, amt) in *expected {
                assert_eq!(comp.get(*elem), *amt, "{formula}: {elem:?}");
            }
        }

        // Error cases
        assert!(Composition::from_formula("").is_err(), "empty formula");
        assert!(
            Composition::from_formula("XxYy2").is_err(),
            "unknown element"
        );
        assert!(
            Composition::from_formula("(OH).").is_err(),
            "invalid multiplier '.'"
        );
        // Note: "(PO4)abc" parses as PO4 - trailing lowercase is silently ignored.
        // This matches pymatgen behavior where regex-based parsing skips non-matching text.
    }

    // =========================================================================
    // Reduced Formula Tests
    // =========================================================================

    #[test]
    fn test_reduced_formula() {
        // (elements, expected_reduced_formula)
        let cases: &[(&[(Element, f64)], &str)] = &[
            (&[(Element::Fe, 2.0), (Element::O, 3.0)], "Fe2O3"),
            (&[(Element::Na, 1.0), (Element::Cl, 1.0)], "NaCl"),
            (&[(Element::H, 2.0), (Element::O, 1.0)], "H2O"),
            (&[(Element::H, 4.0), (Element::O, 2.0)], "H2O"), // reduction
            (&[(Element::Fe, 4.0), (Element::O, 6.0)], "Fe2O3"), // reduction
            (&[(Element::Cu, 1.0)], "Cu"),                    // single
            (&[(Element::Cu, 4.0)], "Cu"),                    // single, any amount
            (&[(Element::Fe, 0.5), (Element::O, 0.75)], "Fe2O3"), // fractional
        ];
        for (elements, expected) in cases {
            let comp = Composition::from_elements(elements.iter().copied());
            assert_eq!(comp.reduced_formula(), *expected, "{:?}", elements);
        }
    }

    // =========================================================================
    // Weight and Fraction Tests
    // =========================================================================

    #[test]
    fn test_weight() {
        let comp = Composition::from_elements([(Element::H, 2.0), (Element::O, 1.0)]);
        // H2O: 2*1.008 + 1*15.999 ≈ 18.015
        let weight = comp.weight();
        assert!((weight - 18.015).abs() < 0.1, "H2O weight: {weight}");
    }

    #[test]
    fn test_atomic_fraction() {
        let comp = Composition::from_elements([(Element::H, 2.0), (Element::O, 1.0)]);
        let h_frac = comp.get_atomic_fraction(Element::H);
        let o_frac = comp.get_atomic_fraction(Element::O);

        assert!((h_frac - 2.0 / 3.0).abs() < AMOUNT_TOLERANCE);
        assert!((o_frac - 1.0 / 3.0).abs() < AMOUNT_TOLERANCE);
    }

    #[test]
    fn test_wt_fraction() {
        let comp = Composition::from_elements([(Element::H, 2.0), (Element::O, 1.0)]);
        let o_wt_frac = comp.get_wt_fraction(Element::O);
        // O contributes ~88.8% of H2O by mass
        assert!(
            (o_wt_frac - 0.888).abs() < 0.01,
            "O wt fraction: {o_wt_frac}"
        );
    }

    #[test]
    fn test_fractional_composition() {
        let comp = Composition::from_elements([(Element::Fe, 2.0), (Element::O, 3.0)]);
        let frac = comp.fractional_composition();

        assert!((frac.num_atoms() - 1.0).abs() < AMOUNT_TOLERANCE);
        assert!((frac.get(Element::Fe) - 0.4).abs() < AMOUNT_TOLERANCE);
        assert!((frac.get(Element::O) - 0.6).abs() < AMOUNT_TOLERANCE);
    }

    // =========================================================================
    // Arithmetic Tests
    // =========================================================================

    #[test]
    fn test_arithmetic_operations() {
        let fe2o3 = Composition::from_elements([(Element::Fe, 2.0), (Element::O, 3.0)]);
        let feo = Composition::from_elements([(Element::Fe, 1.0), (Element::O, 1.0)]);
        let h2o = Composition::from_elements([(Element::H, 2.0), (Element::O, 1.0)]);

        // Add
        let sum = fe2o3.clone() + feo.clone();
        assert_eq!(sum.get(Element::Fe), 3.0);
        assert_eq!(sum.get(Element::O), 4.0);
        assert_eq!(sum.reduced_formula(), "Fe3O4");

        // Sub
        let diff = sum.clone() - feo;
        assert_eq!(diff.get(Element::Fe), 2.0);
        assert_eq!(diff.get(Element::O), 3.0);

        // Mul (both directions)
        let scaled = h2o.clone() * 3.0;
        assert_eq!(scaled.get(Element::H), 6.0);
        let scaled_rev = 3.0 * h2o;
        assert_eq!(scaled_rev.get(Element::H), 6.0);

        // Div
        let halved = sum / 2.0;
        assert_eq!(halved.get(Element::Fe), 1.5);
    }

    #[test]
    fn test_subtraction_negative_handling() {
        let small = Composition::from_elements([(Element::Fe, 2.0), (Element::O, 3.0)]);
        let large = Composition::from_elements([(Element::Fe, 4.0), (Element::O, 6.0)]);
        let feo = Composition::from_elements([(Element::Fe, 1.0), (Element::O, 1.0)]);

        // Subtraction producing negatives: invalid unless allow_negative=true
        assert!(!(small.clone() - large.clone()).is_valid());
        assert!((small.clone().with_allow_negative(true) - large.clone()).is_valid());

        // sub_checked: error on negatives, ok otherwise
        assert!(small.sub_checked(&large).is_err());
        assert!(small.sub_checked(&feo).is_ok());

        // sub_checked enforces caller's policy (not RHS's) and result inherits it
        assert!(
            small
                .sub_checked(&large.clone().with_allow_negative(true))
                .is_err()
        );
        assert!(!small.sub_checked(&feo).unwrap().allow_negative);
    }

    #[test]
    #[should_panic(expected = "Cannot divide Composition by zero")]
    fn test_div_by_zero_panics() {
        let comp = Composition::from_elements([(Element::Fe, 2.0)]);
        let _ = comp / 0.0;
    }

    // =========================================================================
    // Formula Variant Tests
    // =========================================================================

    #[test]
    fn test_formula_variants() {
        // Hill formula: C first, H second (if C present), then alphabetical
        let hill_cases: &[(&[(Element, f64)], &str)] = &[
            (
                &[(Element::C, 6.0), (Element::H, 12.0), (Element::O, 6.0)],
                "C6 H12 O6",
            ), // glucose
            (
                &[(Element::C, 1.0), (Element::H, 1.0), (Element::F, 3.0)],
                "C H F3",
            ), // H before F (C present)
            (&[(Element::H, 1.0), (Element::F, 1.0)], "F H"), // F before H (no C)
            (
                &[(Element::O, 1.0), (Element::H, 2.0), (Element::N, 1.0)],
                "H2 N O",
            ), // no C, alphabetical
        ];
        for (elements, expected) in hill_cases {
            let comp = Composition::from_elements(elements.iter().copied());
            assert_eq!(comp.hill_formula(), *expected, "{:?}", elements);
        }

        // Alphabetical formula: purely alphabetical by symbol
        let comp = Composition::from_formula("LiFePO4").unwrap();
        assert_eq!(comp.alphabetical_formula(), "Fe Li O4 P");
    }

    // =========================================================================
    // Comparison Tests
    // =========================================================================

    #[test]
    fn test_equality_and_comparison() {
        let fe2o3 = Composition::from_elements([(Element::Fe, 2.0), (Element::O, 3.0)]);
        let fe4o6 = Composition::from_elements([(Element::Fe, 4.0), (Element::O, 6.0)]);
        let fe2o3_copy = Composition::from_elements([(Element::Fe, 2.0), (Element::O, 3.0)]);

        // PartialEq compares exact species and amounts (scaling matters)
        assert_eq!(fe2o3, fe2o3_copy, "same species and amounts");
        assert_ne!(
            fe2o3, fe4o6,
            "different amounts, even if same reduced formula"
        );

        // formula_hash ignores scaling (groups by stoichiometry)
        assert_eq!(fe2o3.formula_hash(), fe4o6.formula_hash());

        // Oxidation states matter for equality
        let fe2_species = Species::new(Element::Fe, Some(2));
        let fe3_species = Species::new(Element::Fe, Some(3));
        let o2_species = Species::new(Element::O, Some(-2));

        let feo_with_fe2 = Composition::new([(fe2_species, 1.0), (o2_species, 1.0)]);
        let feo_with_fe3 = Composition::new([(fe3_species, 1.0), (o2_species, 1.0)]);
        assert_ne!(feo_with_fe2, feo_with_fe3, "different oxidation states");
        // But formula_hash ignores oxidation states
        assert_eq!(feo_with_fe2.formula_hash(), feo_with_fe3.formula_hash());

        // Mixed oxidation states: formulas aggregate by element
        let mixed = Composition::new([(fe2_species, 1.0), (fe3_species, 2.0), (o2_species, 4.0)]);
        assert_eq!(mixed.formula(), "Fe3 O4", "Fe²⁺ + 2×Fe³⁺ = Fe3");
        assert_eq!(mixed.reduced_formula(), "Fe3O4");
        // Same formula_hash as neutral Fe3O4
        let neutral_fe3o4 = Composition::from_elements([(Element::Fe, 3.0), (Element::O, 4.0)]);
        assert_eq!(mixed.formula_hash(), neutral_fe3o4.formula_hash());

        // almost_equals with tolerances
        let comp_approx = Composition::from_elements([(Element::Fe, 2.001), (Element::O, 2.999)]);
        assert!(fe2o3.almost_equals(&comp_approx, 0.01, 0.01));
        assert!(!fe2o3.almost_equals(&comp_approx, 0.0001, 0.0001));
    }

    // =========================================================================
    // Property Tests
    // =========================================================================

    #[test]
    fn test_element_properties() {
        let fe = Composition::from_elements([(Element::Fe, 1.0)]);
        let fe2o3 = Composition::from_elements([(Element::Fe, 2.0), (Element::O, 3.0)]);
        let h2o = Composition::from_elements([(Element::H, 2.0), (Element::O, 1.0)]);
        let nacl = Composition::from_elements([(Element::Na, 1.0), (Element::Cl, 1.0)]);

        // is_element
        assert!(fe.is_element());
        assert!(!fe2o3.is_element());

        // average_electroneg: Na(0.93) + Cl(3.16) / 2 ≈ 2.045
        let avg_en = nacl.average_electroneg().unwrap();
        assert!((avg_en - 2.045).abs() < 0.1, "NaCl avg EN: {avg_en}");

        // total_electrons: H(Z=1)*2 + O(Z=8)*1 = 10
        assert!((h2o.total_electrons() - 10.0).abs() < AMOUNT_TOLERANCE);
    }

    #[test]
    fn test_remap_elements() {
        let nacl = Composition::from_elements([(Element::Na, 1.0), (Element::Cl, 1.0)]);
        let mapping = HashMap::from([(Element::Na, Element::K)]);
        let remapped = nacl.remap_elements(&mapping);

        assert_eq!(remapped.get(Element::K), 1.0);
        assert_eq!(remapped.get(Element::Cl), 1.0);
        assert_eq!(remapped.get(Element::Na), 0.0);
    }

    // =========================================================================
    // Pymatgen Edge Case Tests (ported from pymatgen test suite)
    // =========================================================================

    #[test]
    fn test_formula_parsing_edge_cases() {
        // Various formula edge cases in one test
        let cases: &[(&str, &[(Element, f64)])] = &[
            ("NaN", &[(Element::Na, 1.0), (Element::N, 1.0)]), // not float NaN
            (
                "Y3N@C80",
                &[(Element::Y, 3.0), (Element::N, 1.0), (Element::C, 80.0)],
            ), // metallofullerene
            ("{Fe2O3}2", &[(Element::Fe, 4.0), (Element::O, 6.0)]), // curly brackets
            // gh-3559: deeply nested formula
            (
                "Li3Fe2((PO4)3(CO3)5)2",
                &[
                    (Element::Li, 3.0),
                    (Element::Fe, 2.0),
                    (Element::P, 6.0),
                    (Element::C, 10.0),
                    (Element::O, 54.0),
                ],
            ),
        ];
        for (formula, expected) in cases {
            let comp = Composition::from_formula(formula).expect(formula);
            for (elem, amt) in *expected {
                assert_eq!(comp.get(*elem), *amt, "{formula}: {elem:?}");
            }
        }

        // Square brackets with nested parentheses
        let comp = Composition::from_formula("[Cu(NH3)4]SO4").unwrap();
        assert_eq!(comp.get(Element::Cu), 1.0);
        assert_eq!(comp.get(Element::H), 12.0);

        // Fractional subscripts
        let frac = Composition::from_formula("Li1.5Si0.5").unwrap();
        assert!((frac.get(Element::Li) - 1.5).abs() < AMOUNT_TOLERANCE);

        // Invalid inputs should error
        for invalid in ["", "   ", "6123"] {
            assert!(Composition::from_formula(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn test_reduced_formula_and_hash() {
        // Single element reduces to symbol
        assert_eq!(
            Composition::from_elements([(Element::O, 4.0)]).reduced_formula(),
            "O"
        );
        // Fe4O6 → Fe2O3
        assert_eq!(
            Composition::from_elements([(Element::Fe, 4.0), (Element::O, 6.0)]).reduced_formula(),
            "Fe2O3"
        );
        // Equal reduced formulas have equal hashes
        let comp1 = Composition::from_elements([(Element::Fe, 2.0), (Element::O, 3.0)]);
        let comp2 = Composition::from_elements([(Element::Fe, 4.0), (Element::O, 6.0)]);
        assert_eq!(comp1.formula_hash(), comp2.formula_hash());
        // Small fractions don't crash
        let frac = Composition::from_elements([(Element::Li, 1.0 / 6.0), (Element::B, 1.0)]);
        assert!(frac.num_atoms() > 0.0);
    }

    #[test]
    fn test_composition_accessors() {
        // Missing element returns 0
        let comp = Composition::from_formula("NaCl").unwrap();
        assert_eq!(comp.get_atomic_fraction(Element::S), 0.0);
        assert_eq!(comp.get_wt_fraction(Element::S), 0.0);

        // Empty composition
        let empty = Composition::from_elements([]);
        assert!(empty.is_empty());
        assert_eq!(empty.formula(), "");
        assert!(empty.average_electroneg().is_none());
    }

    #[test]
    fn test_hill_formula_ordering() {
        // Hill: C first, H second when C present, then alphabetical
        let comp = Composition::from_elements([
            (Element::Ga, 8.0),
            (Element::H, 102.0),
            (Element::C, 32.0),
            (Element::O, 3.0),
        ]);
        let hill = comp.hill_formula();
        assert!(hill.starts_with("C"), "Hill should start with C: {}", hill);
        let parts: Vec<&str> = hill.split_whitespace().collect();
        assert_eq!(parts[0], "C32");
        assert_eq!(parts[1], "H102");
    }
}
