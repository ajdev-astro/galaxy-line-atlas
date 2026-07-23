#!/usr/bin/env python3
"""Build the static SDSS and DESI teaching datasets used by the atlas.

Run with:
  python -m pip install -r scripts/requirements.txt
  python scripts/build-science-data.py

The script only uses public, official survey services. It writes compact,
downsampled numerical spectra and local postage stamps so the exported study
cards work without cross-origin canvas restrictions.
"""

from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import sys
import tempfile
import types
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import requests
from astropy.io import fits
from astropy.io.votable import parse_single_table
from astropy.visualization import make_lupton_rgb
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
DATA = PUBLIC / "data"
SDSS_SPECTRA = PUBLIC / "sdss" / "spectra-data"
SDSS_STAMPS = PUBLIC / "sdss" / "stamps"
DESI_SPECTRA = PUBLIC / "desi" / "spectra-data"
DESI_STAMPS = PUBLIC / "desi" / "stamps"
DES_SIA = "https://datalab.noirlab.edu/sia/des_dr2"

for directory in (DATA, SDSS_SPECTRA, SDSS_STAMPS, DESI_SPECTRA, DESI_STAMPS):
    directory.mkdir(parents=True, exist_ok=True)

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "Galaxy-Line-Atlas/1.0 (educational static dataset)"

# Restrict catalogue joins to the plates represented by the original curated
# seed set. This keeps SkyServer queries fast while still sampling many fields.
seed_source = (ROOT / "app" / "data.ts").read_text()
SEED_PLATES = sorted(
    {
        int(match.group(1))
        for match in re.finditer(
            r'\["\d+",\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?,'
            r"\s*-?\d+(?:\.\d+)?,\s*(\d+),\s*\d+,\s*\d+\]",
            seed_source,
        )
    }
)

SDSS_SQL = {
    "star-forming": """
        SELECT TOP 100 s.specObjID, s.ra, s.dec, s.z, s.plate, s.mjd, s.fiberID
        FROM SpecObj s
        WHERE s.class = 'GALAXY' AND s.subClass = 'STARFORMING'
          AND s.z BETWEEN 0.015 AND 0.25 AND s.zWarning = 0 AND s.plate < 3000
    """,
    "starburst": """
        SELECT TOP 100 s.specObjID, s.ra, s.dec, s.z, s.plate, s.mjd, s.fiberID
        FROM SpecObj s
        WHERE s.class = 'GALAXY' AND s.subClass = 'STARBURST'
          AND s.z BETWEEN 0.01 AND 0.25 AND s.zWarning = 0 AND s.plate < 3000
    """,
    "composite": """
        SELECT TOP 100 s.specObjID, s.ra, s.dec, s.z, s.plate, s.mjd, s.fiberID
        FROM SpecObj s
        JOIN galSpecLine g ON g.specObjID = s.specObjID
        WHERE s.class = 'GALAXY' AND s.z BETWEEN 0.02 AND 0.20
          AND s.zWarning = 0 AND s.plate < 3000
          AND g.h_alpha_flux/g.h_alpha_flux_err > 5
          AND g.h_beta_flux/g.h_beta_flux_err > 5
          AND g.oiii_5007_flux/g.oiii_5007_flux_err > 5
          AND g.nii_6584_flux/g.nii_6584_flux_err > 5
          AND LOG10(g.oiii_5007_flux/g.h_beta_flux)
              > 0.61/(LOG10(g.nii_6584_flux/g.h_alpha_flux)-0.05)+1.3
          AND LOG10(g.oiii_5007_flux/g.h_beta_flux)
              < 0.61/(LOG10(g.nii_6584_flux/g.h_alpha_flux)-0.47)+1.19
    """,
    "seyfert": """
        SELECT TOP 100 s.specObjID, s.ra, s.dec, s.z, s.plate, s.mjd, s.fiberID
        FROM SpecObj s
        JOIN galSpecLine g ON g.specObjID = s.specObjID
        WHERE s.class = 'GALAXY' AND s.z BETWEEN 0.02 AND 0.25
          AND s.zWarning = 0 AND s.plate < 3000
          AND g.h_alpha_flux/g.h_alpha_flux_err > 5
          AND g.h_beta_flux/g.h_beta_flux_err > 5
          AND g.oiii_5007_flux/g.oiii_5007_flux_err > 5
          AND g.sii_6717_flux/g.sii_6717_flux_err > 3
          AND g.sii_6731_flux/g.sii_6731_flux_err > 3
          AND LOG10(g.oiii_5007_flux/g.h_beta_flux)
              > 0.72/(LOG10((g.sii_6717_flux+g.sii_6731_flux)/g.h_alpha_flux)-0.32)+1.3
          AND LOG10(g.oiii_5007_flux/g.h_beta_flux)
              > 1.89*LOG10((g.sii_6717_flux+g.sii_6731_flux)/g.h_alpha_flux)+0.76
    """,
    "liner": """
        SELECT TOP 100 s.specObjID, s.ra, s.dec, s.z, s.plate, s.mjd, s.fiberID
        FROM SpecObj s
        JOIN galSpecLine g ON g.specObjID = s.specObjID
        WHERE s.class = 'GALAXY' AND s.z BETWEEN 0.02 AND 0.25
          AND s.zWarning = 0 AND s.plate < 3000
          AND g.h_alpha_flux/g.h_alpha_flux_err > 5
          AND g.h_beta_flux/g.h_beta_flux_err > 5
          AND g.oiii_5007_flux/g.oiii_5007_flux_err > 5
          AND g.sii_6717_flux/g.sii_6717_flux_err > 3
          AND g.sii_6731_flux/g.sii_6731_flux_err > 3
          AND LOG10(g.oiii_5007_flux/g.h_beta_flux)
              > 0.72/(LOG10((g.sii_6717_flux+g.sii_6731_flux)/g.h_alpha_flux)-0.32)+1.3
          AND LOG10(g.oiii_5007_flux/g.h_beta_flux)
              <= 1.89*LOG10((g.sii_6717_flux+g.sii_6731_flux)/g.h_alpha_flux)+0.76
    """,
    "broad-line-agn": """
        SELECT TOP 100 s.specObjID, s.ra, s.dec, s.z, s.plate, s.mjd, s.fiberID
        FROM SpecObj s
        WHERE s.class IN ('GALAXY','QSO') AND s.subClass LIKE '%BROADLINE%'
          AND s.z BETWEEN 0.02 AND 0.50 AND s.zWarning = 0 AND s.plate < 3000
    """,
    "quenched": """
        SELECT TOP 100 s.specObjID, s.ra, s.dec, s.z, s.plate, s.mjd, s.fiberID
        FROM SpecObj s
        JOIN galSpecIndx i ON i.specObjID = s.specObjID
        JOIN galSpecLine g ON g.specObjID = s.specObjID
        WHERE s.class = 'GALAXY' AND s.z BETWEEN 0.02 AND 0.25
          AND s.zWarning = 0 AND s.plate < 3000
          AND i.d4000_n > 1.75 AND i.lick_hd_a < 2 AND g.h_alpha_eqw > -2
    """,
    "post-starburst": """
        SELECT TOP 100 s.specObjID, s.ra, s.dec, s.z, s.plate, s.mjd, s.fiberID
        FROM SpecObj s
        JOIN galSpecIndx i ON i.specObjID = s.specObjID
        JOIN galSpecLine g ON g.specObjID = s.specObjID
        WHERE s.class = 'GALAXY' AND s.z BETWEEN 0.02 AND 0.30
          AND s.zWarning = 0 AND s.plate < 3000
          AND i.lick_hd_a > 5 AND i.lick_hd_a/i.lick_hd_a_err > 4
          AND g.h_alpha_eqw > -4
    """,
}


def compact_spectrum(wavelength: np.ndarray, flux: np.ndarray, ivar: np.ndarray | None):
    good = np.isfinite(wavelength) & np.isfinite(flux)
    if ivar is not None:
        good &= np.isfinite(ivar) & (ivar > 0)
    good &= (wavelength >= 3500) & (wavelength <= 10000)
    wavelength = wavelength[good]
    flux = flux[good]
    if len(wavelength) < 100:
        raise ValueError("Spectrum has too few valid pixels")

    # Keep about 1,500 points while retaining narrow features through medians.
    stride = max(1, len(wavelength) // 1500)
    usable = (len(wavelength) // stride) * stride
    wavelength = np.median(wavelength[:usable].reshape(-1, stride), axis=1)
    flux = np.median(flux[:usable].reshape(-1, stride), axis=1)

    low, high = np.nanpercentile(flux, [0.5, 99.5])
    flux = np.clip(flux, low, high)
    return {
        "w": [round(float(value), 2) for value in wavelength],
        "f": [round(float(value), 3) for value in flux],
    }


def query_sdss(category: str, sql: str):
    base_sql = " ".join(sql.split()).replace("TOP 100", "TOP 100")
    rows_by_id = {}
    for plate in SEED_PLATES:
        response = SESSION.get(
            "https://skyserver.sdss.org/dr18/SkyServerWS/SearchTools/SqlSearch",
            params={
                "cmd": (
                    base_sql
                    + f" AND s.plate = {plate}"
                ),
                "format": "csv",
            },
            timeout=60,
        )
        response.raise_for_status()
        csv_text = response.text
        if csv_text.startswith("#Table"):
            csv_text = csv_text.split("\n", 1)[1]
        for row in csv.DictReader(io.StringIO(csv_text)):
            rows_by_id[row["specObjID"]] = row
        if len(rows_by_id) >= 100:
            break
    rows = list(rows_by_id.values())[:100]
    if len(rows) != 100:
        raise RuntimeError(f"{category}: expected 100 rows, received {len(rows)}")
    return [
        {
            "id": str(row["specObjID"]),
            "ra": float(row["ra"]),
            "dec": float(row["dec"]),
            "z": float(row["z"]),
            "plate": int(row["plate"]),
            "mjd": int(row["mjd"]),
            "fiber": int(row["fiberID"]),
            "category": category,
        }
        for row in rows
    ]


def enrich_sdss_diagnostics(catalog):
    """Attach MPA–JHU line-ratio, stellar-mass and SFR measurements."""
    unique_ids = sorted({row["id"] for row in catalog})
    diagnostics = {}
    for start in range(0, len(unique_ids), 50):
        batch = unique_ids[start : start + 50]
        sql = f"""
            SELECT g.specObjID, g.h_alpha_flux, g.h_alpha_flux_err,
                   g.h_beta_flux, g.h_beta_flux_err,
                   g.oiii_5007_flux, g.oiii_5007_flux_err,
                   g.nii_6584_flux, g.nii_6584_flux_err,
                   e.bptclass, e.lgm_tot_p50, e.sfr_tot_p50
            FROM galSpecLine g
            LEFT JOIN galSpecExtra e ON e.specObjID = g.specObjID
            WHERE g.specObjID IN ({",".join(batch)})
        """
        response = SESSION.get(
            "https://skyserver.sdss.org/dr18/SkyServerWS/SearchTools/SqlSearch",
            params={"cmd": " ".join(sql.split()), "format": "csv"},
            timeout=90,
        )
        response.raise_for_status()
        csv_text = response.text
        if csv_text.startswith("#Table"):
            csv_text = csv_text.split("\n", 1)[1]
        for result in csv.DictReader(io.StringIO(csv_text)):
            values = {
                name: float(result[name])
                for name in (
                    "h_alpha_flux",
                    "h_alpha_flux_err",
                    "h_beta_flux",
                    "h_beta_flux_err",
                    "oiii_5007_flux",
                    "oiii_5007_flux_err",
                    "nii_6584_flux",
                    "nii_6584_flux_err",
                )
            }
            payload = {}
            reliable = all(
                values[name] > 0
                and values[name.replace("_flux", "_flux_err")] > 0
                and values[name] / values[name.replace("_flux", "_flux_err")] >= 3
                for name in (
                    "h_alpha_flux",
                    "h_beta_flux",
                    "oiii_5007_flux",
                    "nii_6584_flux",
                )
            )
            if reliable:
                payload["bptX"] = round(
                    math.log10(values["nii_6584_flux"] / values["h_alpha_flux"]), 4
                )
                payload["bptY"] = round(
                    math.log10(values["oiii_5007_flux"] / values["h_beta_flux"]), 4
                )
            for source, destination in (
                ("lgm_tot_p50", "logMass"),
                ("sfr_tot_p50", "logSfr"),
            ):
                try:
                    value = float(result[source])
                except (TypeError, ValueError):
                    continue
                if math.isfinite(value) and -20 < value < 20:
                    payload[destination] = round(value, 4)
            try:
                payload["bptClass"] = int(result["bptclass"])
            except (TypeError, ValueError):
                pass
            diagnostics[str(result["specObjID"])] = payload

    for row in catalog:
        row.update(diagnostics.get(row["id"], {}))
    print(
        "SDSS diagnostics: "
        f"{sum('bptX' in row for row in catalog)} BPT placements; "
        f"{sum('logMass' in row and 'logSfr' in row for row in catalog)} mass–SFR placements"
    )
    return catalog


def cache_sdss(row):
    spectrum_path = SDSS_SPECTRA / f"{row['id']}.json"
    stamp_path = SDSS_STAMPS / f"{row['id']}.jpg"
    if not spectrum_path.exists():
        plate = f"{row['plate']:04d}"
        fiber = f"{row['fiber']:04d}"
        url = (
            "https://dr18.sdss.org/sas/dr18/prior-surveys/"
            f"sdss2-dr8-sdss/spectro/redux/26/spectra/lite/{plate}/"
            f"spec-{plate}-{row['mjd']}-{fiber}.fits"
        )
        response = SESSION.get(url, timeout=120)
        response.raise_for_status()
        with fits.open(io.BytesIO(response.content), memmap=False) as hdul:
            table = hdul[1].data
            payload = compact_spectrum(
                10 ** np.asarray(table["loglam"], dtype=float),
                np.asarray(table["flux"], dtype=float),
                np.asarray(table["ivar"], dtype=float),
            )
        spectrum_path.write_text(json.dumps(payload, separators=(",", ":")))

    if not stamp_path.exists():
        response = SESSION.get(
            "https://skyserver.sdss.org/dr18/SkyServerWS/ImgCutout/getjpeg",
            params={
                "ra": row["ra"],
                "dec": row["dec"],
                "scale": 0.25,
                "width": 360,
                "height": 360,
            },
            timeout=120,
        )
        response.raise_for_status()
        stamp_path.write_bytes(response.content)


def build_sdss():
    catalog = []
    for category, sql in SDSS_SQL.items():
        rows = query_sdss(category, sql)
        catalog.extend(rows)
        print(f"SDSS {category}: selected {len(rows)}")

    enrich_sdss_diagnostics(catalog)
    (DATA / "sdss-catalog.json").write_text(
        json.dumps(catalog, separators=(",", ":"))
    )
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(cache_sdss, row) for row in catalog]
        for index, future in enumerate(as_completed(futures), 1):
            future.result()
            if index % 50 == 0:
                print(f"SDSS assets: {index}/{len(catalog)}")


DESI_FAMILIES = {
    "bgs": {
        "name": "Nearby galaxies",
        "constraints": {
            "data_release": ["DESI-DR1"],
            "spectype": ["GALAXY"],
            "redshift": [0.02, 0.25],
            "redshift_warning": [0, 0],
        },
    },
    "lrg": {
        "name": "Intermediate-z galaxies",
        "constraints": {
            "data_release": ["DESI-DR1"],
            "spectype": ["GALAXY"],
            "redshift": [0.4, 0.8],
            "redshift_warning": [0, 0],
        },
    },
    "elg": {
        "name": "High-z galaxies",
        "constraints": {
            "data_release": ["DESI-DR1"],
            "spectype": ["GALAXY"],
            "redshift": [0.8, 1.3],
            "redshift_warning": [0, 0],
        },
    },
    "qso": {
        "name": "Quasar",
        "constraints": {
            "data_release": ["DESI-DR1"],
            "spectype": ["QSO"],
            "redshift": [1.0, 2.5],
            "redshift_warning": [0, 0],
        },
    },
}


def sparcl_client():
    # The data retrieval methods do not use specutils, but the client imports
    # conversion helpers eagerly. A tiny stub keeps this build dependency light.
    if "specutils" not in sys.modules:
        module = types.ModuleType("specutils")
        module.Spectrum = type("Spectrum", (), {})
        module.SpectrumCollection = type("SpectrumCollection", (), {})
        module.SpectrumList = list
        sys.modules["specutils"] = module
    from sparcl.client import SparclClient

    return SparclClient(announcement=False)


def legacy_cutout(row):
    destination = DESI_STAMPS / f"{row['targetid']}.jpg"
    if destination.exists():
        return
    for attempt in range(3):
        try:
            response = SESSION.get(
                "https://skyserver.sdss.org/dr18/SkyServerWS/ImgCutout/getjpeg",
                params={
                    "ra": row["ra"],
                    "dec": row["dec"],
                    "scale": 0.25,
                    "width": 360,
                    "height": 360,
                },
                timeout=40,
            )
            response.raise_for_status()
            destination.write_bytes(response.content)
            return
        except requests.HTTPError as error:
            if error.response is not None and error.response.status_code == 404:
                page = SESSION.get(
                    "https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl",
                    params={
                        "Position": f"{row['ra']},{row['dec']}",
                        "coordinates": "J2000",
                        "pixels": 360,
                        "Size": 0.03,
                        "projection": "Tan",
                        "scaling": "Log",
                        "survey": "DSS2 Red",
                    },
                    timeout=90,
                )
                page.raise_for_status()
                match = re.search(
                    r'src="\.\./\.\./tempspace/fits/([^"]+\.jpg)"',
                    page.text,
                )
                if not match:
                    raise RuntimeError("SkyView did not return a quicklook image")
                image = SESSION.get(
                    f"https://skyview.gsfc.nasa.gov/tempspace/fits/{match.group(1)}",
                    timeout=90,
                )
                image.raise_for_status()
                destination.write_bytes(image.content)
                return
            if attempt == 2:
                raise
        except requests.RequestException:
            if attempt == 2:
                raise


def des_sia_table(row):
    response = SESSION.get(
        DES_SIA,
        params={"POS": f"{row['ra']},{row['dec']}", "SIZE": "0.02"},
        timeout=60,
    )
    response.raise_for_status()
    return parse_single_table(io.BytesIO(response.content)).to_table()


def des_has_coverage(record):
    # Most DES/DESI overlap in this sample is in the south Galactic cap.
    # Prefiltering avoids thousands of empty SIA service calls.
    if not ((record["ra"] < 70 or record["ra"] > 300) and record["dec"] < 5):
        return False
    try:
        table = des_sia_table(record)
    except (requests.RequestException, ValueError):
        return False
    bands = {str(result["obs_bandpass"]) for result in table}
    return {"g", "r", "i"}.issubset(bands)


def des_colour_cutout(row):
    table = des_sia_table(row)
    urls = {}
    for result in table:
        band = str(result["obs_bandpass"])
        url = str(result["access_url"])
        if (
            band in ("g", "r", "i")
            and band not in urls
            and "nobkg" not in url
            and "extn=1" in url
        ):
            urls[band] = url
    if set(urls) != {"g", "r", "i"}:
        raise RuntimeError("DES DR2 g/r/i coadds are not all available")

    bands = {}
    for band, url in urls.items():
        response = SESSION.get(url, timeout=90)
        response.raise_for_status()
        with fits.open(io.BytesIO(response.content), memmap=False) as hdul:
            bands[band] = np.asarray(hdul[0].data, dtype=float)
    rgb = make_lupton_rgb(
        bands["i"],
        bands["r"],
        bands["g"],
        stretch=20,
        Q=8,
    )
    image = Image.fromarray(rgb).resize((360, 360), Image.Resampling.LANCZOS)
    image.save(DESI_STAMPS / f"{row['targetid']}.jpg", quality=93)


def cache_desi_stamp(row):
    if row.get("imageSource") == "DES DR2":
        try:
            des_colour_cutout(row)
            return
        except (requests.RequestException, RuntimeError, ValueError, OSError):
            row["imageSource"] = "SDSS / SkyView fallback"
    legacy_cutout(row)


def build_desi():
    client = sparcl_client()
    outfields = [
        "sparcl_id",
        "targetid",
        "ra",
        "dec",
        "redshift",
        "spectype",
        "program",
        "survey",
        "tsnr2_bgs",
        "tsnr2_elg",
        "tsnr2_lrg",
        "tsnr2_qso",
    ]
    catalog = []
    for family, config in DESI_FAMILIES.items():
        found = client.find(
            outfields=outfields,
            constraints=config["constraints"],
            limit=1500,
        )
        likely_des = [
            record
            for record in found.records
            if (record["ra"] < 70 or record["ra"] > 300) and record["dec"] < 5
        ]
        with ThreadPoolExecutor(max_workers=16) as pool:
            coverage = list(pool.map(des_has_coverage, likely_des))
        des_records = [
            record for record, covered in zip(likely_des, coverage) if covered
        ]
        selected = des_records[:100]
        selected_ids = {record["sparcl_id"] for record in selected}
        if len(selected) < 100:
            selected.extend(
                record
                for record in found.records
                if record["sparcl_id"] not in selected_ids
            )
            selected = selected[:100]
        des_ids = {record["sparcl_id"] for record in des_records}
        if len(selected) != 100:
            raise RuntimeError(
                f"DESI {family}: expected 100 rows, received {len(selected)}"
            )
        for record in selected:
            catalog.append(
                {
                    "id": record["sparcl_id"],
                    "targetid": str(record["targetid"]),
                    "ra": float(record["ra"]),
                    "dec": float(record["dec"]),
                    "z": float(record["redshift"]),
                    "family": family,
                    "imageSource": (
                        "DES DR2"
                        if record["sparcl_id"] in des_ids
                        else "SDSS / SkyView fallback"
                    ),
                }
            )
        print(
            f"DESI {family}: selected 100 "
            f"({sum(record['sparcl_id'] in des_ids for record in selected)} with DES DR2 imaging)"
        )

    by_id = {}
    missing = [
        row
        for row in catalog
        if not (DESI_SPECTRA / f"{row['targetid']}.json").exists()
    ]
    for start in range(0, len(missing), 100):
        batch = missing[start : start + 100]
        retrieved = client.retrieve(
            [row["id"] for row in batch],
            include=["sparcl_id", "wavelength", "flux", "ivar"],
            dataset_list=["DESI-DR1"],
            limit=len(batch),
            units=False,
        )
        by_id.update(
            {record["sparcl_id"]: record for record in retrieved.records}
        )
    for row in catalog:
        spectrum_path = DESI_SPECTRA / f"{row['targetid']}.json"
        if spectrum_path.exists():
            continue
        record = by_id[row["id"]]
        payload = compact_spectrum(
            np.asarray(record["wavelength"], dtype=float),
            np.asarray(record["flux"], dtype=float),
            np.asarray(record["ivar"], dtype=float),
        )
        spectrum_path.write_text(
            json.dumps(payload, separators=(",", ":"))
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(cache_desi_stamp, row) for row in catalog]
        for future in as_completed(futures):
            future.result()
    (DATA / "desi-catalog.json").write_text(
        json.dumps(catalog, separators=(",", ":"))
    )
    print(f"DESI assets: {len(catalog)}/{len(catalog)}")


def build_desi_stamps():
    catalog = json.loads((DATA / "desi-catalog.json").read_text())
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(cache_desi_stamp, row) for row in catalog]
        for index, future in enumerate(as_completed(futures), 1):
            future.result()
            if index % 20 == 0:
                print(f"DESI stamps: {index}/{len(catalog)}")


def build_sdss_diagnostics():
    catalog = json.loads((DATA / "sdss-catalog.json").read_text())
    enrich_sdss_diagnostics(catalog)
    (DATA / "sdss-catalog.json").write_text(
        json.dumps(catalog, separators=(",", ":"))
    )


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "all"
    if target in ("all", "sdss"):
        build_sdss()
    if target in ("all", "desi"):
        build_desi()
    if target == "desi-stamps":
        build_desi_stamps()
    if target == "sdss-diagnostics":
        build_sdss_diagnostics()
