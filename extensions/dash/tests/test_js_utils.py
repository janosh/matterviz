"""Tests for JavaScript utility functions using Node.js.

These tests verify the sanitize_for_json and convert_dash_props_to_matterviz functions
by running them through Node with the same test cases we'd use in Python.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

# Path to the MatterViz React component (TypeScript)
REACT_TS_PATH = (
    Path(__file__).parent.parent / "src" / "lib" / "components" / "MatterViz.react.ts"
)


def run_js_test(js_code: str) -> dict:  # type: ignore[return]
    """Run JavaScript code and return the JSON result."""
    # Read the TS file and extract the functions we need
    js_file = REACT_TS_PATH.read_text()

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
            ["node", "--input-type=module-typescript", "-e", test_script],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            err_msg = result.stderr.strip() or "(no stderr output)"
            pytest.fail(f"Node.js execution failed: {err_msg}")
        stdout = result.stdout.strip()
        if not stdout:
            pytest.fail("Node.js produced empty stdout")
        return json.loads(stdout)
    except FileNotFoundError:
        pytest.skip("Node.js not available")
    except json.JSONDecodeError as exc:
        pytest.fail(f"Invalid JSON output: {result.stdout!r}, error: {exc}")


class TestSanitizeForJsonEdgeCases:
    """Test edge cases for sanitize_for_json function."""

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
        result = run_js_test(f"return sanitize_for_json({input_val})")
        assert result == expected

    def test_undefined_in_object_excluded(self) -> None:
        """Undefined values in objects should be excluded."""
        result = run_js_test("return sanitize_for_json({a: 1, b: undefined, c: 3})")
        assert result == {"a": 1, "c": 3}

    @pytest.mark.parametrize("js_val", ["Infinity", "NaN"])
    def test_non_finite_becomes_null(self, js_val: str) -> None:
        """Infinity and NaN should become null."""
        assert run_js_test(f"return sanitize_for_json({js_val})") is None

    @pytest.mark.parametrize(
        "js_expr,expected",
        [
            ("BigInt(9007199254740991)", "9007199254740991"),
            ('new Date("2024-01-15T12:00:00Z")', "2024-01-15T12:00:00.000Z"),
            ("new Set([1, 2, 3])", [1, 2, 3]),
            ('new Map([["a", 1], ["b", 2]])', [["a", 1], ["b", 2]]),
            ("new Uint8Array([255, 128, 0])", [255, 128, 0]),
        ],
    )
    def test_special_types(self, js_expr: str, expected) -> None:
        """Special JS types are converted correctly."""
        assert run_js_test(f"return sanitize_for_json({js_expr})") == expected

    def test_function_excluded(self) -> None:
        """Functions should be excluded from objects."""
        result = run_js_test("return sanitize_for_json({fn: () => {}, val: 1})")
        assert result == {"val": 1}

    def test_float32_array_precision(self) -> None:
        """Float32Array converts with acceptable precision."""
        result = run_js_test(
            "return sanitize_for_json(new Float32Array([1.5, 2.5, 3.5]))"
        )
        assert len(result) == 3
        assert abs(result[0] - 1.5) < 0.01

    def test_error_to_object(self) -> None:
        """Error should become object with name, message, stack."""
        result = run_js_test('return sanitize_for_json(new Error("test error"))')
        assert result["name"] == "Error"
        assert result["message"] == "test error"
        assert "stack" in result

    def test_circular_reference(self) -> None:
        """Circular references should become '[Circular]'."""
        result = run_js_test("""
            const obj = {a: 1};
            obj.self = obj;
            return sanitize_for_json(obj);
        """)
        assert result["a"] == 1
        assert result["self"] == "[Circular]"

    def test_nested_objects(self) -> None:
        """Nested objects should be preserved."""
        result = run_js_test("""
            return sanitize_for_json({
                a: {b: {c: {d: 1}}},
                arr: [1, [2, [3]]]
            });
        """)
        assert result["a"]["b"]["c"]["d"] == 1
        assert result["arr"] == [1, [2, [3]]]


class TestConvertDashPropsToMatterviz:
    """Test edge cases for convert_dash_props_to_matterviz function."""

    @pytest.mark.parametrize("props", ["{}", "null", "undefined"])
    def test_empty_null_undefined_props(self, props: str) -> None:
        """Empty/null/undefined props should return empty object."""
        result = run_js_test(f"return convert_dash_props_to_matterviz({props}, [], [])")
        assert result == {}

    def test_set_props_conversion(self) -> None:
        """Arrays in set_props should become Sets (serialized as arrays)."""
        result = run_js_test("""
            const result = convert_dash_props_to_matterviz(
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
            const result = convert_dash_props_to_matterviz(
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
            const result = convert_dash_props_to_matterviz(
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
            const result = convert_dash_props_to_matterviz(
                {existing: [1, 2]},
                ["nonexistent", "existing"],
                ["alsoMissing"]
            );
            // Verify conversion and serialize for JSON
            return {
                existing: Array.from(result.existing),
                isSet: result.existing instanceof Set,
                hasNonexistent: "nonexistent" in result,
                hasAlsoMissing: "alsoMissing" in result
            };
        """)
        # Should not throw, existing should be converted to Set
        assert result["existing"] == [1, 2]
        assert result["isSet"] is True
        # Missing keys should not appear in result
        assert result["hasNonexistent"] is False
        assert result["hasAlsoMissing"] is False
