from __future__ import annotations

import csv
import html
import io
import re
import sys
import types
from datetime import UTC, datetime
from urllib.parse import urljoin

import numpy as np
import requests
from astropy.io import fits

from .spectrum import observed_spectrum_payload


SDSS_SQL = "https://skyserver.sdss.org/dr18/SkyServerWS/SearchTools/SqlSearch"
SDSS_EXPLORE = "https://skyserver.sdss.org/dr18/VisualTools/explore/summary"
SDSS_FITS_PAGE = "https://skyserver.sdss.org/dr18/VisualTools/explore/fitsspec"
GAMA_QUERY = "https://www.gama-survey.org/dr4/query/index.php"
GAMA_ROOT = "https://www.gama-survey.org"
LEGACY_CUTOUT = "https://www.legacysurvey.org/viewer/jpeg-cutout"

SESSION = requests.Session()
SESSION.headers["User-Agent"] = (
    "Line-Atlas-On-Demand/0.1 "
    "(educational viewer; public survey data are never bulk mirrored)"
)


class UpstreamError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def read_csv_response(response: requests.Response) -> list[dict[str, str]]:
    response.raise_for_status()
    text = response.text
    if text.startswith("#Table"):
        text = text.split("\n", 1)[1]
    return list(csv.DictReader(io.StringIO(text)))


def source_link(label: str, url: str) -> dict[str, str]:
    return {"label": label, "url": url}


def search_sdss(
    *, z_min: float, z_max: float, class_name: str | None, limit: int
) -> dict:
    conditions = [
        f"s.z >= {z_min:.8f}",
        f"s.z <= {z_max:.8f}",
        "s.zWarning = 0",
    ]
    if class_name:
        conditions.append(f"s.class = '{class_name}'")
    sql = f"""
        SELECT TOP {limit}
          s.specObjID, s.ra, s.dec, s.z, s.zErr, s.zWarning,
          s.class, s.subClass, s.plate, s.mjd, s.fiberID
        FROM SpecObj s
        WHERE {' AND '.join(conditions)}
        ORDER BY s.specObjID
    """
    response = SESSION.get(
        SDSS_SQL,
        params={"cmd": " ".join(sql.split()), "format": "csv"},
        timeout=60,
    )
    rows = read_csv_response(response)
    results = [
        {
            "id": str(row["specObjID"]),
            "display_id": (
                f"{int(row['plate']):04d}-{int(row['mjd'])}-"
                f"{int(row['fiberID']):04d}"
            ),
            "ra_deg": float(row["ra"]),
            "dec_deg": float(row["dec"]),
            "redshift": float(row["z"]),
            "redshift_error": float(row["zErr"]),
            "catalog_class": row["class"].strip(),
            "catalog_subclass": row["subClass"].strip(),
            "quality": {
                "zWarning": int(row["zWarning"]),
                "selection": "SpecObj clean primary view; zWarning = 0",
            },
        }
        for row in rows
    ]
    return {
        "survey": "sdss",
        "release": "DR18 SkyServer",
        "results": results,
        "provenance": {
            "retrieved_at": utc_now(),
            "catalogue": "SkyServer SpecObj",
            "query": " ".join(sql.split()),
            "sources": [
                source_link("SDSS DR18 SkyServer SQL service", response.url),
                source_link("SDSS DR18 data access", "https://www.sdss.org/dr18/data_access/"),
            ],
        },
    }


def _sdss_metadata(specobjid: str) -> dict:
    if not specobjid.isdigit():
        raise ValueError("SDSS specObjID must contain digits only")
    sql = f"""
        SELECT TOP 1 s.specObjID, s.ra, s.dec, s.z, s.zErr, s.zWarning,
          s.class, s.subClass, s.plate, s.mjd, s.fiberID
        FROM SpecObjAll s WHERE s.specObjID = {specobjid}
    """
    response = SESSION.get(
        SDSS_SQL,
        params={"cmd": " ".join(sql.split()), "format": "csv"},
        timeout=60,
    )
    rows = read_csv_response(response)
    if len(rows) != 1:
        raise UpstreamError(f"SDSS returned {len(rows)} rows for specObjID {specobjid}")
    return rows[0]


def _sdss_fits_url(specobjid: str) -> str:
    response = SESSION.get(
        SDSS_FITS_PAGE,
        params={"spec": specobjid},
        timeout=60,
    )
    response.raise_for_status()
    matches = re.findall(
        r"https?://[A-Za-z0-9./_-]*sdss[A-Za-z0-9./_-]*\.fits",
        response.text,
        flags=re.IGNORECASE,
    )
    if not matches:
        raise UpstreamError("SDSS Explore did not expose a canonical FITS URL")
    url = matches[0].replace("http://", "https://")
    if not url.startswith(("https://dr", "https://data.sdss.org/")):
        raise UpstreamError("SDSS Explore returned an unexpected FITS host")
    return url


def spectrum_sdss(specobjid: str) -> dict:
    row = _sdss_metadata(specobjid)
    fits_url = _sdss_fits_url(specobjid)
    response = SESSION.get(fits_url, timeout=120)
    response.raise_for_status()
    with fits.open(io.BytesIO(response.content), memmap=False) as hdul:
        bunit = str(hdul[0].header.get("BUNIT", "")).strip()
        if bunit.lower() != "1e-17 erg/cm^2/s/ang":
            raise UpstreamError(f"Unexpected SDSS flux unit: {bunit or 'missing'}")
        table = hdul[1].data
        spectrum, validation = observed_spectrum_payload(
            10 ** np.asarray(table["loglam"], dtype=float),
            np.asarray(table["flux"], dtype=float),
            np.asarray(table["ivar"], dtype=float),
            wavelength_unit="Angstrom",
            flux_unit="1e-17 erg s-1 cm-2 Angstrom-1",
        )
    return {
        "survey": "sdss",
        "release": "SDSS legacy spectrum resolved by DR18 Explore",
        "object": {
            "id": str(row["specObjID"]),
            "display_id": (
                f"{int(row['plate']):04d}-{int(row['mjd'])}-"
                f"{int(row['fiberID']):04d}"
            ),
            "ra_deg": float(row["ra"]),
            "dec_deg": float(row["dec"]),
            "redshift": float(row["z"]),
            "redshift_error": float(row["zErr"]),
            "catalog_class": row["class"].strip(),
            "catalog_subclass": row["subClass"].strip(),
            "quality": {"zWarning": int(row["zWarning"])},
        },
        "spectrum": spectrum,
        "validation": validation,
        "provenance": {
            "retrieved_at": utc_now(),
            "catalogue": "SkyServer SpecObjAll exact specObjID lookup",
            "spectrum_url": fits_url,
            "sources": [
                source_link("SDSS catalogue record", f"{SDSS_EXPLORE}?sid={specobjid}"),
                source_link("SDSS source FITS", fits_url),
            ],
        },
    }


def _gama_download(sql: str) -> tuple[list[dict[str, str]], str]:
    normalized_sql = " ".join(sql.split())
    if "<" in normalized_sql:
        raise ValueError(
            "GAMA DR4 truncates literal '<' operators; rewrite the condition "
            "with BETWEEN, NOT, or a reversed '>' comparison"
        )
    response = SESSION.post(
        GAMA_QUERY,
        data={
            "query": normalized_sql,
            "format": "csv",
            "nshow": "100",
            "ndownload": "2000",
            "nsov": "1000",
        },
        timeout=90,
    )
    response.raise_for_status()
    echoed_match = re.search(
        r'Your query:<br>\s*<span class="query">(.*?)</span>',
        response.text,
        flags=re.DOTALL,
    )
    if not echoed_match:
        raise UpstreamError("GAMA did not echo the submitted query")
    echoed_sql = " ".join(html.unescape(echoed_match.group(1)).split())
    if echoed_sql != normalized_sql:
        raise UpstreamError(
            "GAMA altered or truncated the submitted query; result rejected"
        )
    match = re.search(r'href="\.\./tmp/(GAMA_[A-Za-z0-9]+\.csv)"', response.text)
    if not match:
        raise UpstreamError("GAMA query did not provide its CSV result")
    download_url = urljoin(f"{GAMA_ROOT}/dr4/", f"tmp/{match.group(1)}")
    catalog = SESSION.get(download_url, timeout=60)
    return read_csv_response(catalog), download_url


def search_gama(
    *, z_min: float, z_max: float, class_name: str | None, limit: int
) -> dict:
    if class_name:
        raise ValueError(
            "GAMA archive search does not invent a class label; use class=all"
        )
    sql = f"""
        SELECT
          g.SPECID AS id, g.CATAID AS cataid, g.RA AS ra,
          g.`DEC` AS declination, g.Z AS redshift, g.NQ AS nq,
          g.SN AS continuum_sn, g.D4000N AS d4000,
          s.GAMA_NAME AS gama_name, s.URL AS spectrum_url
        FROM GaussFitSimplev05 g
        JOIN SpecAllv27 s ON s.SPECID = g.SPECID
        WHERE g.SURVEY = 'GAMA' AND g.NQ > 2 AND g.IS_BEST = 1
          AND g.Z BETWEEN {z_min:.8f} AND {z_max:.8f}
        ORDER BY g.SPECID
        LIMIT {limit}
    """
    rows, download_url = _gama_download(sql)
    results = [
        {
            "id": row["id"],
            "display_id": row["gama_name"],
            "ra_deg": float(row["ra"]),
            "dec_deg": float(row["declination"]),
            "redshift": float(row["redshift"]),
            "redshift_error": None,
            "catalog_class": None,
            "catalog_subclass": None,
            "measurements": {
                "CATAID": row["cataid"],
                "continuum_SN": float(row["continuum_sn"]),
                "D4000N": float(row["d4000"]),
            },
            "quality": {
                "NQ": int(row["nq"]),
                "selection": "SURVEY = GAMA; IS_BEST = 1; NQ > 2",
            },
        }
        for row in rows
    ]
    return {
        "survey": "gama",
        "release": "GAMA DR4",
        "results": results,
        "provenance": {
            "retrieved_at": utc_now(),
            "catalogue": "GaussFitSimplev05 joined to SpecAllv27 by SPECID",
            "query": " ".join(sql.split()),
            "sources": [
                source_link("GAMA DR4 query result", download_url),
                source_link("GAMA DR4", "https://www.gama-survey.org/dr4/"),
            ],
        },
    }


def _gama_metadata(specid: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_]+", specid):
        raise ValueError("Unexpected GAMA SPECID format")
    sql = f"""
        SELECT
          g.SPECID AS id, g.CATAID AS cataid, g.RA AS ra,
          g.`DEC` AS declination, g.Z AS redshift, g.NQ AS nq,
          g.SN AS continuum_sn, g.D4000N AS d4000,
          s.GAMA_NAME AS gama_name, s.URL AS spectrum_url
        FROM GaussFitSimplev05 g
        JOIN SpecAllv27 s ON s.SPECID = g.SPECID
        WHERE g.SPECID = '{specid}'
        LIMIT 2
    """
    rows, _ = _gama_download(sql)
    if len(rows) != 1:
        raise UpstreamError(f"GAMA returned {len(rows)} rows for SPECID {specid}")
    return rows[0]


def spectrum_gama(specid: str) -> dict:
    row = _gama_metadata(specid)
    fits_url = row["spectrum_url"].replace("http://", "https://")
    response = SESSION.get(fits_url, timeout=120)
    response.raise_for_status()
    with fits.open(io.BytesIO(response.content), memmap=False) as hdul:
        header = hdul[0].header
        if (
            str(header.get("ROW1", "")).strip().lower() != "spectrum"
            or str(header.get("ROW2", "")).strip().lower() != "error"
            or str(header.get("CUNIT1", "")).strip().lower() != "angstrom"
        ):
            raise UpstreamError("Unexpected GAMA DR4 FITS array or wavelength layout")
        data = np.asarray(hdul[0].data, dtype=float)
        if data.ndim != 2 or data.shape[0] < 2:
            raise UpstreamError("Unexpected GAMA DR4 spectrum array shape")
        pixels = np.arange(data.shape[1], dtype=float)
        wavelength = (
            header["CRVAL1"]
            + (pixels + 1 - header["CRPIX1"]) * header["CD1_1"]
        )
        flux = data[0]
        error = data[1]
        ivar = np.full_like(error, np.nan)
        positive_error = np.isfinite(error) & (error > 0)
        ivar[positive_error] = 1 / error[positive_error] ** 2
        spectrum, validation = observed_spectrum_payload(
            wavelength,
            flux,
            ivar,
            wavelength_unit="Angstrom",
            flux_unit="1e-17 erg s-1 cm-2 Angstrom-1",
            inverse_variance_origin="derived from released 1-sigma error row",
        )
    return {
        "survey": "gama",
        "release": "GAMA DR4",
        "object": {
            "id": row["id"],
            "display_id": row["gama_name"],
            "ra_deg": float(row["ra"]),
            "dec_deg": float(row["declination"]),
            "redshift": float(row["redshift"]),
            "redshift_error": None,
            "catalog_class": None,
            "catalog_subclass": None,
            "measurements": {
                "CATAID": row["cataid"],
                "continuum_SN": float(row["continuum_sn"]),
                "D4000N": float(row["d4000"]),
            },
            "quality": {"NQ": int(row["nq"])},
        },
        "spectrum": spectrum,
        "validation": validation,
        "provenance": {
            "retrieved_at": utc_now(),
            "catalogue": "GaussFitSimplev05 joined to SpecAllv27 by SPECID",
            "spectrum_url": fits_url,
            "sources": [
                source_link("GAMA DR4", "https://www.gama-survey.org/dr4/"),
                source_link("GAMA source FITS", fits_url),
            ],
        },
    }


def sparcl_client():
    if "specutils" not in sys.modules:
        module = types.ModuleType("specutils")
        module.Spectrum = type("Spectrum", (), {})
        module.SpectrumCollection = type("SpectrumCollection", (), {})
        module.SpectrumList = list
        sys.modules["specutils"] = module
    from sparcl.client import SparclClient

    return SparclClient(announcement=False)


def search_desi(
    *, z_min: float, z_max: float, class_name: str | None, limit: int
) -> dict:
    constraints: dict[str, list] = {
        "data_release": ["DESI-DR1"],
        "redshift": [z_min, z_max],
        "redshift_warning": [0, 0],
    }
    if class_name:
        constraints["spectype"] = [class_name]
    fields = [
        "sparcl_id",
        "targetid",
        "ra",
        "dec",
        "redshift",
        "redshift_warning",
        "spectype",
        "survey",
    ]
    found = sparcl_client().find(
        outfields=fields,
        constraints=constraints,
        limit=limit,
    )
    results = [
        {
            "id": row["sparcl_id"],
            "display_id": f"TARGETID {row['targetid']}",
            "targetid": str(row["targetid"]),
            "ra_deg": float(row["ra"]),
            "dec_deg": float(row["dec"]),
            "redshift": float(row["redshift"]),
            "redshift_error": None,
            "catalog_class": row["spectype"],
            "catalog_subclass": None,
            "measurements": {
                "survey": row["survey"],
            },
            "quality": {
                "redshift_warning": int(row["redshift_warning"]),
                "selection": "data_release = DESI-DR1; redshift_warning = 0",
            },
        }
        for row in found.records
    ]
    return {
        "survey": "desi",
        "release": "DESI DR1 via SPARCL",
        "results": results,
        "provenance": {
            "retrieved_at": utc_now(),
            "catalogue": "NOIRLab SPARCL DESI-DR1 searchable metadata",
            "query": constraints,
            "sources": [
                source_link("DESI DR1", "https://data.desi.lbl.gov/doc/releases/dr1/"),
                source_link("DESI SPARCL access", "https://data.desi.lbl.gov/doc/access/"),
            ],
        },
    }


def spectrum_desi(sparcl_id: str) -> dict:
    include = [
        "sparcl_id",
        "targetid",
        "ra",
        "dec",
        "redshift",
        "redshift_warning",
        "spectype",
        "survey",
        "wavelength",
        "flux",
        "ivar",
    ]
    retrieved = sparcl_client().retrieve(
        [sparcl_id],
        include=include,
        dataset_list=["DESI-DR1"],
        limit=1,
        units=True,
    )
    if len(retrieved.records) != 1:
        raise UpstreamError(
            f"SPARCL returned {len(retrieved.records)} records for {sparcl_id}"
        )
    row = retrieved.records[0]
    units = retrieved.hdr.get("UNITS", {}).get("DESI-DR1", {})
    if units.get("wavelength") != "AA" or units.get("flux") != (
        "1e-17 erg cm-2 s-1 AA-1"
    ):
        raise UpstreamError(f"Unexpected DESI DR1 spectrum units: {units}")
    spectrum, validation = observed_spectrum_payload(
        row["wavelength"],
        row["flux"],
        row["ivar"],
        wavelength_unit=units["wavelength"],
        flux_unit=units["flux"],
        inverse_variance_unit=units.get("ivar"),
    )
    return {
        "survey": "desi",
        "release": "DESI DR1 via SPARCL",
        "object": {
            "id": row["sparcl_id"],
            "display_id": f"TARGETID {row['targetid']}",
            "targetid": str(row["targetid"]),
            "ra_deg": float(row["ra"]),
            "dec_deg": float(row["dec"]),
            "redshift": float(row["redshift"]),
            "redshift_error": None,
            "catalog_class": row["spectype"],
            "catalog_subclass": None,
            "measurements": {
                "survey": row["survey"],
            },
            "quality": {"redshift_warning": int(row["redshift_warning"])},
        },
        "spectrum": spectrum,
        "validation": validation,
        "provenance": {
            "retrieved_at": utc_now(),
            "catalogue": "NOIRLab SPARCL DESI-DR1 record",
            "sources": [
                source_link("DESI DR1", "https://data.desi.lbl.gov/doc/releases/dr1/"),
                source_link("DESI SPARCL access", "https://data.desi.lbl.gov/doc/access/"),
            ],
        },
    }


SEARCHERS = {"sdss": search_sdss, "desi": search_desi, "gama": search_gama}
SPECTRA = {"sdss": spectrum_sdss, "desi": spectrum_desi, "gama": spectrum_gama}
