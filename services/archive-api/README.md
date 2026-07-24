# On-demand archive API

This service lets the static atlas browse large public catalogues without
copying their spectra or image cutouts into GitHub.

## Storage and cost model

- There is no database and no persistent data directory.
- Catalogue searches go to SDSS DR18 SkyServer, NOIRLab SPARCL DESI-DR1, or
  GAMA DR4 only when requested.
- A selected spectrum is fetched from the authoritative released product and
  returned to the browser. Survey FITS files are not written to disk.
- Legacy Surveys DR10 cutouts are loaded directly by the browser, so the API
  does not store or proxy image bytes.
- Gzip is enabled for spectrum JSON.
- One process accepts at most two simultaneous upstream requests by default.
- Process-local caches are hard-capped at 8 spectra for one hour and 32 search
  responses for five minutes. Set either cap to `0` for the lowest memory use.
- The Docker image runs one worker and can be deployed on a scale-to-zero
  container service. No always-on machine is required for an experimental
  atlas.

The default settings are intentionally conservative for a small 512 MiB
container. Actual memory and request cost depend on the platform, spectrum
length, traffic, and outbound-network pricing.

## Correctness contract

The API reports the survey release, exact catalogue query or constraints,
retrieval time, source links, native object identifier, native catalogue
class, coordinates, redshift, quality flags, units, and validation results.

It does not infer a physical class during archive search. GAMA results therefore
show no class because the selected catalogue query does not supply an
SDSS/DESI-equivalent class.

Returned wavelength, flux, and uncertainty samples are observed-frame released
pixels. The server does not resample, clip, normalise, interpolate, or smooth
them. Non-finite flux and uncertainty values become JSON `null`; non-finite
wavelength coordinates are removed and counted. A response is rejected unless
the wavelength array is strictly increasing, array lengths agree, at least 100
wavelength samples remain, and more than 95% of flux samples are finite.

Additional fail-closed checks include:

- SDSS spectra are resolved through the DR18 Explore record instead of guessing
  a SAS path, and the FITS flux unit must match the released product.
- DESI unit strings are read from the SPARCL response and must match DESI-DR1.
- GAMA FITS row labels and wavelength units must match the released DR4 layout.
  The returned inverse variance is explicitly identified as derived from the
  released 1-sigma error row.
- The GAMA DR4 web query form can truncate SQL at a literal `<` character.
  GAMA queries avoid that operator and every response is rejected unless the
  query echoed by GAMA exactly matches the submitted query.

## Run locally

```bash
cd services/archive-api
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
uvicorn atlas_api.app:app --reload --port 8000
pytest -q
```

The frontend uses `http://localhost:8000` by default. For a deployed adapter,
set `NEXT_PUBLIC_ARCHIVE_API_URL` when building the Next.js site.

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `ATLAS_ALLOWED_ORIGINS` | local site and `ajdev-astro.github.io` | Comma-separated CORS origins |
| `ATLAS_UPSTREAM_CONCURRENCY` | `2` | Maximum concurrent public-service calls |
| `ATLAS_SPECTRUM_CACHE_ITEMS` | `8` | In-memory spectrum response cap |
| `ATLAS_SEARCH_CACHE_ITEMS` | `32` | In-memory search response cap |
| `PORT` | `8080` in Docker | Listening port |

Deploy the `services/archive-api` directory as a container. Keep one worker
unless load testing shows a need for more: each extra worker has a separate
cache and therefore increases memory use.
