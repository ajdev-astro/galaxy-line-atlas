# Line / Atlas

An interactive visual field guide for learning to read galaxy spectra, built
around real SDSS DR18 and DESI DR1 examples and designed for transfer to
4MOST LRS work.

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

The DESI section adds 80 spectra across four redshift/spectral teaching
families: nearby galaxies, intermediate-redshift galaxies, high-redshift
galaxies, and quasars.

Each example combines a numerical calibrated spectrum, colour postage stamp,
redshift-aware line annotations, a short interpretation exercise, and a
downloadable PNG study card. The frame control replots the same flux array in
observed wavelength or rest wavelength, using
`lambda_rest = lambda_observed / (1 + z)`.

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

This queries the public SDSS SkyServer/SAS and NOIRLab SPARCL services, then
writes the compact catalogues, numerical flux arrays, and postage stamps under
`public/`.

## Sample construction

The catalogue uses SDSS pipeline subclasses plus learning-oriented selections:

- composite, Seyfert and LINER samples use BPT-style line-ratio cuts;
- quenched and post-starburst samples use MPA–JHU spectral indices and Hα
  equivalent-width constraints.

These groups are intended for pattern-recognition practice, not as definitive
physical diagnoses for individual systems.

## Data acknowledgement

SDSS spectra, classifications and imaging are from
[Sloan Digital Sky Survey DR18](https://www.sdss.org/dr18/). DESI spectra are
from [DESI Data Release 1](https://data.desi.lbl.gov/doc/releases/dr1/) via
[NOIRLab SPARCL](https://sparclclient.readthedocs.io/). Postage stamps outside
the SDSS footprint use [NASA SkyView](https://skyview.gsfc.nasa.gov/) DSS2
imaging. The 4MOST LRS reference
range follows the [official 4MOST capabilities](https://www.4most.eu/cms/facility/capabilities/).
