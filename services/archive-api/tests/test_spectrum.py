import math

import numpy as np
import pytest

from atlas_api.cache import BoundedTTLCache
from atlas_api.spectrum import observed_spectrum_payload


def test_spectrum_is_not_resampled_clipped_or_normalised():
    wavelength = np.linspace(4000, 7000, 200)
    flux = np.linspace(-3.5, 9.25, 200)
    ivar = np.full(200, 4.0)
    payload, validation = observed_spectrum_payload(
        wavelength,
        flux,
        ivar,
        wavelength_unit="Angstrom",
        flux_unit="test flux unit",
    )
    assert payload["wavelength"] == wavelength.tolist()
    assert payload["flux"] == flux.tolist()
    assert payload["inverse_variance"] == ivar.tolist()
    assert payload["processing"]["resampled"] is False
    assert payload["processing"]["clipped"] is False
    assert payload["processing"]["normalised"] is False
    assert validation["passed"] is True


def test_nonfinite_flux_is_explicit_null_not_silently_interpolated():
    wavelength = np.linspace(4000, 7000, 200)
    flux = np.ones(200)
    flux[20] = math.nan
    payload, validation = observed_spectrum_payload(
        wavelength,
        flux,
        None,
        wavelength_unit="Angstrom",
        flux_unit="test flux unit",
    )
    assert payload["flux"][20] is None
    assert payload["inverse_variance"][20] is None
    assert validation["checks"]["finite_flux_fraction"] == 0.995


def test_non_monotonic_wavelength_is_rejected():
    wavelength = np.linspace(4000, 7000, 200)
    wavelength[50] = wavelength[49]
    with pytest.raises(ValueError, match="strictly increasing"):
        observed_spectrum_payload(
            wavelength,
            np.ones(200),
            np.ones(200),
            wavelength_unit="Angstrom",
            flux_unit="test flux unit",
        )


def test_cache_has_hard_item_cap():
    cache = BoundedTTLCache[int](max_items=2, ttl_seconds=60)
    cache.set("one", 1)
    cache.set("two", 2)
    cache.set("three", 3)
    assert cache.get("one") is None
    assert cache.get("two") == 2
    assert cache.get("three") == 3
    assert cache.stats() == {"items": 2, "max_items": 2}
