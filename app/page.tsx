"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  categories,
  desiFamilies,
  gamaFamilies,
  spectralLines,
  type CategoryId,
} from "./data";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Survey = "sdss" | "desi" | "gama";
type SdssObject = {
  id: string;
  ra: number;
  dec: number;
  z: number;
  plate: number;
  mjd: number;
  fiber: number;
  category: CategoryId;
  bptX?: number;
  bptY?: number;
  bptClass?: number;
  logMass?: number;
  logSfr?: number;
};
type DesiObject = {
  id: string;
  targetid: string;
  ra: number;
  dec: number;
  z: number;
  family: string;
  imageSource?: string;
};
type GamaObject = {
  id: string;
  cataid: string;
  uberID: string;
  name: string;
  ra: number;
  dec: number;
  z: number;
  category: string;
  imageSource: string;
  continuumSn: number;
  d4000: number;
  bptX?: number | null;
  bptY?: number | null;
};
type AtlasObject = SdssObject | DesiObject | GamaObject;
type Spectrum = { w: number[]; f: number[] };

const scale = (
  value: number,
  sourceMin: number,
  sourceMax: number,
  targetMin: number,
  targetMax: number,
) => targetMin + ((value - sourceMin) / (sourceMax - sourceMin)) * (targetMax - targetMin);

function quantile(values: number[], q: number) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)] ?? 0;
}

function niceTickStep(range: number, targetIntervals = 4) {
  const rough = Math.abs(range) / targetIntervals;
  if (!Number.isFinite(rough) || rough === 0) return 1;
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * power;
}

function binEdges(wavelengths: number[]) {
  if (wavelengths.length < 2) return [];
  const edges = new Array(wavelengths.length + 1);
  edges[0] = wavelengths[0] - (wavelengths[1] - wavelengths[0]) / 2;
  for (let index = 1; index < wavelengths.length; index += 1) {
    edges[index] = (wavelengths[index - 1] + wavelengths[index]) / 2;
  }
  edges[wavelengths.length] =
    wavelengths[wavelengths.length - 1] +
    (wavelengths[wavelengths.length - 1] - wavelengths[wavelengths.length - 2]) / 2;
  return edges;
}

function fluxConservingRebin(sourceWavelength: number[], sourceFlux: number[], targetWavelength: number[]) {
  const sourceEdges = binEdges(sourceWavelength);
  const targetEdges = binEdges(targetWavelength);
  const rebinned = new Array(targetWavelength.length).fill(Number.NaN);
  let sourceIndex = 0;
  for (let targetIndex = 0; targetIndex < targetWavelength.length; targetIndex += 1) {
    const left = targetEdges[targetIndex];
    const right = targetEdges[targetIndex + 1];
    while (sourceIndex < sourceFlux.length && sourceEdges[sourceIndex + 1] <= left) {
      sourceIndex += 1;
    }
    let cursor = sourceIndex;
    let integral = 0;
    let coverage = 0;
    while (cursor < sourceFlux.length && sourceEdges[cursor] < right) {
      const overlap = Math.max(
        0,
        Math.min(right, sourceEdges[cursor + 1]) - Math.max(left, sourceEdges[cursor]),
      );
      if (overlap > 0 && Number.isFinite(sourceFlux[cursor])) {
        integral += sourceFlux[cursor] * overlap;
        coverage += overlap;
      }
      cursor += 1;
    }
    if (coverage > 0.8 * (right - left)) rebinned[targetIndex] = integral / coverage;
  }
  return rebinned;
}

function gaussianSmooth(values: number[], sigma = 2.4) {
  const radius = Math.ceil(sigma * 4);
  const weights = Array.from(
    { length: radius * 2 + 1 },
    (_, index) => Math.exp(-0.5 * ((index - radius) / sigma) ** 2),
  );
  return values.map((_, index) => {
    let total = 0;
    let weight = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const value = values[index + offset];
      if (!Number.isFinite(value)) continue;
      const kernel = weights[offset + radius];
      total += value * kernel;
      weight += kernel;
    }
    return weight ? total / weight : Number.NaN;
  });
}

type PreparedSpectrum = Spectrum & { smooth: number[] };

function prepareSpectrum(
  spectrum: Spectrum,
  frame: "observed" | "rest",
  z: number,
) {
  const factor = frame === "rest" ? 1 + z : 1;
  const sourceWavelength = spectrum.w.map((value) => value / factor);
  // f_lambda d_lambda is conserved: compressing wavelength by (1+z)
  // requires multiplying the flux density by the same factor.
  const sourceFlux = spectrum.f.map((value) => value * factor);
  const count = Math.min(1600, sourceWavelength.length);
  const sourceEdges = binEdges(sourceWavelength);
  const min = sourceEdges[0];
  const max = sourceEdges[sourceEdges.length - 1];
  const width = (max - min) / count;
  const targetWavelength = Array.from(
    { length: count },
    (_, index) => min + (index + 0.5) * width,
  );
  const rebinnedFlux = fluxConservingRebin(sourceWavelength, sourceFlux, targetWavelength);
  return {
    w: targetWavelength,
    f: rebinnedFlux,
    smooth: gaussianSmooth(rebinnedFlux),
  };
}

function plotBounds(spectrum: PreparedSpectrum) {
  const low = quantile(spectrum.f, 0.01);
  const high = Math.max(quantile(spectrum.f, 0.995), quantile(spectrum.smooth, 1));
  const padding = Math.max((high - low) * 0.08, 0.01);
  const paddedMin = low - padding;
  const paddedMax = high + padding;
  const tickStep = niceTickStep(paddedMax - paddedMin);
  const yMin = Math.floor(paddedMin / tickStep) * tickStep;
  const yMax = Math.ceil(paddedMax / tickStep) * tickStep;
  const yTicks = Array.from(
    { length: Math.round((yMax - yMin) / tickStep) + 1 },
    (_, index) => yMin + index * tickStep,
  );
  return { yMin, yMax, yTicks };
}

function pathForSeries(
  wavelengths: number[],
  flux: number[],
  yMin: number,
  yMax: number,
  domainMin?: number,
  domainMax?: number,
  width = 1100,
  height = 650,
) {
  const xMin = domainMin ?? wavelengths[0];
  const xMax = domainMax ?? wavelengths[wavelengths.length - 1];
  const left = 95;
  const right = width - 35;
  const top = 105;
  const bottom = height - 85;
  let started = false;
  return wavelengths
    .map((wave, index) => {
      if (wave < xMin || wave > xMax || !Number.isFinite(flux[index])) {
        started = false;
        return "";
      }
      const x = scale(wave, xMin, xMax, left, right);
      const y = scale(Math.max(yMin, Math.min(yMax, flux[index])), yMin, yMax, bottom, top);
      const command = started ? "L" : "M";
      started = true;
      return `${command}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function lineX(
  rest: number,
  frame: "observed" | "rest",
  z: number,
  xMin: number,
  xMax: number,
) {
  const wave = frame === "rest" ? rest : rest * (1 + z);
  return scale(wave, xMin, xMax, 95, 1065);
}

function formatFlux(value: number) {
  if (Math.abs(value) >= 100 || (Math.abs(value) > 0 && Math.abs(value) < 0.1)) {
    return value.toExponential(1);
  }
  return value.toFixed(Math.abs(value) < 10 ? 1 : 0);
}

function truncateFixed(value: number, decimalPlaces: number) {
  const factor = 10 ** decimalPlaces;
  return (Math.floor(value * factor + 1e-8) / factor).toFixed(decimalPlaces);
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sdssDesignation(ra: number, dec: number) {
  const raHours = (((ra % 360) + 360) % 360) / 15;
  const raHour = Math.floor(raHours);
  const raMinutesFloat = (raHours - raHour) * 60;
  const raMinute = Math.floor(raMinutesFloat);
  const raSecond = (raMinutesFloat - raMinute) * 60;

  const absoluteDec = Math.abs(dec);
  const decDegree = Math.floor(absoluteDec);
  const decMinutesFloat = (absoluteDec - decDegree) * 60;
  const decMinute = Math.floor(decMinutesFloat);
  const decSecond = (decMinutesFloat - decMinute) * 60;

  return `SDSS J${String(raHour).padStart(2, "0")}${String(raMinute).padStart(2, "0")}${truncateFixed(raSecond, 2).padStart(5, "0")}${dec >= 0 ? "+" : "-"}${String(decDegree).padStart(2, "0")}${String(decMinute).padStart(2, "0")}${truncateFixed(decSecond, 1).padStart(4, "0")}`;
}

function StampImage({
  primaryUrl,
  fallbackUrl,
  alt,
  useCors,
}: {
  primaryUrl: string;
  fallbackUrl: string;
  alt: string;
  useCors: boolean;
}) {
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    if (primaryUrl === fallbackUrl) return;
    const timer = window.setTimeout(() => setUseFallback(true), 8000);
    return () => window.clearTimeout(timer);
  }, [primaryUrl, fallbackUrl]);

  return (
    <img
      src={useFallback ? fallbackUrl : primaryUrl}
      crossOrigin={!useFallback && useCors ? "anonymous" : undefined}
      onError={() => setUseFallback(true)}
      alt={alt}
    />
  );
}

function SpectrumPlot({
  spectrum,
  frame,
  z,
  lineIndex,
  onLine,
  color,
  survey,
  objectLabel,
  xRange,
  onZoomRange,
  interactive = false,
}: {
  spectrum: Spectrum | null;
  frame: "observed" | "rest";
  z: number;
  lineIndex: number;
  onLine: (index: number) => void;
  color: string;
  survey: Survey;
  objectLabel: string;
  xRange?: [number, number] | null;
  onZoomRange?: (range: [number, number] | null) => void;
  interactive?: boolean;
}) {
  const [dragStart, setDragStart] = useState<number | null>(null);
  if (!spectrum) {
    return <div className="plot-loading">Loading calibrated flux…</div>;
  }
  const prepared = prepareSpectrum(spectrum, frame, z);
  const fullMin = prepared.w[0];
  const fullMax = prepared.w[prepared.w.length - 1];
  const min = Math.max(fullMin, xRange?.[0] ?? fullMin);
  const max = Math.min(fullMax, xRange?.[1] ?? fullMax);
  const visibleIndices = prepared.w
    .map((wave, index) => (wave >= min && wave <= max ? index : -1))
    .filter((index) => index >= 0);
  const visibleSpectrum: PreparedSpectrum = {
    w: visibleIndices.map((index) => prepared.w[index]),
    f: visibleIndices.map((index) => prepared.f[index]),
    smooth: visibleIndices.map((index) => prepared.smooth[index]),
  };
  const { yMin, yMax, yTicks } = plotBounds(visibleSpectrum);
  const rawPath = pathForSeries(prepared.w, prepared.f, yMin, yMax, min, max);
  const smoothPath = pathForSeries(prepared.w, prepared.smooth, yMin, yMax, min, max);
  const xTicks = Array.from({ length: 7 }, (_, index) => min + ((max - min) * index) / 6);
  const pointerWavelength = (clientX: number, svg: SVGSVGElement) => {
    const bounds = svg.getBoundingClientRect();
    const viewX = ((clientX - bounds.left) / bounds.width) * 1100;
    return scale(Math.max(95, Math.min(1065, viewX)), 95, 1065, min, max);
  };
  return (
    <div className={interactive ? "science-plot interactive" : "science-plot"}>
      <svg
        viewBox="0 0 1100 650"
        role="img"
        aria-labelledby="spectrum-title spectrum-description"
        onPointerDown={(event) => {
          if (!interactive) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragStart(pointerWavelength(event.clientX, event.currentTarget));
        }}
        onPointerUp={(event) => {
          if (!interactive || dragStart === null || !onZoomRange) return;
          const end = pointerWavelength(event.clientX, event.currentTarget);
          setDragStart(null);
          if (Math.abs(end - dragStart) > (max - min) * 0.025) {
            onZoomRange([Math.min(dragStart, end), Math.max(dragStart, end)]);
          }
        }}
        onDoubleClick={() => interactive && onZoomRange?.(null)}
        onWheel={(event) => {
          if (!interactive || !onZoomRange) return;
          event.preventDefault();
          const center = pointerWavelength(event.clientX, event.currentTarget);
          const factor = event.deltaY < 0 ? 0.72 : 1.38;
          const nextWidth = Math.min(fullMax - fullMin, Math.max(120, (max - min) * factor));
          const leftFraction = (center - min) / (max - min);
          let nextMin = center - nextWidth * leftFraction;
          let nextMax = nextMin + nextWidth;
          if (nextMin < fullMin) {
            nextMin = fullMin;
            nextMax = fullMin + nextWidth;
          }
          if (nextMax > fullMax) {
            nextMax = fullMax;
            nextMin = fullMax - nextWidth;
          }
          onZoomRange([nextMin, nextMax]);
        }}
      >
        <title id="spectrum-title">{`${survey.toUpperCase()} ${frame}-frame spectrum for ${objectLabel}`}</title>
        <desc id="spectrum-description">
          Spectrum with labelled spectral features and numerical wavelength and flux-density axes.
        </desc>
        <defs>
          <clipPath id="spectrum-clip"><rect x="95" y="105" width="970" height="460" /></clipPath>
        </defs>
        <rect width="1100" height="650" fill="#fff" />
        <text x="95" y="31" className="plot-header">
          Survey: {survey.toUpperCase()} · Object: {objectLabel}
        </text>
        <text x="95" y="55" className="plot-header">
          z = {z.toFixed(5)} · {frame === "observed" ? "observed frame" : "rest frame"}
        </text>
        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={scale(tick, min, max, 95, 1065)} x2={scale(tick, min, max, 95, 1065)} y1="105" y2="565" className="plot-grid" />
            <line x1={scale(tick, min, max, 95, 1065)} x2={scale(tick, min, max, 95, 1065)} y1="565" y2="573" className="plot-axis" />
            <text x={scale(tick, min, max, 95, 1065)} y="594" textAnchor="middle" className="plot-tick">{tick.toFixed(0)}</text>
          </g>
        ))}
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line x1="95" x2="1065" y1={scale(tick, yMin, yMax, 565, 105)} y2={scale(tick, yMin, yMax, 565, 105)} className="plot-grid" />
            <line x1="87" x2="95" y1={scale(tick, yMin, yMax, 565, 105)} y2={scale(tick, yMin, yMax, 565, 105)} className="plot-axis" />
            <text x="80" y={scale(tick, yMin, yMax, 565, 105) + 4} textAnchor="end" className="plot-tick">{formatFlux(tick)}</text>
          </g>
        ))}
        <rect x="95" y="105" width="970" height="460" fill="none" className="plot-frame" />
        <g clipPath="url(#spectrum-clip)">
          <path d={rawPath} className="raw-spectrum" />
          <path d={smoothPath} className="smooth-spectrum" />
        </g>
        {spectralLines.map((line, index) => {
          const x = lineX(line.rest, frame, z, min, max);
          if (x < 95 || x > 1065) return null;
          const active = index === lineIndex;
          const featureColor = line.kind === "absorption" ? "#c83e35" : "#285fce";
          return (
            <g
              key={`${line.name}-${line.rest}`}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={() => onLine(index)}
              className="svg-line-marker"
            >
              <line
                x1={x}
                x2={x}
                y1={active ? 105 : 112 + (index % 3) * 18}
                y2={active ? 565 : 145 + (index % 3) * 18}
                stroke={active ? color : featureColor}
                strokeWidth={active ? 2.5 : 1.5}
                opacity={active ? 1 : 0.9}
              />
              {active && <rect x={x - 30} y="86" width="60" height="21" rx="2" fill={color} />}
              <text
                x={active ? x : x + 4}
                y={active ? 101 : 108 + (index % 3) * 18}
                textAnchor={active ? "middle" : "start"}
                fill={active ? "#fff" : featureColor}
                className="feature-label"
              >
                {line.name}
              </text>
            </g>
          );
        })}
        <text x="580" y="630" textAnchor="middle" className="plot-axis-label">
          {frame === "observed" ? "Observed wavelength" : "Rest-frame wavelength"} (Å)
        </text>
        <text x="24" y="335" textAnchor="middle" transform="rotate(-90 24 335)" className="plot-axis-label">
          Flux density (10⁻¹⁷ erg s⁻¹ cm⁻² Å⁻¹)
        </text>
      </svg>
    </div>
  );
}

function DiagnosticUnavailable({ title, note }: { title: string; note: string }) {
  return (
    <article className="diagnostic-card unavailable">
      <div className="diagnostic-title"><span>CATALOGUE VIEW</span><h3>{title}</h3></div>
      <div className="unavailable-inner">
        <strong>Not assigned for this survey sample</strong>
        <p>{note}</p>
      </div>
    </article>
  );
}

function BptPlot({
  rows,
  selected,
  color,
}: {
  rows: Array<{
    id: string;
    category: string;
    bptX?: number | null;
    bptY?: number | null;
  }>;
  selected: { bptX?: number | null; bptY?: number | null };
  color: string;
}) {
  const xMin = -2;
  const xMax = 0.5;
  const yMin = -1.5;
  const yMax = 1.5;
  const px = (value: number) => scale(value, xMin, xMax, 58, 610);
  const py = (value: number) => scale(value, yMin, yMax, 366, 24);
  const curve = (fn: (x: number) => number, from: number, to: number) =>
    Array.from({ length: 90 }, (_, index) => from + ((to - from) * index) / 89)
      .map((x, index) => `${index ? "L" : "M"}${px(x).toFixed(1)},${py(fn(x)).toFixed(1)}`)
      .join(" ");
  const valid = rows.filter(
    (row) =>
      isFiniteNumber(row.bptX) &&
      isFiniteNumber(row.bptY) &&
      row.bptX >= xMin &&
      row.bptX <= xMax &&
      row.bptY >= yMin &&
      row.bptY <= yMax,
  );
  const hasSelected =
    isFiniteNumber(selected.bptX) && isFiniteNumber(selected.bptY);

  return (
    <article className="diagnostic-card">
      <div className="diagnostic-title">
        <span>IONISATION SOURCE</span><h3>BPT position</h3>
        <p>log([N II]/Hα) versus log([O III]/Hβ)</p>
      </div>
      <svg viewBox="0 0 640 410" role="img" aria-label="BPT diagnostic diagram">
        <rect width="640" height="410" fill="#f4f1e8" />
        {[-2, -1.5, -1, -0.5, 0, 0.5].map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={px(tick)} x2={px(tick)} y1="24" y2="366" stroke="#ddd8ca" />
            <text x={px(tick)} y="389" textAnchor="middle">{tick}</text>
          </g>
        ))}
        {[-1.5, -1, -0.5, 0, 0.5, 1, 1.5].map((tick) => (
          <g key={`y-${tick}`}>
            <line x1="58" x2="610" y1={py(tick)} y2={py(tick)} stroke="#ddd8ca" />
            <text x="48" y={py(tick) + 4} textAnchor="end">{tick}</text>
          </g>
        ))}
        {valid.map((row) => (
          <circle key={`${row.id}-${row.category}`} cx={px(row.bptX!)} cy={py(row.bptY!)} r="2.1" fill="#777b76" opacity=".34" />
        ))}
        <path d={curve((x) => 0.61 / (x - 0.05) + 1.3, -1.95, -0.12)} fill="none" stroke="#28857c" strokeWidth="2" />
        <path d={curve((x) => 0.61 / (x - 0.47) + 1.19, -1.95, 0.23)} fill="none" stroke="#9a5d32" strokeWidth="2" strokeDasharray="6 5" />
        <text x={px(-1.55)} y={py(-.75)} className="region-label">STAR FORMING</text>
        <text x={px(-.62)} y={py(.25)} className="region-label">COMPOSITE</text>
        <text x={px(-.12)} y={py(1.05)} className="region-label">AGN</text>
        {hasSelected && (
          <>
            <circle cx={px(selected.bptX!)} cy={py(selected.bptY!)} r="9" fill={color} stroke="#111" strokeWidth="3" />
            <circle cx={px(selected.bptX!)} cy={py(selected.bptY!)} r="14" fill="none" stroke={color} strokeWidth="2" opacity=".5" />
          </>
        )}
        <text x="334" y="405" textAnchor="middle" className="axis-label">log([N II] λ6584 / Hα)</text>
        <text x="16" y="195" textAnchor="middle" transform="rotate(-90 16 195)" className="axis-label">log([O III] λ5007 / Hβ)</text>
      </svg>
      <p className="diagnostic-note">
        {hasSelected
          ? `This object lies at (${selected.bptX!.toFixed(2)}, ${selected.bptY!.toFixed(2)}). The background shows ${valid.length} reliable placements from this atlas.`
          : "No point is shown because one or more required emission lines has S/N below 3."}
      </p>
    </article>
  );
}

function MainSequencePlot({
  rows,
  selected,
  color,
}: {
  rows: SdssObject[];
  selected: SdssObject;
  color: string;
}) {
  const xMin = 8;
  const xMax = 12;
  const yMin = -3.5;
  const yMax = 2;
  const px = (value: number) => scale(value, xMin, xMax, 58, 610);
  const py = (value: number) => scale(value, yMin, yMax, 366, 24);
  const valid = rows.filter(
    (row) =>
      row.logMass !== undefined &&
      row.logSfr !== undefined &&
      row.logMass >= xMin &&
      row.logMass <= xMax &&
      row.logSfr >= yMin &&
      row.logSfr <= yMax,
  );
  const hasSelected = selected.logMass !== undefined && selected.logSfr !== undefined;

  return (
    <article className="diagnostic-card">
      <div className="diagnostic-title">
        <span>GALAXY GROWTH</span><h3>Stellar main sequence</h3>
        <p>Total MPA–JHU stellar mass and star-formation rate</p>
      </div>
      <svg viewBox="0 0 640 410" role="img" aria-label="Stellar mass versus star formation rate diagram">
        <rect width="640" height="410" fill="#f4f1e8" />
        {[8, 9, 10, 11, 12].map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={px(tick)} x2={px(tick)} y1="24" y2="366" stroke="#ddd8ca" />
            <text x={px(tick)} y="389" textAnchor="middle">{tick}</text>
          </g>
        ))}
        {[-3, -2, -1, 0, 1, 2].map((tick) => (
          <g key={`y-${tick}`}>
            <line x1="58" x2="610" y1={py(tick)} y2={py(tick)} stroke="#ddd8ca" />
            <text x="48" y={py(tick) + 4} textAnchor="end">{tick}</text>
          </g>
        ))}
        {valid.map((row) => (
          <circle key={`${row.id}-${row.category}`} cx={px(row.logMass!)} cy={py(row.logSfr!)} r="2.1" fill="#777b76" opacity=".34" />
        ))}
        <line x1={px(8.3)} y1={py(-1.4)} x2={px(11.4)} y2={py(.8)} stroke="#28857c" strokeWidth="2" strokeDasharray="7 6" />
        <text x={px(8.45)} y={py(-1.05)} className="region-label">STAR-FORMING LOCUS</text>
        <text x={px(10.65)} y={py(-2.35)} className="region-label">QUIESCENT</text>
        {hasSelected && (
          <>
            <circle cx={px(selected.logMass!)} cy={py(selected.logSfr!)} r="9" fill={color} stroke="#111" strokeWidth="3" />
            <circle cx={px(selected.logMass!)} cy={py(selected.logSfr!)} r="14" fill="none" stroke={color} strokeWidth="2" opacity=".5" />
          </>
        )}
        <text x="334" y="405" textAnchor="middle" className="axis-label">log(M★ / M☉)</text>
        <text x="16" y="195" textAnchor="middle" transform="rotate(-90 16 195)" className="axis-label">log(SFR / M☉ yr⁻¹)</text>
      </svg>
      <p className="diagnostic-note">
        {hasSelected
          ? `This object has log M★ = ${selected.logMass!.toFixed(2)} and log SFR = ${selected.logSfr!.toFixed(2)}. The grey cloud is the measured SDSS atlas sample.`
          : "No point is shown because the legacy MPA–JHU catalogue has no usable mass–SFR estimate for this object."}
      </p>
    </article>
  );
}

export default function Home() {
  const [survey, setSurvey] = useState<Survey>("sdss");
  const [sdss, setSdss] = useState<SdssObject[]>([]);
  const [desi, setDesi] = useState<DesiObject[]>([]);
  const [gama, setGama] = useState<GamaObject[]>([]);
  const [groupId, setGroupId] = useState<string>("star-forming");
  const [index, setIndex] = useState(0);
  const [frame, setFrame] = useState<"observed" | "rest">("observed");
  const [lineIndex, setLineIndex] = useState(16);
  const [spectrum, setSpectrum] = useState<Spectrum | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const spectrumDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE_PATH}/data/sdss-catalog.json`).then((response) => response.json()),
      fetch(`${BASE_PATH}/data/desi-catalog.json`).then((response) => response.json()),
      fetch(`${BASE_PATH}/data/gama-catalog.json`).then((response) => response.json()),
    ]).then(([sdssRows, desiRows, gamaRows]) => {
      setSdss(sdssRows);
      setDesi(desiRows);
      setGama(gamaRows);
    });
  }, []);

  useEffect(() => {
    const dialog = spectrumDialog.current;
    if (!dialog) return;
    if (expanded && !dialog.open) dialog.showModal();
    if (!expanded && dialog.open) dialog.close();
  }, [expanded]);

  const groups =
    survey === "sdss"
      ? categories
      : survey === "desi"
        ? desiFamilies
        : gamaFamilies;
  const group = groups.find((item) => item.id === groupId) ?? groups[0];
  const objects = useMemo(
    () =>
      survey === "sdss"
        ? sdss.filter((item) => item.category === group.id)
        : survey === "desi"
          ? desi.filter((item) => item.family === group.id)
          : gama.filter((item) => item.category === group.id),
    [survey, sdss, desi, gama, group.id],
  );
  const object = objects[index % Math.max(objects.length, 1)] as AtlasObject | undefined;

  useEffect(() => {
    if (!object) return;
    const key =
      survey === "desi" ? (object as DesiObject).targetid : object.id;
    fetch(`${BASE_PATH}/${survey}/spectra-data/${key}.json`)
      .then((response) => response.json())
      .then(setSpectrum);
  }, [object, survey]);

  const switchSurvey = (next: Survey) => {
    setSurvey(next);
    setGroupId(next === "desi" ? "bgs" : "star-forming");
    setIndex(0);
    setRevealed(false);
    setZoomRange(null);
  };
  const chooseGroup = (id: string) => {
    setGroupId(id);
    setIndex(0);
    setRevealed(false);
  };
  const step = (amount: number) => {
    setIndex((current) => (current + amount + objects.length) % objects.length);
    setRevealed(false);
    setZoomRange(null);
  };
  const randomise = () => {
    const next = groups[Math.floor(Math.random() * groups.length)];
    setGroupId(next.id);
    const count =
      survey === "sdss"
        ? sdss.filter((item) => item.category === next.id).length
        : survey === "desi"
          ? desi.filter((item) => item.family === next.id).length
          : gama.filter((item) => item.category === next.id).length;
    setIndex(Math.floor(Math.random() * Math.max(count, 1)));
    setRevealed(false);
    setZoomRange(null);
  };

  if (!object) {
    return <main className="initial-loading">Preparing the spectral atlas…</main>;
  }

  const selectedLine = spectralLines[lineIndex];
  const observedLine = selectedLine.rest * (1 + object.z);
  const objectKey =
    survey === "desi" ? (object as DesiObject).targetid : object.id;
  const localStampUrl = `${BASE_PATH}/${survey}/stamps/${objectKey}.jpg`;
  const legacyStampUrl =
    `https://www.legacysurvey.org/viewer/jpeg-cutout?ra=${object.ra}` +
    `&dec=${object.dec}&layer=ls-dr10&pixscale=0.262&size=360`;
  const surveyFallbackStampUrl =
    survey === "desi"
      ? localStampUrl
      : `https://skyserver.sdss.org/dr18/SkyServerWS/ImgCutout/getjpeg?ra=${object.ra}&dec=${object.dec}&scale=0.25&width=360&height=360`;
  const stampUrl = survey === "sdss" ? localStampUrl : legacyStampUrl;
  const stampSource =
    survey === "sdss"
      ? "SDSS DR18 colour"
      : "Legacy Surveys DR10";
  const objectLabel =
    survey === "sdss"
      ? sdssDesignation(object.ra, object.dec)
      : survey === "desi"
        ? `TARGETID ${(object as DesiObject).targetid}`
        : (object as GamaObject).name;
  const spectrumLabel =
    survey === "sdss"
      ? `spec-${String((object as SdssObject).plate).padStart(4, "0")}-${(object as SdssObject).mjd}-${String((object as SdssObject).fiber).padStart(4, "0")}`
      : survey === "gama"
        ? `AAOmega ${(object as GamaObject).id}`
        : null;
  const gamaIdentity =
    survey === "gama"
      ? `uberID ${(object as GamaObject).uberID} · CATAID ${(object as GamaObject).cataid}`
      : null;

  const adjustExpandedZoom = (factor: number) => {
    if (!spectrum) return;
    const prepared = prepareSpectrum(spectrum, frame, object.z);
    const fullMin = prepared.w[0];
    const fullMax = prepared.w[prepared.w.length - 1];
    const currentMin = zoomRange?.[0] ?? fullMin;
    const currentMax = zoomRange?.[1] ?? fullMax;
    const featureWave =
      frame === "rest" ? selectedLine.rest : selectedLine.rest * (1 + object.z);
    const center =
      featureWave >= currentMin && featureWave <= currentMax
        ? featureWave
        : (currentMin + currentMax) / 2;
    const width = Math.min(
      fullMax - fullMin,
      Math.max(120, (currentMax - currentMin) * factor),
    );
    let nextMin = center - width / 2;
    let nextMax = center + width / 2;
    if (nextMin < fullMin) {
      nextMin = fullMin;
      nextMax = fullMin + width;
    }
    if (nextMax > fullMax) {
      nextMax = fullMax;
      nextMin = fullMax - width;
    }
    setZoomRange([nextMin, nextMax]);
  };

  const downloadCard = async () => {
    if (!spectrum) return;
    setDownloading(true);
    try {
      const loadImage = async (url: string, cors: boolean) => {
        const candidate = new Image();
        if (cors) candidate.crossOrigin = "anonymous";
        candidate.src = url;
        await Promise.race([
          candidate.decode(),
          new Promise((_, reject) =>
            window.setTimeout(() => reject(new Error("Image load timed out")), 8000),
          ),
        ]);
        return candidate;
      };
      let image: HTMLImageElement;
      try {
        image = await loadImage(stampUrl, survey !== "sdss");
      } catch {
        image = await loadImage(surveyFallbackStampUrl, false);
      }
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 900;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0a0c0d";
      ctx.fillRect(0, 0, 1600, 900);
      ctx.fillStyle = "#f1eddf";
      ctx.font = "700 54px Georgia";
      ctx.fillText("LINE / ATLAS", 60, 75);
      ctx.fillStyle = group.color;
      ctx.font = "600 22px monospace";
      ctx.fillText(`${survey.toUpperCase()} · ${group.name.toUpperCase()}`, 62, 118);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(60, 155, 1090, 620);
      const prepared = prepareSpectrum(spectrum, frame, object.z);
      const { yMin, yMax } = plotBounds(prepared);
      const drawSeries = (values: number[], stroke: string, width: number) => {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.beginPath();
        let started = false;
        prepared.w.forEach((wave, index) => {
          if (!Number.isFinite(values[index])) {
            started = false;
            return;
          }
          const x = scale(wave, prepared.w[0], prepared.w[prepared.w.length - 1], 92, 1118);
          const y = scale(Math.max(yMin, Math.min(yMax, values[index])), yMin, yMax, 735, 190);
          if (started) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          started = true;
        });
        ctx.stroke();
      };
      drawSeries(prepared.f, "#c5c7c7", 1);
      drawSeries(prepared.smooth, "#111314", 2.5);
      spectralLines.forEach((line) => {
        const wavelength = frame === "rest" ? line.rest : line.rest * (1 + object.z);
        const x = scale(wavelength, prepared.w[0], prepared.w[prepared.w.length - 1], 92, 1118);
        if (x < 92 || x > 1118) return;
        ctx.strokeStyle = line.kind === "absorption" ? "#c83e35" : "#285fce";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 190);
        ctx.lineTo(x, 225);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = "13px monospace";
        ctx.fillText(line.name, x + 4, 187);
      });
      ctx.drawImage(image, 1190, 155, 350, 350);
      ctx.strokeStyle = group.color;
      ctx.lineWidth = 4;
      ctx.strokeRect(1188, 153, 354, 354);
      ctx.fillStyle = "#f1eddf";
      ctx.font = "700 28px Georgia";
      ctx.fillText(group.name, 1190, 560);
      ctx.fillStyle = "#b8bbb4";
      ctx.font = "19px Arial";
      const words = group.lesson.split(" ");
      let line = "";
      let y = 600;
      for (const word of words) {
        const test = `${line}${word} `;
        if (ctx.measureText(test).width > 345) {
          ctx.fillText(line, 1190, y);
          line = `${word} `;
          y += 29;
        } else line = test;
      }
      ctx.fillText(line, 1190, y);
      ctx.fillStyle = "#777b76";
      ctx.font = "16px monospace";
      ctx.fillText(`${objectLabel} · z=${object.z.toFixed(4)} · ${frame} frame`, 60, 840);
      const link = document.createElement("a");
      link.download = `line-atlas-${survey}-${group.id}-${objectKey}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top">
          <span className="brand-mark">L/A</span>
          <span><strong>LINE / ATLAS</strong><small>Galaxy spectra by sight</small></span>
        </a>
        <div className="survey-tabs" role="tablist" aria-label="Spectroscopic survey">
          <button className={survey === "sdss" ? "active" : ""} onClick={() => switchSurvey("sdss")}>
            SDSS <b>800</b>
          </button>
          <button className={survey === "desi" ? "active" : ""} onClick={() => switchSurvey("desi")}>
            DESI DR1 <b>400</b>
          </button>
          <button className={survey === "gama" ? "active" : ""} onClick={() => switchSurvey("gama")}>
            GAMA DR4 <b>400</b>
          </button>
        </div>
        <button className="random-button" onClick={randomise}><span>↝</span> Surprise me</button>
      </header>

      <section className="intro" id="top">
        <div>
          <p className="eyebrow">A visual field guide to galaxy spectra</p>
          <h1>Learn the lines.<br />Read the galaxy.</h1>
        </div>
        <div className="intro-copy">
          <p>
            Explore 800 SDSS, 400 DESI DR1 and 400 GAMA DR4 spectra across
            nearby galaxy populations and high-redshift systems. Toggle each
            spectrum between its observed and rest frames.
          </p>
          <div className="instrument-strip">
            <span>{survey === "sdss" ? "SDSS DR18" : survey === "desi" ? "DESI DR1" : "GAMA DR4 / AAOmega"}</span>
            <strong>{survey === "sdss" ? "≈ 3800 — 9200 Å" : survey === "desi" ? "3600 — 9824 Å" : "≈ 3727 — 8858 Å"}</strong>
            <span>Observed-frame coverage</span>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="category-panel">
          <div className="section-label"><span>01</span> Choose a population</div>
          <nav>
            {groups.map((item) => (
              <button
                key={item.id}
                className={item.id === group.id ? "category active" : "category"}
                style={{ "--accent": item.color } as React.CSSProperties}
                onClick={() => chooseGroup(item.id)}
              >
                <span className="category-code">{item.short}</span>
                <span><strong>{item.name}</strong><small>{item.signal}</small></span>
                <span className="count">100</span>
              </button>
            ))}
          </nav>
          <div className="method-note">
            <span>Selection note</span>
            <p>
              {survey === "sdss"
                ? "Pipeline subclasses plus BPT line-ratio and MPA–JHU index selections. These are learning sets, not final physical diagnoses."
                : survey === "desi"
                  ? "Public DESI DR1 spectra grouped into redshift windows plus quasars. Use this section to see which rest-frame landmarks migrate through the observed band."
                  : "GAMA DR4 best-redshift AAOmega spectra: four-line BPT selections for star-forming, composite and AGN-like systems, plus a strong-D4000 and weak-Hα quenched set."}
            </p>
          </div>
        </aside>

        <div className="study-area">
          <div className="study-head">
            <div>
              <div className="section-label"><span>02</span> Inspect the evidence</div>
              <h2>{group.name}</h2>
            </div>
            <div className="object-id">
              <span>{survey.toUpperCase()} OBJECT</span>
              <strong>{objectLabel}</strong>
              {gamaIdentity && <small>{gamaIdentity}</small>}
              {spectrumLabel && <small>{spectrumLabel}</small>}
            </div>
            <div className="redshift"><span>REDSHIFT</span><strong>z {object.z.toFixed(4)}</strong></div>
          </div>

          <div className="evidence-grid" style={{ "--accent": group.color } as React.CSSProperties}>
            <div className="spectrum-card">
              <div className="card-toolbar">
                <div className="frame-switch">
                  <button className={frame === "observed" ? "active" : ""} onClick={() => setFrame("observed")}>Observed frame</button>
                  <button className={frame === "rest" ? "active" : ""} onClick={() => setFrame("rest")}>Rest frame</button>
                </div>
                <button
                  className="expand-spectrum"
                  onClick={() => {
                    setZoomRange(null);
                    setExpanded(true);
                  }}
                >
                  Enlarge &amp; inspect ↗
                </button>
              </div>
              <SpectrumPlot
                spectrum={spectrum}
                frame={frame}
                z={object.z}
                lineIndex={lineIndex}
                onLine={setLineIndex}
                color={group.color}
                survey={survey}
                objectLabel={objectLabel}
              />
            </div>

            <aside className="postage-card">
              <div className="stamp-wrap">
                <StampImage
                  key={`${survey}-${objectKey}`}
                  primaryUrl={stampUrl}
                  fallbackUrl={surveyFallbackStampUrl}
                  useCors={survey !== "sdss"}
                  alt={`Colour image of the selected ${group.name} object`}
                />
                <div className="crosshair" /><span className="north">N</span><span className="east">E</span>
              </div>
              <div className="coordinates">
                <span>RA {object.ra.toFixed(5)}°</span>
                <span>DEC {object.dec >= 0 ? "+" : ""}{object.dec.toFixed(5)}°</span>
              </div>
              <div className="stamp-source">{stampSource}{survey !== "sdss" && " · automatic survey fallback"}</div>
              <div className="stamp-caption"><span style={{ color: group.color }}>{group.short}</span><p>{group.lesson}</p></div>
            </aside>
          </div>

          <dialog
            ref={spectrumDialog}
            className="spectrum-dialog"
            onClose={() => setExpanded(false)}
          >
            <div className="expanded-head">
              <div>
                <span>{survey.toUpperCase()} · {objectLabel}</span>
                <strong>{group.name} spectrum</strong>
              </div>
              <button onClick={() => setExpanded(false)} aria-label="Close enlarged spectrum">Close ×</button>
            </div>
            <div className="expanded-controls">
              <div className="frame-switch">
                <button className={frame === "observed" ? "active" : ""} onClick={() => { setFrame("observed"); setZoomRange(null); }}>Observed frame</button>
                <button className={frame === "rest" ? "active" : ""} onClick={() => { setFrame("rest"); setZoomRange(null); }}>Rest frame</button>
              </div>
              <label className="expanded-line-select">
                Spectral line
                <select
                  value={lineIndex}
                  onChange={(event) => setLineIndex(Number(event.target.value))}
                >
                  {spectralLines.map((line, lineOptionIndex) => (
                    <option
                      key={`${line.name}-${line.rest}`}
                      value={lineOptionIndex}
                    >
                      {line.name} · {line.rest} Å
                    </option>
                  ))}
                </select>
              </label>
              <div className="zoom-buttons">
                <button onClick={() => adjustExpandedZoom(0.6)}>Zoom in</button>
                <button onClick={() => adjustExpandedZoom(1.65)}>Zoom out</button>
                <button onClick={() => setZoomRange(null)}>Full range</button>
              </div>
            </div>
            <SpectrumPlot
              spectrum={spectrum}
              frame={frame}
              z={object.z}
              lineIndex={lineIndex}
              onLine={setLineIndex}
              color={group.color}
              survey={survey}
              objectLabel={objectLabel}
              xRange={zoomRange}
              onZoomRange={setZoomRange}
              interactive
            />
            <p className="expanded-hint">Drag across a wavelength interval or use the mouse wheel to zoom. Double-click to restore the full range.</p>
          </dialog>

          <div className="object-navigation">
            <button onClick={() => step(-1)} aria-label="Previous object">←</button>
            <div className="sample-range">
              <input
                type="range"
                min="0"
                max={Math.max(objects.length - 1, 0)}
                value={index}
                onChange={(event) => {
                  setIndex(Number(event.target.value));
                  setZoomRange(null);
                }}
                style={{ "--accent": group.color } as React.CSSProperties}
              />
              <span>{String(index + 1).padStart(2, "0")} / {objects.length}</span>
            </div>
            <button onClick={() => step(1)} aria-label="Next object">→</button>
          </div>
        </div>
      </section>

      <section className="learning-grid">
        <article className="line-focus">
          <div className="section-label"><span>03</span> Decode a feature</div>
          <div className="line-focus-inner">
            <div className="line-number">{String(lineIndex + 1).padStart(2, "0")}</div>
            <div><p className="line-kind">{selectedLine.kind}</p><h3>{selectedLine.name}</h3><p>{selectedLine.note}</p></div>
            <dl>
              <div><dt>REST</dt><dd>{selectedLine.rest} Å</dd></div>
              <div><dt>OBSERVED</dt><dd>{observedLine.toFixed(0)} Å</dd></div>
              <div>
                <dt>IN SURVEY BAND?</dt>
                <dd>
                  {observedLine >= (survey === "desi" ? 3600 : survey === "gama" ? 3727 : 3800) &&
                  observedLine <= (survey === "desi" ? 9824 : survey === "gama" ? 8858 : 9200)
                    ? "YES"
                    : "NO"}
                </dd>
              </div>
            </dl>
          </div>
          <div className="line-chips">
            {spectralLines.map((line, i) => (
              <button key={`${line.name}-${line.rest}`} className={i === lineIndex ? "active" : ""} onClick={() => setLineIndex(i)}>
                <strong>{line.name}</strong><span>{line.rest}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="quiz-card" style={{ "--accent": group.color } as React.CSSProperties}>
          <div className="section-label"><span>04</span> Test your eye</div>
          <p className="quiz-kicker">ONE-MINUTE CHECK</p>
          <h3>{group.question}</h3>
          {revealed ? (
            <div className="answer"><span>Answer</span><p>{group.answer}</p></div>
          ) : (
            <button className="reveal" onClick={() => setRevealed(true)}>Reveal the reasoning →</button>
          )}
          <div className="look-for"><span>LOOK FOR</span>{group.lookFor.map((item) => <b key={item}>{item}</b>)}</div>
        </article>
      </section>

      <section className="diagnostics" style={{ "--accent": group.color } as React.CSSProperties}>
        <div className="diagnostics-head">
          <div className="section-label"><span>05</span> Place the galaxy in context</div>
          <h2>From a spectrum to a population.</h2>
          <p>
            A spectrum becomes more informative when its line ratios and global
            properties are compared with the rest of the sample.
          </p>
        </div>
        <div className="diagnostic-grid">
          {survey === "sdss" ? (
            <>
              <BptPlot rows={sdss} selected={object as SdssObject} color={group.color} />
              <MainSequencePlot rows={sdss} selected={object as SdssObject} color={group.color} />
            </>
          ) : survey === "gama" ? (
            <>
              <BptPlot rows={gama} selected={object as GamaObject} color={group.color} />
              <DiagnosticUnavailable
                title="Stellar main sequence"
                note="The GAMA spectra and line measurements are in place. A single, survey-consistent stellar-mass and SFR value-added selection will be added before showing this population diagram."
              />
            </>
          ) : (
            <>
              <DiagnosticUnavailable
                title="BPT position"
                note="The DESI teaching subset currently stores spectra and redshifts, but not a homogeneous four-line flux catalogue. The spectrum still shows when the required lines enter or leave the band."
              />
              <DiagnosticUnavailable
                title="Stellar main sequence"
                note="A survey-consistent DESI stellar-mass and SFR value-added catalogue should be selected before placing these objects on a population diagram."
              />
            </>
          )}
        </div>
      </section>

      <section className="export-panel">
        <div><p className="eyebrow">Turn looking into memory</p><h2>Keep the spectrum.<br />Build your own atlas.</h2></div>
        <p>Export the current numerical spectrum, marked lines, postage stamp, redshift and lesson as a 1600 × 900 PNG study card.</p>
        <button onClick={downloadCard} disabled={downloading || !spectrum}>
          {downloading ? "Composing image…" : "Download study card"} <span>↓</span>
        </button>
      </section>

      <footer>
        <div><strong>LINE / ATLAS</strong><span>Learn galaxy spectra with SDSS, DESI and GAMA</span></div>
        <p>Spectra: SDSS DR18, DESI DR1 and GAMA DR4. Postage stamps: SDSS DR18 and Legacy Surveys DR10. Class selections are educational guides, not definitive diagnoses.</p>
        <div className="footer-links">
          <a href="https://skyserver.sdss.org/dr18/" target="_blank" rel="noreferrer">SDSS ↗</a>
          <a href="https://data.desi.lbl.gov/doc/releases/dr1/" target="_blank" rel="noreferrer">DESI DR1 ↗</a>
          <a href="https://www.gama-survey.org/dr4/" target="_blank" rel="noreferrer">GAMA DR4 ↗</a>
        </div>
      </footer>
    </main>
  );
}
