"""2D affine transforms used to map the fundamental domain motif across the plane."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Affine2D:
    """p -> matrix @ p + translation, applied to Cartesian (x, y) points."""

    matrix: np.ndarray  # shape (2, 2)
    translation: np.ndarray  # shape (2,)

    def __post_init__(self) -> None:
        matrix = np.asarray(self.matrix, dtype=float).reshape(2, 2)
        translation = np.asarray(self.translation, dtype=float).reshape(2)
        object.__setattr__(self, "matrix", matrix)
        object.__setattr__(self, "translation", translation)

    @staticmethod
    def identity() -> Affine2D:
        return Affine2D(np.eye(2), np.zeros(2))

    def apply(self, points: np.ndarray) -> np.ndarray:
        """Apply to an (N, 2) array of points, returning an (N, 2) array."""
        points = np.asarray(points, dtype=float).reshape(-1, 2)
        return points @ self.matrix.T + self.translation

    def then(self, other: Affine2D) -> Affine2D:
        """Return the transform that applies self first, then other."""
        matrix = other.matrix @ self.matrix
        translation = other.matrix @ self.translation + other.translation
        return Affine2D(matrix, translation)

    def translated(self, offset: np.ndarray) -> Affine2D:
        return Affine2D(self.matrix, self.translation + np.asarray(offset, dtype=float))
