"""The fundamental domain: a motif (a set of vector paths) placed in one lattice cell."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .groups import GROUP_SYMBOLS, default_lattice_kind
from .lattice import basis_vectors


@dataclass
class FundamentalDomain:
    """A motif drawn inside one unit cell of a chosen wallpaper group's lattice.

    Coordinates of ``paths`` are Cartesian, in the same units as the lattice basis
    vectors (i.e. a point (1, 0) sits at the tip of a1 when cell_size=1).
    """

    group: str = "p1"
    cell_size: float = 1.0
    ratio: float = 1.0
    angle_deg: float = 70.0
    paths: list[np.ndarray] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.group not in GROUP_SYMBOLS:
            raise ValueError(f"unknown wallpaper group: {self.group!r}")

    @property
    def lattice_kind(self):
        return default_lattice_kind(self.group)

    @property
    def basis(self) -> tuple[np.ndarray, np.ndarray]:
        return basis_vectors(
            self.lattice_kind,
            cell_size=self.cell_size,
            ratio=self.ratio,
            angle_deg=self.angle_deg,
        )

    def add_path(self, points: np.ndarray) -> None:
        points = np.asarray(points, dtype=float).reshape(-1, 2)
        if len(points) >= 2:
            self.paths.append(points)

    def undo(self) -> None:
        if self.paths:
            self.paths.pop()

    def clear(self) -> None:
        self.paths.clear()

    def set_group(self, symbol: str) -> None:
        if symbol not in GROUP_SYMBOLS:
            raise ValueError(f"unknown wallpaper group: {symbol!r}")
        self.group = symbol
