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
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    allow_negative: bool,
}

impl Composition {
    // =========================================================================
    // Constructors
    // =========================================================================

    /// Create a new composition from species-amount pairs.
    ///
    /// Zero and negative amounts are filtered out by default.
    pub fn new(species: impl IntoIterator<Item = (Species, f64)>) -> Self {
        let species: IndexMap<Species, f64> = species
            .into_iter()
            .filter(|(_, amt)| amt.abs() > AMOUNT_TOLERANCE)
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
    pub fn average_electroneg(&self) -> Option<f64> {
        if self.is_empty() {
            return None;
        }
        let total: f64 = self
            .species
            .iter()
            .filter_map(|(sp, amt)| sp.electronegativity().map(|en| en * amt.abs()))
            .sum();
        Some(total / self.num_atoms())
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
    pub fn formula(&self) -> String {
        if self.is_empty() {
            return String::new();
        }
        self.sorted_by_electronegativity()
            .iter()
            .map(|(sp, amt)| format_amount(sp.element.symbol(), **amt))
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Get the reduced formula string.
    ///
    /// Amounts are divided by their GCD, producing minimal integer ratios.
    pub fn reduced_formula(&self) -> String {
        if self.is_empty() {
            return String::new();
        }

        let gcd = self.gcd_of_amounts();
        if gcd < AMOUNT_TOLERANCE {
            return self.formula().replace(' ', "");
        }

        self.sorted_by_electronegativity()
            .iter()
            .map(|(sp, amt)| format_amount(sp.element.symbol(), **amt / gcd))
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
    /// Species with the same element are merged.
    pub fn element_composition(&self) -> Self {
        let mut elem_amounts: IndexMap<Species, f64> = IndexMap::new();
        for (sp, amt) in &self.species {
            let neutral = Species::neutral(sp.element);
            *elem_amounts.entry(neutral).or_insert(0.0) += amt;
        }
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
    /// allow_negative is false.
    pub fn sub_checked(&self, other: &Self) -> Result<Self> {
        let result = self.clone() - other.clone();
        if !result.is_valid() {
            return Err(FerroxError::CompositionError {
                reason: "Subtraction resulted in negative amounts".into(),
            });
        }
        Ok(result)
    }

    /// Get a hash of the reduced formula for fast equality checks.
    ///
    /// Note: This is separate from the `Hash` trait implementation but produces
    /// the same result. Use this when you need the raw `u64` hash value.
    pub fn formula_hash(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.reduced_formula().hash(&mut hasher);
        hasher.finish()
    }
}

// =============================================================================
// Operator Implementations
// =============================================================================

impl Add for Composition {
    type Output = Self;

    fn add(self, rhs: Self) -> Self {
        let mut result = self.species.clone();
        for (sp, amt) in rhs.species {
            *result.entry(sp).or_insert(0.0) += amt;
        }
        // Filter out near-zero amounts
        let filtered: IndexMap<Species, f64> = result
            .into_iter()
            .filter(|(_, amt)| amt.abs() > AMOUNT_TOLERANCE)
            .collect();
        Self {
            species: filtered,
            allow_negative: self.allow_negative || rhs.allow_negative,
        }
    }
}

impl Sub for Composition {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self {
        let mut result = self.species.clone();
        for (sp, amt) in rhs.species {
            *result.entry(sp).or_insert(0.0) -= amt;
        }
        // Filter out near-zero amounts
        let filtered: IndexMap<Species, f64> = result
            .into_iter()
            .filter(|(_, amt)| amt.abs() > AMOUNT_TOLERANCE)
            .collect();
        Self {
            species: filtered,
            allow_negative: self.allow_negative || rhs.allow_negative,
        }
    }
}

impl Mul<f64> for Composition {
    type Output = Self;

    fn mul(self, scalar: f64) -> Self {
        let species: IndexMap<Species, f64> = self
            .species
            .into_iter()
            .map(|(sp, amt)| (sp, amt * scalar))
            .filter(|(_, amt)| amt.abs() > AMOUNT_TOLERANCE)
            .collect();
        Self {
            species,
            allow_negative: self.allow_negative,
        }
    }
}

impl Div<f64> for Composition {
    type Output = Self;

    fn div(self, scalar: f64) -> Self {
        assert!(
            scalar.abs() >= AMOUNT_TOLERANCE,
            "Cannot divide Composition by zero or near-zero value"
        );
        let species: IndexMap<Species, f64> = self
            .species
            .into_iter()
            .map(|(sp, amt)| (sp, amt / scalar))
            .filter(|(_, amt)| amt.abs() > AMOUNT_TOLERANCE)
            .collect();
        Self {
            species,
            allow_negative: self.allow_negative,
        }
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

/// Equality is based on reduced formula, so `Fe2O3 == Fe4O6` is true.
/// Use `almost_equals()` for tolerance-based comparison of actual amounts.
impl PartialEq for Composition {
    fn eq(&self, other: &Self) -> bool {
        self.reduced_formula() == other.reduced_formula()
    }
}

impl Eq for Composition {}

impl std::hash::Hash for Composition {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.reduced_formula().hash(state);
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Parse a formula string recursively, expanding parentheses.
fn parse_formula_recursive(formula: &str) -> Result<Vec<(Species, f64)>> {
    let mut formula = formula.to_string();

    // Recursively expand parentheses from innermost to outermost
    while PAREN_GROUP_RE.is_match(&formula) {
        let new_formula = PAREN_GROUP_RE.replace(&formula, |caps: &regex::Captures| {
            let inner = &caps[1];
            let multiplier: f64 = if caps[2].is_empty() {
                1.0
            } else {
                caps[2].parse().unwrap_or(1.0)
            };

            // Parse inner content and multiply amounts
            if let Ok(inner_species) = parse_flat_formula(inner) {
                inner_species
                    .iter()
                    .map(|(sp, amt)| format!("{}{}", sp.element.symbol(), amt * multiplier))
                    .collect::<Vec<_>>()
                    .join("")
            } else {
                inner.to_string()
            }
        });
        formula = new_formula.to_string();
    }

    parse_flat_formula(&formula)
}

/// Parse a flat formula (no parentheses) into species-amount pairs.
fn parse_flat_formula(formula: &str) -> Result<Vec<(Species, f64)>> {
    let mut results: IndexMap<Species, f64> = IndexMap::new();

    for cap in ELEMENT_AMOUNT_RE.captures_iter(formula) {
        let symbol = &cap[1];
        let amt: f64 = if cap[2].is_empty() {
            1.0
        } else {
            cap[2].parse().unwrap_or(1.0)
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
        "C" if has_carbon => (0, sym),
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
    const EPSILON: f64 = 1e-10;
    const MAX_ITER: usize = 100;

    a = a.abs();
    b = b.abs();

    for _ in 0..MAX_ITER {
        if b < EPSILON {
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

        // Normal subtraction produces invalid composition
        let result = small.clone() - large.clone();
        assert!(!result.is_valid());

        // With allow_negative flag
        let result_allowed = small.clone().with_allow_negative(true) - large.clone();
        assert!(result_allowed.is_valid());

        // sub_checked returns error
        assert!(small.sub_checked(&large).is_err());
        let feo = Composition::from_elements([(Element::Fe, 1.0), (Element::O, 1.0)]);
        assert!(small.sub_checked(&feo).is_ok());
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
        let fe_frac = Composition::from_elements([(Element::Fe, 0.2), (Element::O, 0.3)]);

        // PartialEq based on reduced formula
        assert_eq!(fe2o3, fe4o6, "same reduced formula");
        assert_eq!(fe2o3, fe_frac, "fractional also reduces to Fe2O3");

        // Hash consistency
        assert_eq!(fe2o3.formula_hash(), fe4o6.formula_hash());
        assert_eq!(fe2o3.formula_hash(), fe_frac.formula_hash());

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
}
