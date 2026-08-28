"""Verify the 17 wallpaper group tables: correct order, and closure modulo the lattice."""
from __future__ import annotations

import numpy as np
import pytest

from tiler.groups import GROUP_SYMBOLS, WALLPAPER_GROUPS, coset_representatives
from tiler.lattice import basis_vectors, centering_offsets

EXPECTED_ORDER = {
    "p1": 1, "p2": 2, "pm": 2, "pg": 2, "cm": 2,
    "pmm": 4, "pmg": 4, "pgg": 4, "cmm": 4,
    "p4": 4, "p4m": 8, "p4g": 8,
    "p3": 3, "p3m1": 6, "p31m": 6, "p6": 6, "p6m": 12,
}


def test_all_17_groups_present():
    assert set(GROUP_SYMBOLS) == set(EXPECTED_ORDER)
    assert len(GROUP_SYMBOLS) == 17


@pytest.mark.parametrize("symbol", GROUP_SYMBOLS)
def test_point_group_order(symbol):
    group = WALLPAPER_GROUPS[symbol]
    assert len(group.frac_ops) == EXPECTED_ORDER[symbol]


@pytest.mark.parametrize("symbol", GROUP_SYMBOLS)
def test_identity_present(symbol):
    group = WALLPAPER_GROUPS[symbol]
    matrices = [m for m, _ in group.frac_ops]
    assert any(np.allclose(m, np.eye(2)) for m in matrices)


def _fractional_translation(vec: np.ndarray, symbol: str) -> np.ndarray:
    """Reduce a fractional translation vector modulo the group's lattice (incl. centering)."""
    kind = WALLPAPER_GROUPS[symbol].lattice_kind
    offsets = centering_offsets(kind)
    frac = vec - np.floor(vec)
    for off in offsets:
        diff = (frac - off) - np.round(frac - off)
        if np.allclose(diff, 0, atol=1e-6):
            return off
    return frac


@pytest.mark.parametrize("symbol", GROUP_SYMBOLS)
def test_closure_modulo_lattice(symbol):
    """Composing any two coset reps must give back a coset rep, up to a lattice translation."""
    group = WALLPAPER_GROUPS[symbol]
    ops = group.frac_ops

    for m1, t1 in ops:
        for m2, t2 in ops:
            # apply op1 then op2: p -> m2 @ (m1 @ p + t1) + t2
            m = m2 @ m1
            t = m2 @ t1 + t2
            match = None
            for i, (mi, ti) in enumerate(ops):
                if np.allclose(mi, m):
                    match = i
                    break
            assert match is not None, f"{symbol}: composed linear part not in point group"
            ti = ops[match][1]
            reduced = _fractional_translation(t - ti, symbol)
            assert np.allclose(reduced, np.zeros(2), atol=1e-6), (
                f"{symbol}: composition of ops not closed modulo lattice "
                f"(residual translation {t - ti})"
            )


@pytest.mark.parametrize("symbol", GROUP_SYMBOLS)
def test_coset_representatives_cartesian_count(symbol):
    a1, a2 = basis_vectors(WALLPAPER_GROUPS[symbol].lattice_kind, cell_size=1.0, ratio=1.3, angle_deg=80.0)
    reps = coset_representatives(symbol, a1, a2)
    assert len(reps) == EXPECTED_ORDER[symbol]
    # every representative must be an isometry (orthogonal linear part)
    for rep in reps:
        gram = rep.matrix.T @ rep.matrix
        assert np.allclose(gram, np.eye(2), atol=1e-8)
