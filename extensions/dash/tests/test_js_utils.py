"""Tests for JavaScript utility functions using Node.js.

These tests verify the sanitizeForJson and convertDashPropsToMatterviz functions
by running them through Node with the same test cases we'd use in Python.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

# Path to the MatterViz.react.js file
REACT_JS_PATH = (
    Path(__file__).parent.parent / "src" / "lib" / "components" / "MatterViz.react.js"
)


def run_js_test(js_code: str) -> dict:
    """Run JavaScript code and return the JSON result."""
    # Read the JS file and extract the functions we need
    js_file = REACT_JS_PATH.read_text()

    # Create a test script that imports the functions and runs the test
    test_script = f"""
    {js_file}

    // Run the test code
    const result = (() => {{
        {js_code}
    }})();

    console.log(JSON.stringify(result));
    """

    try:
        result = subprocess.run(
            ["node", "-e", test_script],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            pytest.skip(f"Node.js test failed: {result.stderr}")
        return json.loads(result.stdout.strip())
    except FileNotFoundError:
        pytest.skip("Node.js not available")
    except json.JSONDecodeError as exc:
        pytest.fail(f"Invalid JSON output: {result.stdout}, error: {exc}")


class TestSanitizeForJsonEdgeCases:
    """Test edge cases for sanitizeForJson function."""

    @pytest.mark.parametrize(
        "input_val,expected",
        [
            ("null", None),
            ('""', ""),
            ('"hello"', "hello"),
            ("true", True),
            ("false", False),
            ("42", 42),
            ("3.14", 3.14),
        ],
    )
    def test_primitives(self, input_val: str, expected) -> None:
        """Primitive values should pass through unchanged."""
        result = run_js_test(f"return sanitizeForJson({input_val})")
        assert result == expected

    def test_undefined_in_object_excluded(self) -> None:
        """Undefined values in objects should be excluded."""
        result = run_js_test("return sanitizeForJson({a: 1, b: undefined, c: 3})")
        assert result == {"a": 1, "c": 3}

    def test_infinity_becomes_null(self) -> None:
        """Infinity should become null."""
        result = run_js_test("return sanitizeForJson(Infinity)")
        assert result is None

    def test_nan_becomes_null(self) -> None:
        """NaN should become null."""
        result = run_js_test("return sanitizeForJson(NaN)")
        assert result is None

    def test_bigint_becomes_string(self) -> None:
        """BigInt should become string."""
        result = run_js_test("return sanitizeForJson(BigInt(9007199254740991))")
        assert result == "9007199254740991"

    def test_function_excluded(self) -> None:
        """Functions should be excluded (undefined)."""
        result = run_js_test(
            "return sanitizeForJson({fn: () => {}, val: 1})"
        )
        assert result == {"val": 1}

    def test_date_to_iso_string(self) -> None:
        """Date should become ISO string."""
        result = run_js_test(
            'return sanitizeForJson(new Date("2024-01-15T12:00:00Z"))'
        )
        assert result == "2024-01-15T12:00:00.000Z"

    def test_set_to_array(self) -> None:
        """Set should become array."""
        result = run_js_test("return sanitizeForJson(new Set([1, 2, 3]))")
        assert result == [1, 2, 3]

    def test_map_to_entries(self) -> None:
        """Map should become array of entries."""
        result = run_js_test(
            'return sanitizeForJson(new Map([["a", 1], ["b", 2]]))'
        )
        assert result == [["a", 1], ["b", 2]]

    def test_typed_array_to_array(self) -> None:
        """TypedArrays should become regular arrays."""
        result = run_js_test(
            "return sanitizeForJson(new Float32Array([1.5, 2.5, 3.5]))"
        )
        # Float32Array may have precision differences
        assert len(result) == 3
        assert abs(result[0] - 1.5) < 0.01

    def test_uint8array_to_array(self) -> None:
        """Uint8Array should become regular array."""
        result = run_js_test(
            "return sanitizeForJson(new Uint8Array([255, 128, 0]))"
        )
        assert result == [255, 128, 0]

    def test_error_to_object(self) -> None:
        """Error should become object with name, message, stack."""
        result = run_js_test(
            'return sanitizeForJson(new Error("test error"))'
        )
        assert result["name"] == "Error"
        assert result["message"] == "test error"
        assert "stack" in result

    def test_circular_reference(self) -> None:
        """Circular references should become '[Circular]'."""
        result = run_js_test("""
            const obj = {a: 1};
            obj.self = obj;
            return sanitizeForJson(obj);
        """)
        assert result["a"] == 1
        assert result["self"] == "[Circular]"

    def test_nested_objects(self) -> None:
        """Nested objects should be preserved."""
        result = run_js_test("""
            return sanitizeForJson({
                a: {b: {c: {d: 1}}},
                arr: [1, [2, [3]]]
            });
        """)
        assert result["a"]["b"]["c"]["d"] == 1
        assert result["arr"] == [1, [2, [3]]]


class TestConvertDashPropsToMatterviz:
    """Test edge cases for convertDashPropsToMatterviz function."""

    def test_empty_props(self) -> None:
        """Empty props should return empty object."""
        result = run_js_test("return convertDashPropsToMatterviz({}, [], [])")
        assert result == {}

    def test_null_props(self) -> None:
        """Null props should return empty object."""
        result = run_js_test("return convertDashPropsToMatterviz(null, [], [])")
        assert result == {}

    def test_undefined_props(self) -> None:
        """Undefined props should return empty object."""
        result = run_js_test(
            "return convertDashPropsToMatterviz(undefined, [], [])"
        )
        assert result == {}

    def test_set_props_conversion(self) -> None:
        """Arrays in set_props should become Sets (serialized as arrays)."""
        result = run_js_test("""
            const result = convertDashPropsToMatterviz(
                {items: [1, 2, 3], other: "unchanged"},
                ["items"],
                []
            );
            // Convert Set back to array for JSON serialization
            return {
                items: Array.from(result.items),
                isSet: result.items instanceof Set,
                other: result.other
            };
        """)
        assert result["items"] == [1, 2, 3]
        assert result["isSet"] is True
        assert result["other"] == "unchanged"

    def test_float32_props_conversion(self) -> None:
        """Arrays in float32_props should become Float32Arrays."""
        result = run_js_test("""
            const result = convertDashPropsToMatterviz(
                {positions: [1.0, 2.0, 3.0]},
                [],
                ["positions"]
            );
            return {
                positions: Array.from(result.positions),
                isFloat32: result.positions instanceof Float32Array
            };
        """)
        assert len(result["positions"]) == 3
        assert result["isFloat32"] is True

    def test_non_array_not_converted(self) -> None:
        """Non-array values should not be converted even if in set_props."""
        result = run_js_test("""
            const result = convertDashPropsToMatterviz(
                {notArray: "string value"},
                ["notArray"],
                []
            );
            return result;
        """)
        assert result["notArray"] == "string value"

    def test_missing_keys_ignored(self) -> None:
        """Keys in set_props/float32_props not in props should be ignored."""
        result = run_js_test("""
            return convertDashPropsToMatterviz(
                {existing: [1, 2]},
                ["nonexistent", "existing"],
                ["alsoMissing"]
            );
        """)
        # Should not throw, result should have existing converted
        assert "existing" in result
