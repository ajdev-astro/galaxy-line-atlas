"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { spectralLines } from "../data";


const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const API_URL =
  process.env.NEXT_PUBLIC_ARCHIVE_API_URL?.replace(/\/$/, "") ??
  "http://localhost:8000";

type Survey = "sdss" | "desi" | "gama";
type SearchResult = {
  id: string;
  display_id: string;
  targetid?: string;
  ra_deg: number;
  dec_deg: number;
  redshift: number;
  redshift_error: number | null;
  catalog_class: string | null;
  catalog_subclass: string | null;
  measurements?: Record<string, string | number | null>;
  quality: Record<string, string | number>;
};
type SourceLink = { label: string; url: string };
type SearchResponse = {
  survey: Survey;
  release: string;
  result_count: number;
  results: SearchResult[];
  provenance: {
    retrieved_at: string;
    catalogue: string;
    query: unknown;
    sources: SourceLink[];
  };
  interpretation: string;
};
type SpectrumResponse = {
  survey: Survey;
  release: string;
  object: SearchResult;
  spectrum: {
    frame: "observed";
    wavelength: number[];
    flux: Array<number | null>;
    inverse_variance: Array<number | null>;
    units: {
      wavelength: string;
      flux: string;
      inverse_variance: string;
    };
    processing: {
      resampled: boolean;
      smoothed: boolean;
      clipped: boolean;
      normalised: boolean;
      removed_nonfinite_wavelength_pixels: number;
    };
  };
  validation: {
    passed: boolean;
    checks: Record<string, boolean | number>;
  };
  provenance: {
    retrieved_at: string;
    catalogue: string;
    spectrum_url?: string;
    sources: SourceLink[];
  };
};

function scale(
  value: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
) {
  return toMin + ((value - fromMin) / (fromMax - fromMin)) * (toMax - toMin);
}

function quantile(values: number[], fraction: number) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

function smoothForDisplay(values: Array<number | null>, sigma = 2.2) {
  const radius = Math.ceil(sigma * 4);
  const kernel = Array.from(
    { length: radius * 2 + 1 },
    (_, index) => Math.exp(-0.5 * ((index - radius) / sigma) ** 2),
  );
  return values.map((_, index) => {
    let sum = 0;
    let weight = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const value = values[index + offset];
      if (value === null || !Number.isFinite(value)) continue;
      const currentWeight = kernel[offset + radius];
      sum += value * currentWeight;
      weight += currentWeight;
    }
    return weight ? sum / weight : null;
  });
}

function pathForSeries(
  wavelength: number[],
  values: Array<number | null>,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
) {
  let path = "";
  let started = false;
  for (let index = 0; index < wavelength.length; index += 1) {
    const value = values[index];
    if (value === null || !Number.isFinite(value)) {
      started = false;
      continue;
    }
    const x = scale(wavelength[index], xMin, xMax, 92, 1068);
    const y = scale(Math.max(yMin, Math.min(yMax, value)), yMin, yMax, 565, 100);
    path += `${started ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    started = true;
  }
  return path;
}

function formatFlux(value: number) {
  if (value === 0) return "0";
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) {
    return value.toExponential(1);
  }
  return value.toPrecision(3);
}

function ArchiveSpectrum({
  payload,
  domain,
}: {
  payload: SpectrumResponse;
  domain?: [number, number];
}) {
  const wavelength = payload.spectrum.wavelength;
  const flux = payload.spectrum.flux;
  const smooth = useMemo(() => smoothForDisplay(flux), [flux]);
  const xMin = domain?.[0] ?? wavelength[0];
  const xMax = domain?.[1] ?? wavelength[wavelength.length - 1];
  const finiteFlux = flux.filter(
    (value, index): value is number =>
      value !== null && wavelength[index] >= xMin && wavelength[index] <= xMax,
  );
  const low = quantile(finiteFlux, 0.005);
  const high = quantile(finiteFlux, 0.995);
  const padding = Math.max((high - low) * 0.08, 0.01);
  const yMin = low - padding;
  const yMax = high + padding;
  const rawPath = pathForSeries(wavelength, flux, xMin, xMax, yMin, yMax);
  const smoothPath = pathForSeries(wavelength, smooth, xMin, xMax, yMin, yMax);
  const xTicks = Array.from({ length: 7 }, (_, index) => xMin + ((xMax - xMin) * index) / 6);
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4);
  const occupiedLevels = Array(5).fill(-Infinity);
  const visibleLines = spectralLines
    .map((line) => ({
      ...line,
      observed: line.rest * (1 + payload.object.redshift),
    }))
    .filter((line) => line.observed >= xMin && line.observed <= xMax)
    .map((line) => {
      const x = scale(line.observed, xMin, xMax, 92, 1068);
      const requiredGap = Math.max(48, line.name.length * 7);
      let level = occupiedLevels.findIndex((lastX) => x - lastX >= requiredGap);
      if (level < 0) {
        level = occupiedLevels.indexOf(Math.min(...occupiedLevels));
      }
      occupiedLevels[level] = x;
      return { ...line, x, level };
    });

  return (
    <div className="archive-spectrum">
      <svg
        viewBox="0 0 1120 650"
        role="img"
        aria-label={`Observed-frame ${payload.survey.toUpperCase()} spectrum for ${payload.object.display_id}`}
      >
        <rect width="1120" height="650" fill="#fff" />
        <text x="92" y="35" className="archive-plot-header">
          {payload.release} · {payload.object.display_id} · z = {payload.object.redshift.toFixed(6)}
        </text>
        <text x="92" y="60" className="archive-plot-header">
          Measured observed-frame pixels
        </text>
        {xTicks.map((tick) => {
          const x = scale(tick, xMin, xMax, 92, 1068);
          return (
            <g key={`x-${tick}`}>
              <line x1={x} x2={x} y1="100" y2="565" className="archive-grid" />
              <text x={x} y="594" textAnchor="middle" className="archive-tick">
                {tick.toFixed(0)}
              </text>
            </g>
          );
        })}
        {yTicks.map((tick) => {
          const y = scale(tick, yMin, yMax, 565, 100);
          return (
            <g key={`y-${tick}`}>
              <line x1="92" x2="1068" y1={y} y2={y} className="archive-grid" />
              <text x="80" y={y + 5} textAnchor="end" className="archive-tick">
                {formatFlux(tick)}
              </text>
            </g>
          );
        })}
        <g clipPath="url(#archive-spectrum-clip)">
          <defs>
            <clipPath id="archive-spectrum-clip">
              <rect x="92" y="100" width="976" height="465" />
            </clipPath>
          </defs>
          <path d={rawPath} className="archive-raw-spectrum" />
          <path d={smoothPath} className="archive-smooth-spectrum" />
          {visibleLines.map((line) => {
            const labelY = 128 + line.level * 21;
            return (
              <g key={`${line.name}-${line.rest}`}>
                <line x1={line.x} x2={line.x} y1="100" y2={labelY - 13} className={`archive-feature ${line.kind}`} />
                <text x={line.x + 3} y={labelY} className={`archive-feature-label ${line.kind}`}>
                  {line.name}
                </text>
              </g>
            );
          })}
        </g>
        <rect x="92" y="100" width="976" height="465" fill="none" className="archive-frame" />
        <text x="580" y="630" textAnchor="middle" className="archive-axis-label">
          Observed wavelength ({payload.spectrum.units.wavelength})
        </text>
        <text x="19" y="332" textAnchor="middle" transform="rotate(-90 19 332)" className="archive-axis-label">
          Flux density ({payload.spectrum.units.flux})
        </text>
      </svg>
    </div>
  );
}

function qualityText(result: SearchResult) {
  return Object.entries(result.quality)
    .filter(([key]) => key !== "selection")
    .map(([key, value]) => `${key}=${value}`)
    .join(" · ");
}

export default function ArchivePage() {
  const [survey, setSurvey] = useState<Survey>("sdss");
  const [zMin, setZMin] = useState("0.02");
  const [zMax, setZMax] = useState("0.25");
  const [className, setClassName] = useState("GALAXY");
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [selected, setSelected] = useState<SpectrumResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingSpectrum, setLoadingSpectrum] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [zoomStart, setZoomStart] = useState(0);
  const [zoomEnd, setZoomEnd] = useState(100);
  const spectrumDialog = useRef<HTMLDialogElement>(null);

  const changeSurvey = (next: Survey) => {
    setSurvey(next);
    setClassName(next === "gama" ? "all" : "GALAXY");
    setSearch(null);
    setSelected(null);
    setError("");
  };

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    setSearching(true);
    setSelected(null);
    setError("");
    try {
      const params = new URLSearchParams({
        survey,
        z_min: zMin,
        z_max: zMax,
        class: className,
        limit: "25",
      });
      const response = await fetch(`${API_URL}/v1/search?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? `Search failed (${response.status})`);
      setSearch(body);
    } catch (currentError) {
      setSearch(null);
      setError(currentError instanceof Error ? currentError.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const loadSpectrum = async (result: SearchResult) => {
    setLoadingSpectrum(result.id);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/v1/spectra/${survey}/${encodeURIComponent(result.id)}`,
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? `Spectrum failed (${response.status})`);
      setSelected(body);
      setZoomStart(0);
      setZoomEnd(100);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Spectrum failed");
    } finally {
      setLoadingSpectrum(null);
    }
  };

  const cutoutUrl = selected
    ? `https://www.legacysurvey.org/viewer/jpeg-cutout?ra=${selected.object.ra_deg}&dec=${selected.object.dec_deg}&layer=ls-dr10&pixscale=0.262&size=360`
    : "";
  const zoomDomain: [number, number] | undefined = selected
    ? [
        selected.spectrum.wavelength[0]
          + ((selected.spectrum.wavelength.at(-1)! - selected.spectrum.wavelength[0]) * zoomStart) / 100,
        selected.spectrum.wavelength[0]
          + ((selected.spectrum.wavelength.at(-1)! - selected.spectrum.wavelength[0]) * zoomEnd) / 100,
      ]
    : undefined;

  return (
    <main className="archive-page">
      <header className="archive-topbar">
        <a className="brand" href={`${BASE_PATH}/`}>
          <span className="brand-mark">L/A</span>
          <span><strong>LINE / ATLAS</strong><small>Return to teaching atlas</small></span>
        </a>
        <span>On-demand archive · experimental branch</span>
      </header>

      <section className="archive-intro">
        <p className="eyebrow">Authoritative public-survey retrieval</p>
        <h1>Search widely.<br />Store almost nothing.</h1>
        <p>
          Catalogue labels and measured pixels come from the named survey
          service when requested. This experiment does not assign a new physical
          class or mirror survey files.
        </p>
      </section>

      <section className="archive-search-section">
        <form className="archive-search-form" onSubmit={runSearch}>
          <label>
            Survey
            <select value={survey} onChange={(event) => changeSurvey(event.target.value as Survey)}>
              <option value="sdss">SDSS DR18</option>
              <option value="desi">DESI DR1</option>
              <option value="gama">GAMA DR4</option>
            </select>
          </label>
          <label>
            Minimum redshift
            <input type="number" min="-0.01" max="10" step="0.01" value={zMin} onChange={(event) => setZMin(event.target.value)} />
          </label>
          <label>
            Maximum redshift
            <input type="number" min="0" max="10" step="0.01" value={zMax} onChange={(event) => setZMax(event.target.value)} />
          </label>
          <label>
            Catalogue class
            <select value={className} onChange={(event) => setClassName(event.target.value)}>
              <option value="all">All</option>
              {survey !== "gama" && (
                <>
                  <option value="GALAXY">GALAXY</option>
                  <option value="QSO">QSO</option>
                  <option value="STAR">STAR</option>
                </>
              )}
            </select>
          </label>
          <button type="submit" disabled={searching}>
            {searching ? "Querying source…" : "Search 25 records"}
          </button>
        </form>
        <div className="archive-api-note">
          <span>API</span>
          <code>{API_URL}</code>
        </div>
        {error && <p className="archive-error" role="alert">{error}</p>}
      </section>

      {search && (
        <section className="archive-results">
          <div className="archive-section-head">
            <div>
              <span>{search.release}</span>
              <h2>{search.result_count} catalogue records</h2>
            </div>
            <p>
              Source: {search.provenance.catalogue}<br />
              Retrieved {new Date(search.provenance.retrieved_at).toLocaleString()}
            </p>
          </div>
          <div className="archive-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Catalogue class</th>
                  <th>Redshift</th>
                  <th>RA / Dec</th>
                  <th>Quality</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {search.results.map((result) => (
                  <tr key={result.id}>
                    <td><strong>{result.display_id}</strong><small>{result.id}</small></td>
                    <td>{result.catalog_class ?? "Not supplied"}{result.catalog_subclass && <small>{result.catalog_subclass}</small>}</td>
                    <td>{result.redshift.toFixed(6)}</td>
                    <td>{result.ra_deg.toFixed(5)}°<small>{result.dec_deg >= 0 ? "+" : ""}{result.dec_deg.toFixed(5)}°</small></td>
                    <td>{qualityText(result)}</td>
                    <td>
                      <button onClick={() => loadSpectrum(result)} disabled={loadingSpectrum !== null}>
                        {loadingSpectrum === result.id ? "Loading…" : "Inspect spectrum"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="archive-query-details">
            <summary>Exact catalogue query and sources</summary>
            <pre>{typeof search.provenance.query === "string" ? search.provenance.query : JSON.stringify(search.provenance.query, null, 2)}</pre>
            <div>
              {search.provenance.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
              ))}
            </div>
          </details>
        </section>
      )}

      {selected && (
        <section className="archive-inspector">
          <div className="archive-section-head">
            <div>
              <span>Measured spectrum</span>
              <h2>{selected.object.display_id}</h2>
            </div>
            <div className={selected.validation.passed ? "archive-validation pass" : "archive-validation fail"}>
              {selected.validation.passed ? "Validation passed" : "Validation failed"}
            </div>
          </div>
          <div className="archive-evidence">
            <div>
              <ArchiveSpectrum payload={selected} />
              <button
                className="archive-enlarge"
                onClick={() => spectrumDialog.current?.showModal()}
              >
                Open enlarged spectrum
              </button>
            </div>
            <aside>
              <img src={cutoutUrl} alt={`Legacy Surveys colour cutout for ${selected.object.display_id}`} />
              <dl>
                <div><dt>Survey release</dt><dd>{selected.release}</dd></div>
                <div><dt>Catalogue class</dt><dd>{selected.object.catalog_class ?? "Not supplied"}</dd></div>
                <div><dt>Observed pixels</dt><dd>{selected.validation.checks.pixel_count}</dd></div>
                <div><dt>Wavelength unit</dt><dd>{selected.spectrum.units.wavelength}</dd></div>
                <div><dt>Redshift quality</dt><dd>{qualityText(selected.object)}</dd></div>
              </dl>
            </aside>
          </div>
          <div className="archive-provenance">
            <div>
              <span>Provenance</span>
              <p>{selected.provenance.catalogue}</p>
              <p>Retrieved {new Date(selected.provenance.retrieved_at).toLocaleString()}</p>
            </div>
            <div>
              {selected.provenance.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
              ))}
            </div>
          </div>
          <dialog className="archive-spectrum-dialog" ref={spectrumDialog}>
            <div className="archive-dialog-head">
              <div>
                <span>Observed-frame spectrum</span>
                <strong>{selected.object.display_id}</strong>
              </div>
              <button onClick={() => spectrumDialog.current?.close()}>Close</button>
            </div>
            <ArchiveSpectrum payload={selected} domain={zoomDomain} />
            <div className="archive-zoom-controls">
              <label>
                Blue limit
                <input
                  type="range"
                  min="0"
                  max="99"
                  value={zoomStart}
                  onInput={(event) =>
                    setZoomStart(Math.min(Number(event.currentTarget.value), zoomEnd - 1))
                  }
                />
              </label>
              <label>
                Red limit
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={zoomEnd}
                  onInput={(event) =>
                    setZoomEnd(Math.max(Number(event.currentTarget.value), zoomStart + 1))
                  }
                />
              </label>
              <button onClick={() => { setZoomStart(0); setZoomEnd(100); }}>
                Reset range
              </button>
            </div>
          </dialog>
        </section>
      )}
    </main>
  );
}
