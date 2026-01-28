//! Chemical species definitions.
//!
//! A species represents an element with an optional oxidation state,
//! e.g., Fe2+ or O2-.

use crate::element::Element;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::hash::{Hash, Hasher};

/// A chemical species (element + optional oxidation state).
///
/// # Examples
///
/// ```
/// use ferrox::species::Species;
/// use ferrox::element::Element;
///
/// // Neutral iron
/// let fe = Species::new(Element::Fe, None);
/// assert_eq!(fe.to_string(), "Fe");
///
/// // Iron(II)
/// let fe2 = Species::new(Element::Fe, Some(2));
/// assert_eq!(fe2.to_string(), "Fe2+");
///
/// // Oxide ion
/// let o2 = Species::new(Element::O, Some(-2));
/// assert_eq!(o2.to_string(), "O2-");
/// ```
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Species {
    /// The chemical element.
    pub element: Element,
    /// The oxidation state, if known.
    pub oxidation_state: Option<i8>,
}

impl Species {
    /// Create a new species.
    ///
    /// # Arguments
    ///
    /// * `element` - The chemical element
    /// * `oxidation_state` - Optional oxidation state (e.g., +2, -1)
    pub fn new(element: Element, oxidation_state: Option<i8>) -> Self {
        Self {
            element,
            oxidation_state,
        }
    }

    /// Create a neutral species (no oxidation state).
    pub fn neutral(element: Element) -> Self {
        Self::new(element, None)
    }

    /// Parse a species from a string like "Fe2+" or "O2-".
    ///
    /// Supported formats:
    /// - "Fe" - neutral element
    /// - "Fe2+" - element with positive oxidation state
    /// - "O2-" - element with negative oxidation state
    /// - "Na+" - element with +1 oxidation state
    /// - "Cl-" - element with -1 oxidation state
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::species::Species;
    /// use ferrox::element::Element;
    ///
    /// let fe2 = Species::from_string("Fe2+").unwrap();
    /// assert_eq!(fe2.element, Element::Fe);
    /// assert_eq!(fe2.oxidation_state, Some(2));
    ///
    /// let o = Species::from_string("O").unwrap();
    /// assert_eq!(o.element, Element::O);
    /// assert_eq!(o.oxidation_state, None);
    /// ```
    pub fn from_string(s: &str) -> Option<Self> {
        let s = s.trim();
        if s.is_empty() {
            return None;
        }

        // Check if there's a sign at the end
        let last_char = s.chars().last()?;
        if last_char != '+' && last_char != '-' {
            // No oxidation state, just element
            let element = Element::from_symbol(s)?;
            return Some(Self::new(element, None));
        }

        // Has a sign - find where the number starts
        let sign: i8 = if last_char == '+' { 1 } else { -1 };
        let s_without_sign = &s[..s.len() - 1];

        // Find where digits end (searching from the end)
        let mut digit_start = s_without_sign.len();
        for (idx, ch) in s_without_sign.char_indices().rev() {
            if ch.is_ascii_digit() {
                digit_start = idx;
            } else {
                break;
            }
        }

        let symbol = &s_without_sign[..digit_start];
        let element = Element::from_symbol(symbol)?;

        let oxi_state = if digit_start < s_without_sign.len() {
            // There's a number
            let num_str = &s_without_sign[digit_start..];
            let num: i8 = num_str.parse().ok()?;
            Some(num * sign)
        } else {
            // Just the sign, means +1 or -1
            Some(sign)
        };

        Some(Self::new(element, oxi_state))
    }

    /// Get the element's electronegativity.
    pub fn electronegativity(&self) -> Option<f64> {
        self.element.electronegativity()
    }
}

impl PartialEq for Species {
    fn eq(&self, other: &Self) -> bool {
        self.element == other.element && self.oxidation_state == other.oxidation_state
    }
}

impl Eq for Species {}

impl Hash for Species {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.element.hash(state);
        self.oxidation_state.hash(state);
    }
}

impl fmt::Display for Species {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.element.symbol())?;
        if let Some(oxi) = self.oxidation_state {
            let abs_oxi = oxi.abs();
            let sign = if oxi >= 0 { '+' } else { '-' };
            if abs_oxi == 1 {
                write!(f, "{sign}")?;
            } else {
                write!(f, "{abs_oxi}{sign}")?;
            }
        }
        Ok(())
    }
}

impl From<Element> for Species {
    fn from(element: Element) -> Self {
        Self::neutral(element)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new() {
        let fe2 = Species::new(Element::Fe, Some(2));
        assert_eq!(fe2.element, Element::Fe);
        assert_eq!(fe2.oxidation_state, Some(2));
    }

    #[test]
    fn test_neutral() {
        let fe = Species::neutral(Element::Fe);
        assert_eq!(fe.element, Element::Fe);
        assert_eq!(fe.oxidation_state, None);
    }

    #[test]
    fn test_from_string_and_display() {
        // (input, expected_element, expected_oxi, expected_display)
        let cases: &[(&str, Element, Option<i8>, &str)] = &[
            ("Fe", Element::Fe, None, "Fe"),
            ("Fe2+", Element::Fe, Some(2), "Fe2+"),
            ("Fe3+", Element::Fe, Some(3), "Fe3+"),
            ("O2-", Element::O, Some(-2), "O2-"),
            ("Na+", Element::Na, Some(1), "Na+"),
            ("Cl-", Element::Cl, Some(-1), "Cl-"),
            ("Ca2+", Element::Ca, Some(2), "Ca2+"),
            ("Mg", Element::Mg, None, "Mg"),
            ("Mn7+", Element::Mn, Some(7), "Mn7+"),
        ];
        for (input, elem, oxi, display) in cases {
            let sp = Species::from_string(input).unwrap();
            assert_eq!(sp.element, *elem, "element mismatch for {input}");
            assert_eq!(sp.oxidation_state, *oxi, "oxi mismatch for {input}");
            assert_eq!(sp.to_string(), *display, "display mismatch for {input}");
        }
    }

    #[test]
    fn test_equality() {
        let fe2a = Species::new(Element::Fe, Some(2));
        let fe2b = Species::new(Element::Fe, Some(2));
        let fe3 = Species::new(Element::Fe, Some(3));
        let fe_neutral = Species::neutral(Element::Fe);

        assert_eq!(fe2a, fe2b);
        assert_ne!(fe2a, fe3);
        assert_ne!(fe2a, fe_neutral);
    }

    #[test]
    fn test_from_element() {
        let fe: Species = Element::Fe.into();
        assert_eq!(fe.element, Element::Fe);
        assert_eq!(fe.oxidation_state, None);
    }

    #[test]
    fn test_from_string_errors() {
        for invalid in ["Xx", "InvalidElement", "", "   ", "+", "-", "2+Fe", "++"] {
            assert!(Species::from_string(invalid).is_none(), "{invalid} should fail");
        }
    }

    #[test]
    fn test_electronegativity() {
        for (elem, expected) in [(Element::Fe, 1.83), (Element::O, 3.44)] {
            let en = Species::neutral(elem).electronegativity().unwrap();
            assert!((en - expected).abs() < 0.01, "{elem:?} EN mismatch");
        }
        // Oxidation state doesn't affect electronegativity
        let fe = Species::neutral(Element::Fe);
        let fe2 = Species::new(Element::Fe, Some(2));
        assert_eq!(fe.electronegativity(), fe2.electronegativity());
    }

}
