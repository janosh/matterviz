"""Tests for typed wrapper classes and the MatterViz component."""

from __future__ import annotations

from pathlib import Path

import pytest

import matterviz_dash_components as mvc
from matterviz_dash_components import MatterViz
from scripts.sync_typed_wrappers import (
    _py_type_hint,
    add_extra_props,
    generate_wrappers,
    parse_svelte_dts_with_includes,
)


def test_matterviz_forwards_props() -> None:
    """MatterViz forwards custom props and omits absent IDs."""
    expected = {
        "id": "test",
        "component": "structure/Structure",
        "mv_props": {"structure": {"sites": []}, "label": "α-Fe"},
        "set_props": ["hidden_elements"],
        "float32_props": ["positions"],
        "event_props": ["on_file_load"],
        "last_event": {"prop": "on_file_load"},
        "className": "viewer",
        "style": {"height": "100%"},
    }
    assert MatterViz(**expected).to_plotly_json()["props"] == expected
    assert "id" not in MatterViz(component="Structure").to_plotly_json()["props"]


def test_prop_kind_detection(tmp_path: Path) -> None:
    """Aliases, unions, and parenthesized callbacks classify correctly."""
    (tmp_path / "Component.svelte.d.ts").write_text(
        "type $$ComponentProps = {}; declare const Component: "
        'import("svelte").Component<$$ComponentProps>;',
        encoding="utf-8",
    )
    (tmp_path / "included.d.ts").write_text(
        "type EventHandler = (data: StructureHandlerData) => void;\n"
        "type OnReady = EventHandler;\n"
        "interface IncludedProps { onReady?: OnReady; "
        "colorScale?: string | ((num: number) => string); "
        "onNullable?: (() => void) | null; "
        "onOverloaded?: ((data: string) => void) | ((data: number) => void); }\n",
        encoding="utf-8",
    )
    props = parse_svelte_dts_with_includes(
        f"{tmp_path}/Component.svelte.d.ts",
        str(tmp_path),
        ["included.d.ts:IncludedProps"],
    )
    add_extra_props(props, {"onOptional": "((data: string) => void)?"})
    assert {prop.js_name: prop.kind for prop in props} == {
        "onReady": "callback",
        "colorScale": "value",
        "onNullable": "callback",
        "onOverloaded": "callback",
        "onOptional": "callback",
    }


def test_duplicate_python_prop_error_lists_collisions(tmp_path: Path) -> None:
    """Wrapper generation identifies colliding normalized Python prop names."""
    (tmp_path / "Test.svelte.d.ts").write_text(
        "type $$ComponentProps = { fooBar?: string; foo_bar?: number; "
        "barBaz?: string; bar_baz?: number; }; "
        'declare const Test: import("svelte").Component<$$ComponentProps>;',
        encoding="utf-8",
    )
    with pytest.raises(
        ValueError,
        match=r"Test has duplicate Python prop names: bar_baz, foo_bar",
    ):
        generate_wrappers({"components": {"Test": {"key": "Test"}}}, str(tmp_path))


@pytest.mark.parametrize(
    ("ts_type", "expected"),
    [
        ("Set<string>", "list"),
        ("ReadonlySet<number>", "list"),
        ("IsosurfaceSettings", "Any"),
    ],
)
def test_set_type_hints_require_set_generics(ts_type: str, expected: str) -> None:
    """Set type inference excludes class names that merely contain 'Set'."""
    assert _py_type_hint(ts_type) == expected


@pytest.mark.parametrize(
    "wrapper",
    [mvc.ConvexHull2D, mvc.ConvexHull3D, mvc.ConvexHull4D],
)
def test_convex_hull_category_props_forwarded(wrapper: type) -> None:
    """Typed convex hull wrappers forward category props."""
    assert wrapper(entries=[]).mv_props == {"entries": []}
    assert wrapper(entries=[], entry_category=None, hidden_categories=[]).mv_props == {
        "entries": [],
        "entry_category": None,
        "hidden_categories": [],
    }
