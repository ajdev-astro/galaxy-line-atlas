from __future__ import annotations

import os
import threading
from urllib.parse import urlencode

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .cache import BoundedTTLCache
from .providers import LEGACY_CUTOUT, SEARCHERS, SPECTRA, UpstreamError


API_VERSION = "0.1.0"
MAX_RESULTS = 100
UPSTREAM_SLOTS = max(1, int(os.getenv("ATLAS_UPSTREAM_CONCURRENCY", "2")))
SPECTRUM_CACHE_ITEMS = max(0, int(os.getenv("ATLAS_SPECTRUM_CACHE_ITEMS", "8")))
SEARCH_CACHE_ITEMS = max(0, int(os.getenv("ATLAS_SEARCH_CACHE_ITEMS", "32")))

upstream_semaphore = threading.BoundedSemaphore(UPSTREAM_SLOTS)
spectrum_cache: BoundedTTLCache[dict] = BoundedTTLCache(
    SPECTRUM_CACHE_ITEMS, ttl_seconds=3600
)
search_cache: BoundedTTLCache[dict] = BoundedTTLCache(
    SEARCH_CACHE_ITEMS, ttl_seconds=300
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "ATLAS_ALLOWED_ORIGINS",
        "http://localhost:3000,https://ajdev-astro.github.io",
    ).split(",")
    if origin.strip()
]

app = FastAPI(
    title="Line / Atlas on-demand archive API",
    version=API_VERSION,
    description=(
        "Thin adapters over authoritative public survey services. "
        "No bulk spectrum or image mirror."
    ),
)
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def normalize_class(survey: str, class_name: str) -> str | None:
    value = class_name.strip().upper()
    if value in ("", "ALL"):
        return None
    allowed = {
        "sdss": {"GALAXY", "QSO", "STAR"},
        "desi": {"GALAXY", "QSO", "STAR"},
        "gama": set(),
    }
    if value not in allowed[survey]:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{survey.upper()} class must be "
                f"{', '.join(sorted(allowed[survey])) or 'all'}"
            ),
        )
    return value


def call_upstream(function, **kwargs):
    acquired = upstream_semaphore.acquire(timeout=2)
    if not acquired:
        raise HTTPException(
            status_code=503,
            detail="The archive adapter is busy; retry shortly.",
        )
    try:
        return function(**kwargs)
    except (ValueError, UpstreamError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"Authoritative survey service failed: {type(error).__name__}",
        ) from error
    finally:
        upstream_semaphore.release()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": API_VERSION,
        "storage_mode": "no persistent storage",
        "cache": {
            "spectra": spectrum_cache.stats(),
            "searches": search_cache.stats(),
        },
        "upstream_concurrency": UPSTREAM_SLOTS,
    }


@app.get("/v1/sources")
def sources():
    return {
        "schema_version": "1.0",
        "surveys": {
            "sdss": {
                "release": "DR18",
                "catalogue": "SkyServer SpecObj / SpecObjAll",
                "spectra": "SDSS SAS URL resolved by DR18 Explore",
                "documentation": "https://www.sdss.org/dr18/data_access/",
            },
            "desi": {
                "release": "DR1",
                "catalogue": "NOIRLab SPARCL DESI-DR1",
                "spectra": "NOIRLab SPARCL DESI-DR1",
                "documentation": "https://data.desi.lbl.gov/doc/access/",
            },
            "gama": {
                "release": "DR4",
                "catalogue": "GaussFitSimplev05 + SpecAllv27",
                "spectra": "released DR4 FITS URL from SpecAllv27",
                "documentation": "https://www.gama-survey.org/dr4/",
            },
        },
        "policy": {
            "catalogue_labels_are_returned_verbatim": True,
            "derived_physical_classes": False,
            "spectra_are_observed_frame": True,
            "spectra_are_resampled": False,
            "spectra_are_clipped": False,
        },
    }


@app.get("/v1/search")
def search(
    response: Response,
    survey: str = Query(pattern="^(sdss|desi|gama)$"),
    z_min: float = Query(default=0.0, ge=-0.01, le=10),
    z_max: float = Query(default=1.0, ge=0, le=10),
    class_name: str = Query(default="GALAXY", alias="class"),
    limit: int = Query(default=25, ge=1, le=MAX_RESULTS),
):
    if z_min >= z_max:
        raise HTTPException(status_code=422, detail="z_min must be less than z_max")
    normalized_class = normalize_class(survey, class_name)
    key = f"{survey}|{z_min:.8f}|{z_max:.8f}|{normalized_class}|{limit}"
    cached = search_cache.get(key)
    if cached is not None:
        response.headers["X-Atlas-Cache"] = "HIT"
        return cached
    payload = call_upstream(
        SEARCHERS[survey],
        z_min=z_min,
        z_max=z_max,
        class_name=normalized_class,
        limit=limit,
    )
    payload["schema_version"] = "1.0"
    payload["result_count"] = len(payload["results"])
    payload["interpretation"] = (
        "Catalogue fields and quality flags are reported from the named source. "
        "No physical class has been inferred by Line / Atlas."
    )
    search_cache.set(key, payload)
    response.headers["X-Atlas-Cache"] = "MISS"
    response.headers["Cache-Control"] = "public, max-age=300"
    return payload


@app.get("/v1/spectra/{survey}/{identifier}")
def spectrum(
    response: Response,
    survey: str,
    identifier: str,
):
    if survey not in SPECTRA:
        raise HTTPException(status_code=404, detail="Unknown survey")
    key = f"{survey}|{identifier}"
    cached = spectrum_cache.get(key)
    if cached is not None:
        response.headers["X-Atlas-Cache"] = "HIT"
        return cached
    payload = call_upstream(SPECTRA[survey], **{
        {"sdss": "specobjid", "desi": "sparcl_id", "gama": "specid"}[survey]:
            identifier
    })
    payload["schema_version"] = "1.0"
    spectrum_cache.set(key, payload)
    response.headers["X-Atlas-Cache"] = "MISS"
    response.headers["Cache-Control"] = "public, max-age=3600"
    return payload


@app.get("/v1/cutout-url")
def cutout_url(
    ra: float = Query(ge=0, lt=360),
    dec: float = Query(ge=-90, le=90),
    size: int = Query(default=360, ge=64, le=512),
):
    query = urlencode(
        {
            "ra": f"{ra:.8f}",
            "dec": f"{dec:.8f}",
            "layer": "ls-dr10",
            "pixscale": "0.262",
            "size": size,
        }
    )
    return {
        "url": f"{LEGACY_CUTOUT}?{query}",
        "source": "DESI Legacy Imaging Surveys DR10 official JPEG cutout",
        "documentation": "https://www.legacysurvey.org/dr10/description/",
        "stored_by_line_atlas": False,
    }
