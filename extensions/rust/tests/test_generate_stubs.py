"""Tests for generate_stubs.py stub cleanup functions."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from generate_stubs import _convert_optional, clean_stub


@pytest.mark.parametrize(
    ("input_text", "expected"),
    [
        ("Optional[float]", "float | None"),
        ("Optional[int]", "int | None"),
        ("Optional[str]", "str | None"),
        ("Optional[Sequence[float]]", "Sequence[float] | None"),
        ("Optional[Sequence[Sequence[float]]]", "Sequence[Sequence[float]] | None"),
        # nested Optional
        ("Optional[Optional[int]]", "int | None | None"),
        ("Optional[dict[str, Optional[int]]]", "dict[str, int | None] | None"),
        # no Optional
        ("float", "float"),
        ("int | None", "int | None"),
        # in context
        ("x: Optional[float] = None", "x: float | None = None"),
    ],
)
def test_convert_optional(input_text: str, expected: str) -> None:
    """Optional[X] converts to X | None including nested cases."""
    assert _convert_optional(input_text) == expected


@pytest.mark.parametrize(
    ("input_text", "expected_fragment"),
    [
        # bare dict gets type params
        ("def foo() -> dict:", "def foo() -> dict[str, Any]:"),
        ("x: dict | None", "x: dict[str, Any] | None"),
        # bare list gets type params
        ("def bar() -> list:", "def bar() -> list[Any]:"),
        # dict/list in docstrings are NOT modified
        ("a dict of elements", "a dict of elements"),
        ("a list of structures", "a list of structures"),
        # __eq__ takes object
        ("def __eq__(self, other: Element)", "def __eq__(self, other: object)"),
    ],
)
def test_clean_stub_transforms(input_text: str, expected_fragment: str) -> None:
    """clean_stub applies type fixes without corrupting docstrings."""
    # Wrap in a minimal class so clean_stub finds body content
    stub = f"import typing\n@final\nclass Foo:\n    {input_text}\n"
    result = clean_stub(stub)
    assert expected_fragment in result
