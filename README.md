# Line / Atlas

An interactive visual field guide for learning to read galaxy spectra, built
around 160 real SDSS DR18 examples and designed for transfer to 4MOST LRS work.

## Explore

The atlas contains 20 examples in each of eight populations:

- star-forming
- starburst
- composite
- Seyfert
- LINER
- broad-line AGN
- quenched
- post-starburst

Each example combines its SDSS spectrum, colour postage stamp, redshift-aware
line guide, a short interpretation exercise, and a downloadable PNG study card.

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

## Sample construction

The catalogue uses SDSS pipeline subclasses plus learning-oriented selections:

- composite, Seyfert and LINER samples use BPT-style line-ratio cuts;
- quenched and post-starburst samples use MPA–JHU spectral indices and Hα
  equivalent-width constraints.

These groups are intended for pattern-recognition practice, not as definitive
physical diagnoses for individual systems.

## Data acknowledgement

Spectra, classifications and imaging are from the
[Sloan Digital Sky Survey DR18](https://www.sdss.org/dr18/). The 4MOST LRS
reference range follows the [official 4MOST capabilities](https://www.4most.eu/cms/facility/capabilities/).

