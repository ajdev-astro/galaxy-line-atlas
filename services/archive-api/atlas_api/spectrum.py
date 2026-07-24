from __future__ import annotations

import math
from typing import Iterable

import numpy as np


def observed_spectrum_payload(
    wavelength: Iterable[float],
    flux: Iterable[float],
    inverse_variance: Iterable[float] | None,
    *,
    wavelength_unit: str,
    flux_unit: str,
    inverse_variance_unit: str | None = None,
    inverse_variance_origin: str = "released array",
) -> tuple[dict, dict]:
    """Serialize measured observed-frame pixels without clipping or resampling."""

    wave = np.asarray(wavelength, dtype=np.float64).reshape(-1)
    values = np.asarray(flux, dtype=np.float64).reshape(-1)
    if wave.size != values.size:
        raise ValueError("Wavelength and flux arrays have different lengths")

    if inverse_variance is None:
        ivar = np.full(wave.size, np.nan, dtype=np.float64)
    else:
        ivar = np.asarray(inverse_variance, dtype=np.float64).reshape(-1)
        if ivar.size != wave.size:
            raise ValueError("Inverse-variance and wavelength arrays have different lengths")

    finite_coordinates = np.isfinite(wave)
    removed_nonfinite_wavelength = int(np.count_nonzero(~finite_coordinates))
    wave = wave[finite_coordinates]
    values = values[finite_coordinates]
    ivar = ivar[finite_coordinates]

    if wave.size < 100:
        raise ValueError("Spectrum contains fewer than 100 finite wavelength pixels")

    strictly_increasing = bool(np.all(np.diff(wave) > 0))
    if not strictly_increasing:
        raise ValueError("Wavelength coordinates are not strictly increasing")

    finite_flux_fraction = float(np.count_nonzero(np.isfinite(values)) / values.size)
    positive_ivar_fraction = float(
        np.count_nonzero(np.isfinite(ivar) & (ivar > 0)) / ivar.size
    )

    def nullable(array: np.ndarray) -> list[float | None]:
        return [float(value) if math.isfinite(float(value)) else None for value in array]

    spectrum = {
        "frame": "observed",
        "wavelength": [float(value) for value in wave],
        "flux": nullable(values),
        "inverse_variance": nullable(ivar),
        "units": {
            "wavelength": wavelength_unit,
            "flux": flux_unit,
            "inverse_variance": (
                inverse_variance_unit or f"1 / ({flux_unit})^2"
            ),
        },
        "processing": {
            "resampled": False,
            "smoothed": False,
            "clipped": False,
            "normalised": False,
            "removed_nonfinite_wavelength_pixels": removed_nonfinite_wavelength,
            "inverse_variance_origin": inverse_variance_origin,
        },
    }
    validation = {
        "passed": strictly_increasing and finite_flux_fraction > 0.95,
        "checks": {
            "matching_array_lengths": True,
            "wavelength_strictly_increasing": strictly_increasing,
            "finite_flux_fraction": round(finite_flux_fraction, 6),
            "positive_inverse_variance_fraction": round(positive_ivar_fraction, 6),
            "pixel_count": int(wave.size),
        },
    }
    if not validation["passed"]:
        raise ValueError(f"Spectrum validation failed: {validation['checks']}")
    return spectrum, validation
