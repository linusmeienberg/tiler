from __future__ import annotations

import numpy as np
import pytest

from tiler.domain import FundamentalDomain
from tiler.groups import GROUP_SYMBOLS
from tiler.render import generate_covering, svg_from_paths


def test_empty_domain_yields_no_covering():
    domain = FundamentalDomain(group="p4m")
    covering = generate_covering(domain, (-2, -2), (2, 2))
    assert covering == []


@pytest.mark.parametrize("symbol", GROUP_SYMBOLS)
def test_covering_fills_viewport_and_matches_orbit_size(symbol):
    domain = FundamentalDomain(group=symbol, cell_size=0.3)
    domain.add_path(np.array([[0.02, 0.0], [0.06, 0.04]]))

    vmin, vmax = (-1.0, -1.0), (1.0, 1.0)
    covering = generate_covering(domain, vmin, vmax, margin_cells=1)
    assert len(covering) > 0

    all_points = np.concatenate(covering, axis=0)
    # the covering should extend at least to the requested viewport in both axes
    assert all_points[:, 0].min() < vmin[0] + 0.5
    assert all_points[:, 0].max() > vmax[0] - 0.5
    assert all_points[:, 1].min() < vmin[1] + 0.5
    assert all_points[:, 1].max() > vmax[1] - 0.5


def test_svg_export_contains_one_path_per_copy():
    domain = FundamentalDomain(group="p1", cell_size=0.5)
    domain.add_path(np.array([[0.0, 0.0], [0.1, 0.1], [0.2, 0.0]]))
    covering = generate_covering(domain, (-0.5, -0.5), (0.5, 0.5), margin_cells=0)
    svg = svg_from_paths(covering, (-0.5, -0.5), (0.5, 0.5))
    assert svg.startswith("<svg")
    assert svg.count("<path") == len(covering)
