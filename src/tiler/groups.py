"""The 17 wallpaper groups: lattice type + coset representatives of the point group.

Each group is defined by a list of "fractional" operations (linear part + translation,
expressed in units of the lattice basis vectors a1, a2) that, together with the lattice
translations, generate the full symmetry group. These are the standard coset
representatives used to build the covering of the plane from a motif placed in one cell:
for every lattice translation vector t and every representative (M, c), the map

    p -> M @ p + c + t   (t in Cartesian units, c converted from fractional to Cartesian)

is a symmetry of the pattern.

The fractional-coordinate tables below were constructed from the standard plane-group
generators and verified computationally (closure under composition modulo the lattice,
and matching the known point-group order of every one of the 17 groups) before being
hard-coded here; see ``tests/test_groups.py`` for the same verification re-run against
this module.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .lattice import LatticeKind
from .transforms import Affine2D

# --- reusable fractional-coordinate building blocks -------------------------------

_I = np.array([[1, 0], [0, 1]])
_R180 = np.array([[-1, 0], [0, -1]])
_MX = np.array([[1, 0], [0, -1]])  # mirror across the a1 axis (reflect the a2 coord)
_MY = np.array([[-1, 0], [0, 1]])  # mirror across the a2 axis (reflect the a1 coord)


def _rot90(k: int) -> np.ndarray:
    """k * 90 degree rotation, valid in fractional coords for an orthonormal (square) basis."""
    return [
        np.array([[1, 0], [0, 1]]),
        np.array([[0, -1], [1, 0]]),
        np.array([[-1, 0], [0, -1]]),
        np.array([[0, 1], [-1, 0]]),
    ][k % 4]


# 3-fold / 6-fold rotations, valid in fractional coords for the hexagonal basis
# a1 = (1, 0), a2 = (1/2, sqrt(3)/2). Derived from the Cartesian rotation matrices via
# a change of basis (B^-1 R B), which yields these exact integer matrices.
_R3 = np.array([[-1, -1], [1, 0]])
_R6 = np.array([[0, -1], [1, 1]])
_MHEX_A = np.array([[1, 1], [0, -1]])  # mirror through the origin, parallel to a1
_MHEX_B = np.array([[0, 1], [1, 0]])  # mirror through the origin, bisecting a1 and a2

_HALF = 0.5
_Z = np.zeros(2)


@dataclass(frozen=True)
class GroupDef:
    symbol: str
    orbifold: str
    lattice_kind: LatticeKind
    frac_ops: tuple[tuple[np.ndarray, np.ndarray], ...]


def _ops(*pairs: tuple[np.ndarray, np.ndarray]) -> tuple[tuple[np.ndarray, np.ndarray], ...]:
    return tuple((m, np.asarray(t, dtype=float)) for m, t in pairs)


WALLPAPER_GROUPS: dict[str, GroupDef] = {
    "p1": GroupDef("p1", "o", LatticeKind.OBLIQUE, _ops((_I, _Z))),
    "p2": GroupDef("p2", "2222", LatticeKind.OBLIQUE, _ops((_I, _Z), (_R180, _Z))),
    "pm": GroupDef("pm", "**", LatticeKind.RECTANGULAR, _ops((_I, _Z), (_MX, _Z))),
    "pg": GroupDef(
        "pg", "xx", LatticeKind.RECTANGULAR, _ops((_I, _Z), (_MX, [_HALF, 0.0]))
    ),
    "cm": GroupDef(
        "cm", "*x", LatticeKind.CENTERED_RECTANGULAR, _ops((_I, _Z), (_MX, _Z))
    ),
    "pmm": GroupDef(
        "pmm",
        "*2222",
        LatticeKind.RECTANGULAR,
        _ops((_I, _Z), (_MX, _Z), (_MY, _Z), (_R180, _Z)),
    ),
    "pmg": GroupDef(
        "pmg",
        "22*",
        LatticeKind.RECTANGULAR,
        _ops(
            (_I, _Z),
            (_R180, _Z),
            (_MY, [_HALF, 0.0]),
            (_MX, [_HALF, 0.0]),
        ),
    ),
    "pgg": GroupDef(
        "pgg",
        "22x",
        LatticeKind.RECTANGULAR,
        _ops(
            (_I, _Z),
            (_R180, _Z),
            (_MX, [_HALF, _HALF]),
            (_MY, [_HALF, _HALF]),
        ),
    ),
    "cmm": GroupDef(
        "cmm",
        "2*22",
        LatticeKind.CENTERED_RECTANGULAR,
        _ops((_I, _Z), (_MX, _Z), (_MY, _Z), (_R180, _Z)),
    ),
    "p4": GroupDef("p4", "442", LatticeKind.SQUARE, _ops((_rot90(0), _Z), (_rot90(1), _Z), (_rot90(2), _Z), (_rot90(3), _Z))),
    "p4m": GroupDef(
        "p4m",
        "*442",
        LatticeKind.SQUARE,
        _ops(
            *[(_rot90(k), _Z) for k in range(4)],
            *[(_MX @ _rot90(k), _Z) for k in range(4)],
        ),
    ),
    "p4g": GroupDef(
        "p4g",
        "4*2",
        LatticeKind.SQUARE,
        _ops(
            *[(_rot90(k), _Z) for k in range(4)],
            *[(_MX @ _rot90(k), [_HALF, _HALF]) for k in range(4)],
        ),
    ),
    "p3": GroupDef("p3", "333", LatticeKind.HEXAGONAL, _ops((_I, _Z), (_R3, _Z), (_R3 @ _R3, _Z))),
    "p3m1": GroupDef(
        "p3m1",
        "*333",
        LatticeKind.HEXAGONAL,
        _ops(
            *[(np.linalg.matrix_power(_R3, k), _Z) for k in range(3)],
            *[(_MHEX_A @ np.linalg.matrix_power(_R3, k), _Z) for k in range(3)],
        ),
    ),
    "p31m": GroupDef(
        "p31m",
        "3*3",
        LatticeKind.HEXAGONAL,
        _ops(
            *[(np.linalg.matrix_power(_R3, k), _Z) for k in range(3)],
            *[(_MHEX_B @ np.linalg.matrix_power(_R3, k), _Z) for k in range(3)],
        ),
    ),
    "p6": GroupDef(
        "p6", "632", LatticeKind.HEXAGONAL, _ops(*[(np.linalg.matrix_power(_R6, k), _Z) for k in range(6)])
    ),
    "p6m": GroupDef(
        "p6m",
        "*632",
        LatticeKind.HEXAGONAL,
        _ops(
            *[(np.linalg.matrix_power(_R6, k), _Z) for k in range(6)],
            *[(_MHEX_A @ np.linalg.matrix_power(_R6, k), _Z) for k in range(6)],
        ),
    ),
}

GROUP_SYMBOLS: tuple[str, ...] = (
    "p1", "p2", "pm", "pg", "cm", "pmm", "pmg", "pgg", "cmm",
    "p4", "p4m", "p4g", "p3", "p3m1", "p31m", "p6", "p6m",
)


def coset_representatives(symbol: str, a1: np.ndarray, a2: np.ndarray) -> list[Affine2D]:
    """Coset representatives of the point group, as Cartesian affine transforms.

    Applying every representative to a motif placed at the origin, then translating
    by every lattice vector, produces the full covering of the plane.
    """
    group = WALLPAPER_GROUPS[symbol]
    basis = np.column_stack([a1, a2])  # columns are a1, a2
    basis_inv = np.linalg.inv(basis)
    ops = []
    for m_frac, t_frac in group.frac_ops:
        matrix = basis @ m_frac @ basis_inv
        translation = basis @ np.asarray(t_frac, dtype=float)
        ops.append(Affine2D(matrix, translation))
    return ops


def default_lattice_kind(symbol: str) -> LatticeKind:
    return WALLPAPER_GROUPS[symbol].lattice_kind
