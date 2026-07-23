# Line / Atlas

An interactive visual field guide for learning to read galaxy spectra, built
around real SDSS DR18, DESI DR1 and GAMA DR4 examples.

## Explore

The SDSS atlas contains 100 examples in each of eight populations:

- star-forming
- starburst
- composite
- Seyfert
- LINER
- broad-line AGN
- quenched
- post-starburst

The DESI section adds 400 spectra across four redshift/spectral teaching
families: nearby galaxies, intermediate-redshift galaxies, high-redshift
galaxies, and quasars.

The GAMA section adds 400 unique AAOmega spectra: 100 each in star-forming,
composite, AGN-like and quenched teaching sets.

Each example combines a numerical calibrated spectrum, colour postage stamp,
redshift-aware line annotations, a short interpretation exercise, and a
downloadable PNG study card. The spectrum view shows the rebinned measurements
as a light trace and a Gaussian-smoothed visual guide as a dark trace. The
enlarged view supports wavelength-range dragging, mouse-wheel zoom, direct
line selection and observed/rest-frame switching.

The frame control performs a flux-conserving transformation rather than merely
relabeling the horizontal axis. For the rest-frame display:

- `lambda_rest = lambda_observed / (1 + z)`;
- `f_lambda,rest = (1 + z) f_lambda,observed`; and
- the transformed bins are integrated by pixel overlap onto a uniform
  rest-wavelength grid.

This preserves the integral of `f_lambda d_lambda`. It does not apply a
luminosity-distance correction, so the vertical axis is a conserved-frame flux
density rather than rest-frame luminosity density. This convention follows
published rest-frame spectral construction examples and the flux-conserving
resampling method described by
[Carnall (2017), SpectRes](https://arxiv.org/abs/1705.05165) and
[Selsing et al. (2016)](https://doi.org/10.1051/0004-6361/201527096).

For SDSS objects, the atlas also shows the selected galaxy on:

- the [N II] BPT diagram, using MPA–JHU Hα, Hβ, [O III] λ5007 and
  [N II] λ6584 line fluxes; and
- the stellar mass–SFR plane, using the MPA–JHU median total stellar mass and
  total SFR estimates.

For GAMA objects, the atlas shows the selected galaxy on the same [N II] BPT
plane using the GAMA `GaussFitSimplev05` line measurements.

## Run locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build

```bash
pnpm build
```

The GitHub Actions workflow builds with the repository base path and deploys
the static `out/` directory to GitHub Pages.

## Rebuild the survey cache

```bash
python -m pip install -r scripts/requirements.txt
python scripts/build-science-data.py
```

This queries the public SDSS SkyServer/SAS, NOIRLab SPARCL and GAMA DR4
services, then writes the compact catalogues, numerical flux arrays, and local
survey-image fallbacks under `public/`.

To refresh only the SDSS diagnostic measurements after changing the BPT or
mass–SFR presentation, run:

```bash
python scripts/build-science-data.py sdss-diagnostics
```

To refresh the GAMA catalogue and spectra without downloading image cutouts:

```bash
python scripts/build-science-data.py gama-data
```

## SDSS sample construction

### Catalogues and common quality cuts

The SDSS sample is queried through the DR18 SkyServer SQL service. It combines:

- `SpecObj`: coordinates, pipeline class/subclass, redshift, `zWarning`,
  plate, MJD and fibre;
- `galSpecLine`: MPA–JHU emission-line fluxes, errors and equivalent widths;
- `galSpecIndx`: MPA–JHU D4000 and Lick HδA indices; and
- `galSpecExtra`: MPA–JHU BPT class, median total stellar mass
  (`lgm_tot_p50`) and median total SFR (`sfr_tot_p50`).

Every selection requires `zWarning = 0`. Galaxy selections use the primary
`SpecObj` view and are limited to legacy plates below 3000. To keep the public
rebuild practical, the script visits the sorted set of plates represented by
the original hand-curated seed sample in `app/data.ts`, accumulating results
until it has 100 objects in each class. `TOP 100` has no random ordering, so
this is a reproducible teaching sample, not a statistically complete or random
survey sample.

The eight selections are:

| Teaching class | Exact selection |
| --- | --- |
| Star-forming | `class = 'GALAXY'`, `subClass = 'STARFORMING'`, `0.015 < z < 0.25`. |
| Starburst | `class = 'GALAXY'`, `subClass = 'STARBURST'`, `0.01 < z < 0.25`. |
| Composite | `class = 'GALAXY'`, `0.02 < z < 0.20`; Hα, Hβ, [O III] λ5007 and [N II] λ6584 each have S/N > 5; the point lies above the Kauffmann et al. curve `y = 0.61/(x − 0.05) + 1.3` and below the Kewley et al. curve `y = 0.61/(x − 0.47) + 1.19`, where `x = log([N II]/Hα)` and `y = log([O III]/Hβ)`. |
| Seyfert | `class = 'GALAXY'`, `0.02 < z < 0.25`; Hα, Hβ and [O III] each have S/N > 5 and both [S II] lines have S/N > 3; above the [S II] AGN boundary `y = 0.72/(x − 0.32) + 1.3` and above the Seyfert/LINER separator `y = 1.89x + 0.76`, with `x = log(([S II] λ6717 + λ6731)/Hα)`. |
| LINER | The same redshift and line-S/N requirements as Seyfert; above the [S II] AGN boundary and on or below `y = 1.89x + 0.76`. |
| Broad-line AGN | `class IN ('GALAXY','QSO')`, `subClass LIKE '%BROADLINE%'`, `0.02 < z < 0.50`. |
| Quenched | `class = 'GALAXY'`, `0.02 < z < 0.25`, narrow D4000 > 1.75, HδA < 2 Å and Hα EW > −2 Å. The MPA–JHU convention gives emission negative equivalent width. |
| Post-starburst | `class = 'GALAXY'`, `0.02 < z < 0.30`, HδA > 5 Å, HδA/error > 4 and Hα EW > −4 Å. |

Classes can overlap physically and in the catalogue. The 800 category
placements correspond to 751 unique SDSS spectra; the same spectrum is cached
once and can appear in more than one learning set.

### BPT and mass–SFR panels

A BPT point is plotted only when all four required line fluxes are positive and
have S/N ≥ 3. The background cloud is made from all valid SDSS placements in
this atlas. The solid and dashed curves show the Kauffmann and Kewley
demarcations respectively.

The mass–SFR panel uses `lgm_tot_p50` and `sfr_tot_p50` from `galSpecExtra`.
These are legacy MPA–JHU DR8 value-added measurements served by DR18, not new
DR18 fits. The grey cloud is the actual atlas sample; the diagonal line is an
orientation guide rather than a fitted relation. Missing or sentinel catalogue
values are omitted.

## DESI sample construction

DESI records are selected through NOIRLab SPARCL with
`data_release = 'DESI-DR1'`, zero redshift warning, and the following teaching
windows:

| Family | SPARCL spectral type | Redshift cut | Count |
| --- | --- | --- | ---: |
| Nearby galaxies | `GALAXY` | `0.02 ≤ z ≤ 0.25` | 100 |
| Intermediate-z galaxies | `GALAXY` | `0.4 ≤ z ≤ 0.8` | 100 |
| High-z galaxies | `GALAXY` | `0.8 ≤ z ≤ 1.3` | 100 |
| Quasars | `QSO` | `1.0 ≤ z ≤ 2.5` | 100 |

SPARCL is asked for up to 1,500 matching records in each window. Candidates
with confirmed DES DR2 g/r/i coadd coverage are placed first, then the list is
filled in SPARCL return order if fewer than 100 DES-covered objects are
available. The atlas stores `sparcl_id`, DESI `TARGETID`,
coordinates, redshift and family. Wavelength, flux and inverse variance are
retrieved from the DESI DR1 dataset. A homogeneous DESI line-flux and
stellar-population value-added catalogue has not been attached, so the site
does not claim BPT or mass–SFR positions for DESI objects.

## GAMA sample construction

The GAMA teaching sample comes from GAMA DR4. Spectra are required to have:

- `SURVEY = 'GAMA'`, so the spectrum was obtained by GAMA with
  AAT/AAOmega rather than inherited from another survey;
- normalised redshift quality `NQ > 2`;
- `IS_BEST = 1`; and
- `0.02 < z < 0.25`.

`GaussFitSimplev05` supplies the continuum S/N, narrow D4000 measurement and
emission-line fits. It is joined to `SpecAllv27` by `SPECID` to obtain the GAMA
name and released spectrum URL. Candidates are ordered by continuum S/N.
Previously used `SPECID` values are excluded as each class is assembled, so
the 400 category placements are 400 unique spectra.

The exact teaching cuts are:

| Class | Exact selection |
| --- | --- |
| Star-forming | Hα, Hβ, [O III] λ5007 and [N II] λ6584 are positive and each has S/N > 5; `−2 < x < 0.5`, `−1.5 < y < 1.5`; below `y = 0.61/(x − 0.05) + 1.3`. |
| Composite | The same four-line quality and x/y bounds; on or above the Kauffmann curve and below `y = 0.61/(x − 0.47) + 1.19`. |
| AGN-like | The same four-line quality and x/y bounds; on or above the Kewley curve. |
| Quenched | Continuum S/N > 8, narrow D4000 > 1.7 and `|EW(Hα)| < 3 Å`. |

Here `x = log10([N II] λ6584/Hα)` and
`y = log10([O III] λ5007/Hβ)`. These are transparent learning selections, not
a replacement for the complete GAMA selection function or a definitive
classification of each galaxy.

## Spectrum and image processing

Only pixels with finite wavelength and flux, positive inverse variance and
`3500 ≤ wavelength ≤ 10000 Å` are retained. Spectra are median-binned to about
1,500 points and clipped at the 0.5 and 99.5 flux percentiles for compact,
legible browser rendering. The displayed flux values therefore preserve line
patterns but are not intended for precision remeasurement.

SDSS spectra come from the DR18-hosted legacy `spec-lite` FITS products. GAMA
AAOmega spectra come from the DR4 `reduced_27/1d` FITS products; row 1 is the
calibrated flux density, row 2 is its 1σ error, and the wavelength grid is
reconstructed from the FITS WCS.

SDSS postage stamps use the DR18 Image Cutout service. DESI and GAMA objects
use the official Legacy Surveys DR10 JPEG cutout service with the survey's own
colour rendering at 0.262 arcsec per pixel. This replaces the earlier locally
constructed DES `i/r/g` composites, which had an excessively red colour
balance. Existing local DESI stamps remain only as a network fallback.

The samples are designed for visual pattern-recognition practice. They are not
volume-limited, statistically representative, or definitive physical diagnoses
for individual systems.

## Data acknowledgement

SDSS spectra, classifications and imaging are from
[Sloan Digital Sky Survey DR18](https://www.sdss.org/dr18/). DESI spectra are
from [DESI Data Release 1](https://data.desi.lbl.gov/doc/releases/dr1/) via
[NOIRLab SPARCL](https://sparclclient.readthedocs.io/). GAMA spectra, redshifts
and line measurements are from
[GAMA Data Release 4](https://www.gama-survey.org/dr4/). DESI and GAMA colour
cutouts are from
[DESI Legacy Imaging Surveys DR10](https://www.legacysurvey.org/dr10/description/).
