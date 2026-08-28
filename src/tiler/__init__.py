"""tiler: interactively place a fundamental domain and preview the resulting wallpaper covering."""
from .domain import FundamentalDomain
from .groups import GROUP_SYMBOLS, WALLPAPER_GROUPS, coset_representatives
from .lattice import LatticeKind, basis_vectors
from .render import generate_covering, svg_from_paths
from .transforms import Affine2D

__all__ = [
    "GROUP_SYMBOLS",
    "WALLPAPER_GROUPS",
    "Affine2D",
    "FundamentalDomain",
    "LatticeKind",
    "basis_vectors",
    "coset_representatives",
    "generate_covering",
    "svg_from_paths",
]


def __getattr__(name: str):
    if name == "TilerWidget":
        from .widget import TilerWidget

        return TilerWidget
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
