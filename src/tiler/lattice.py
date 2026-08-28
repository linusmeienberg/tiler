"""Lattice geometry: the five 2D Bravais lattice types and their basis vectors."""
from __future__ import annotations

import math
from collections.abc import Iterator
from enum import Enum

import numpy as np


class LatticeKind(str, Enum):
    OBLIQUE = "oblique"
    RECTANGULAR = "rectangular"
    CENTERED_RECTANGULAR = "centered_rectangular"
    SQUARE = "square"
    HEXAGONAL = "hexagonal"


def basis_vectors(
    kind: LatticeKind,
    cell_size: float = 1.0,
    ratio: float = 1.0,
    angle_deg: float = 70.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Return the (a1, a2) Cartesian lattice vectors for a given lattice kind.

    cell_size scales the whole cell uniformly. ``ratio`` is |a2| / |a1| and only
    applies to oblique/rectangular/centered-rectangular lattices. ``angle_deg`` is
    the angle between a1 and a2 and only applies to the oblique lattice.
    """
    if kind == LatticeKind.OBLIQUE:
        a1 = np.array([1.0, 0.0])
        theta = math.radians(angle_deg)
        a2 = ratio * np.array([math.cos(theta), math.sin(theta)])
    elif kind in (LatticeKind.RECTANGULAR, LatticeKind.CENTERED_RECTANGULAR):
        a1 = np.array([1.0, 0.0])
        a2 = np.array([0.0, ratio])
    elif kind == LatticeKind.SQUARE:
        a1 = np.array([1.0, 0.0])
        a2 = np.array([0.0, 1.0])
    elif kind == LatticeKind.HEXAGONAL:
        a1 = np.array([1.0, 0.0])
        a2 = np.array([0.5, math.sqrt(3) / 2])
    else:  # pragma: no cover - exhaustive enum
        raise ValueError(f"unknown lattice kind: {kind}")
    return cell_size * a1, cell_size * a2


def centering_offsets(kind: LatticeKind) -> list[np.ndarray]:
    """Fractional-coordinate offsets (in units of a1, a2) of extra lattice points."""
    if kind == LatticeKind.CENTERED_RECTANGULAR:
        return [np.array([0.0, 0.0]), np.array([0.5, 0.5])]
    return [np.array([0.0, 0.0])]


def lattice_translations(
    kind: LatticeKind,
    a1: np.ndarray,
    a2: np.ndarray,
    m_range: range,
    n_range: range,
) -> Iterator[np.ndarray]:
    """Yield Cartesian translation vectors of the lattice over the given integer ranges."""
    offsets = centering_offsets(kind)
    for m in m_range:
        for n in n_range:
            for ox, oy in offsets:
                yield (m + ox) * a1 + (n + oy) * a2


def cell_range_for_viewport(
    a1: np.ndarray,
    a2: np.ndarray,
    viewport_min: np.ndarray,
    viewport_max: np.ndarray,
    margin_cells: int = 1,
) -> tuple[range, range]:
    """Compute integer (m, n) ranges of lattice translations needed to cover a viewport."""
    basis = np.column_stack([a1, a2])
    basis_inv = np.linalg.inv(basis)
    corners = np.array(
        [
            [viewport_min[0], viewport_min[1]],
            [viewport_min[0], viewport_max[1]],
            [viewport_max[0], viewport_min[1]],
            [viewport_max[0], viewport_max[1]],
        ]
    )
    fractional = corners @ basis_inv.T
    m_min = math.floor(fractional[:, 0].min()) - margin_cells
    m_max = math.ceil(fractional[:, 0].max()) + margin_cells
    n_min = math.floor(fractional[:, 1].min()) - margin_cells
    n_max = math.ceil(fractional[:, 1].max()) + margin_cells
    return range(m_min, m_max + 1), range(n_min, n_max + 1)
