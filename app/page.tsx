"use client";

import { useEffect, useMemo, useState } from "react";
import {
  categories,
  desiFamilies,
  spectralLines,
  type CategoryId,
} from "./data";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Survey = "sdss" | "desi";
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
};
type AtlasObject = SdssObject | DesiObject;
type Spectrum = { w: number[]; f: number[] };

const scale = (
  value: number,
  sourceMin: number,
  sourceMax: number,
  targetMin: number,
  targetMax: number,
) => targetMin + ((value - sourceMin) / (sourceMax - sourceMin)) * (targetMax - targetMin);

function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)] ?? 0;
}

function pathForSpectrum(
  spectrum: Spectrum,
  frame: "observed" | "rest",
  z: number,
  width = 1000,
  height = 430,
) {
  if (!spectrum.w.length) return "";
  const wavelengths = spectrum.w.map((value) =>
    frame === "rest" ? value / (1 + z) : value,
  );
  const xMin = wavelengths[0];
  const xMax = wavelengths[wavelengths.length - 1];
  const yMin = quantile(spectrum.f, 0.02);
  const yMax = quantile(spectrum.f, 0.98);
  const span = Math.max(yMax - yMin, 0.001);
  return wavelengths
    .map((wave, index) => {
      const x = 28 + ((wave - xMin) / (xMax - xMin)) * (width - 56);
      const y = height - 28 - ((spectrum.f[index] - yMin) / span) * (height - 58);
      return `${index ? "L" : "M"}${x.toFixed(1)},${Math.max(18, Math.min(height - 18, y)).toFixed(1)}`;
    })
    .join(" ");
}

function lineX(
  rest: number,
  frame: "observed" | "rest",
  z: number,
  spectrum: Spectrum,
  width = 1000,
) {
  if (!spectrum.w.length) return -1;
  const xMin = frame === "rest" ? spectrum.w[0] / (1 + z) : spectrum.w[0];
  const xMax =
    frame === "rest"
      ? spectrum.w[spectrum.w.length - 1] / (1 + z)
      : spectrum.w[spectrum.w.length - 1];
  const wave = frame === "rest" ? rest : rest * (1 + z);
  return 28 + ((wave - xMin) / (xMax - xMin)) * (width - 56);
}

function SpectrumPlot({
  spectrum,
  frame,
  z,
  lineIndex,
  onLine,
  color,
}: {
  spectrum: Spectrum | null;
  frame: "observed" | "rest";
  z: number;
  lineIndex: number;
  onLine: (index: number) => void;
  color: string;
}) {
  if (!spectrum) {
    return <div className="plot-loading">Loading calibrated flux…</div>;
  }
  const path = pathForSpectrum(spectrum, frame, z);
  const min =
    frame === "rest" ? spectrum.w[0] / (1 + z) : spectrum.w[0];
  const max =
    frame === "rest"
      ? spectrum.w[spectrum.w.length - 1] / (1 + z)
      : spectrum.w[spectrum.w.length - 1];
  return (
    <div className="science-plot">
      <svg viewBox="0 0 1000 430" role="img" aria-label={`${frame}-frame flux spectrum`}>
        <defs>
          <linearGradient id="plotFade" x1="0" x2="1">
            <stop offset="0" stopColor="#512884" />
            <stop offset=".32" stopColor="#2a809a" />
            <stop offset=".58" stopColor="#6f9838" />
            <stop offset=".8" stopColor="#c56a2d" />
            <stop offset="1" stopColor="#8e2332" />
          </linearGradient>
        </defs>
        <rect width="1000" height="430" fill="#f4f1e8" />
        {[0, 1, 2, 3, 4].map((tick) => (
          <line
            key={tick}
            x1="28"
            x2="972"
            y1={35 + tick * 88}
            y2={35 + tick * 88}
            stroke="#d8d4c9"
            strokeWidth="1"
          />
        ))}
        {spectralLines.map((line, index) => {
          const x = lineX(line.rest, frame, z, spectrum);
          if (x < 28 || x > 972) return null;
          const active = index === lineIndex;
          return (
            <g
              key={`${line.name}-${line.rest}`}
              onClick={() => onLine(index)}
              className="svg-line-marker"
            >
              <line
                x1={x}
                x2={x}
                y1="20"
                y2="402"
                stroke={active ? color : "#a8a49a"}
                strokeWidth={active ? 3 : 1}
                strokeDasharray={active ? undefined : "4 5"}
              />
              <text
                x={x + 5}
                y={active ? 34 : 48 + (index % 3) * 16}
                fill={active ? "#111" : "#6e6b64"}
                fontSize={active ? 15 : 11}
                fontWeight={active ? 700 : 500}
              >
                {line.name}
              </text>
            </g>
          );
        })}
        <path d={path} fill="none" stroke="#101314" strokeWidth="1.5" />
        <rect x="28" y="405" width="944" height="7" fill="url(#plotFade)" />
        <text x="28" y="426" fill="#575a55" fontSize="12">
          {min.toFixed(0)} Å
        </text>
        <text x="500" y="426" textAnchor="middle" fill="#575a55" fontSize="12">
          {frame === "observed" ? "OBSERVED WAVELENGTH" : "REST WAVELENGTH"}
        </text>
        <text x="972" y="426" textAnchor="end" fill="#575a55" fontSize="12">
          {max.toFixed(0)} Å
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
        <strong>Not assigned for this DESI teaching sample</strong>
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
  rows: SdssObject[];
  selected: SdssObject;
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
      row.bptX !== undefined &&
      row.bptY !== undefined &&
      row.bptX >= xMin &&
      row.bptX <= xMax &&
      row.bptY >= yMin &&
      row.bptY <= yMax,
  );
  const hasSelected = selected.bptX !== undefined && selected.bptY !== undefined;

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
  const [groupId, setGroupId] = useState<string>("star-forming");
  const [index, setIndex] = useState(0);
  const [frame, setFrame] = useState<"observed" | "rest">("observed");
  const [lineIndex, setLineIndex] = useState(15);
  const [spectrum, setSpectrum] = useState<Spectrum | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE_PATH}/data/sdss-catalog.json`).then((response) => response.json()),
      fetch(`${BASE_PATH}/data/desi-catalog.json`).then((response) => response.json()),
    ]).then(([sdssRows, desiRows]) => {
      setSdss(sdssRows);
      setDesi(desiRows);
    });
  }, []);

  const groups = survey === "sdss" ? categories : desiFamilies;
  const group = groups.find((item) => item.id === groupId) ?? groups[0];
  const objects = useMemo(
    () =>
      survey === "sdss"
        ? sdss.filter((item) => item.category === group.id)
        : desi.filter((item) => item.family === group.id),
    [survey, sdss, desi, group.id],
  );
  const object = objects[index % Math.max(objects.length, 1)] as AtlasObject | undefined;

  useEffect(() => {
    if (!object) return;
    setSpectrum(null);
    const key = survey === "sdss" ? object.id : (object as DesiObject).targetid;
    fetch(`${BASE_PATH}/${survey}/spectra-data/${key}.json`)
      .then((response) => response.json())
      .then(setSpectrum);
  }, [object, survey]);

  const switchSurvey = (next: Survey) => {
    setSurvey(next);
    setGroupId(next === "sdss" ? "star-forming" : "bgs");
    setIndex(0);
    setRevealed(false);
  };
  const chooseGroup = (id: string) => {
    setGroupId(id);
    setIndex(0);
    setRevealed(false);
  };
  const step = (amount: number) => {
    setIndex((current) => (current + amount + objects.length) % objects.length);
    setRevealed(false);
  };
  const randomise = () => {
    const next = groups[Math.floor(Math.random() * groups.length)];
    setGroupId(next.id);
    const count =
      survey === "sdss"
        ? sdss.filter((item) => item.category === next.id).length
        : desi.filter((item) => item.family === next.id).length;
    setIndex(Math.floor(Math.random() * Math.max(count, 1)));
    setRevealed(false);
  };

  if (!object) {
    return <main className="initial-loading">Preparing the spectral atlas…</main>;
  }

  const selectedLine = spectralLines[lineIndex];
  const observedLine = selectedLine.rest * (1 + object.z);
  const objectKey = survey === "sdss" ? object.id : (object as DesiObject).targetid;
  const stampUrl = `${BASE_PATH}/${survey}/stamps/${objectKey}.jpg`;
  const objectLabel =
    survey === "sdss"
      ? `${(object as SdssObject).plate}–${(object as SdssObject).mjd}–${String((object as SdssObject).fiber).padStart(4, "0")}`
      : `TARGETID ${(object as DesiObject).targetid}`;

  const downloadCard = async () => {
    if (!spectrum) return;
    setDownloading(true);
    try {
      const image = new Image();
      image.src = stampUrl;
      await image.decode();
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
      ctx.fillStyle = "#f4f1e8";
      ctx.fillRect(60, 155, 1090, 620);
      const path = pathForSpectrum(spectrum, frame, object.z, 1020, 520);
      const points = path.match(/[ML]([\d.]+),([\d.]+)/g) ?? [];
      ctx.save();
      ctx.translate(92, 190);
      ctx.strokeStyle = "#151718";
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach((point, i) => {
        const [, xs, ys] = point.match(/[ML]([\d.]+),([\d.]+)/)!;
        if (i === 0) ctx.moveTo(+xs, +ys);
        else ctx.lineTo(+xs, +ys);
      });
      ctx.stroke();
      spectralLines.forEach((line) => {
        const x = lineX(line.rest, frame, object.z, spectrum, 1020);
        if (x < 28 || x > 992) return;
        ctx.strokeStyle = `${group.color}99`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 15);
        ctx.lineTo(x, 505);
        ctx.stroke();
        ctx.fillStyle = "#555";
        ctx.font = "13px monospace";
        ctx.fillText(line.name, x + 4, 28);
      });
      ctx.restore();
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
            DESI DR1 <b>80</b>
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
            Compare 800 class-selected SDSS galaxies with an 80-object DESI DR1
            sample. Toggle the same calibrated spectrum between observed and
            rest wavelength to learn what the detector sees—and what the galaxy emitted.
          </p>
          <div className="instrument-strip">
            <span>{survey === "sdss" ? "SDSS DR18" : "DESI DR1"}</span>
            <strong>{survey === "sdss" ? "≈ 3800 — 9200 Å" : "3600 — 9824 Å"}</strong>
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
                <span className="count">{survey === "sdss" ? 100 : 20}</span>
              </button>
            ))}
          </nav>
          <div className="method-note">
            <span>Selection note</span>
            <p>
              {survey === "sdss"
                ? "Pipeline subclasses plus BPT line-ratio and MPA–JHU index selections. These are learning sets, not final physical diagnoses."
                : "Public DESI DR1 spectra grouped into redshift windows plus quasars. Use this section to see which rest-frame landmarks migrate through the observed band."}
            </p>
          </div>
        </aside>

        <div className="study-area">
          <div className="study-head">
            <div>
              <div className="section-label"><span>02</span> Inspect the evidence</div>
              <h2>{group.name}</h2>
            </div>
            <div className="object-id"><span>{survey.toUpperCase()} OBJECT</span><strong>{objectLabel}</strong></div>
            <div className="redshift"><span>REDSHIFT</span><strong>z {object.z.toFixed(4)}</strong></div>
          </div>

          <div className="evidence-grid" style={{ "--accent": group.color } as React.CSSProperties}>
            <div className="spectrum-card">
              <div className="card-toolbar">
                <div className="frame-switch">
                  <button className={frame === "observed" ? "active" : ""} onClick={() => setFrame("observed")}>Observed frame</button>
                  <button className={frame === "rest" ? "active" : ""} onClick={() => setFrame("rest")}>Rest frame</button>
                </div>
                <span>{frame === "observed" ? "What the instrument records" : "Wavelength ÷ (1 + z)"}</span>
              </div>
              <SpectrumPlot
                spectrum={spectrum}
                frame={frame}
                z={object.z}
                lineIndex={lineIndex}
                onLine={setLineIndex}
                color={group.color}
              />
            </div>

            <aside className="postage-card">
              <div className="stamp-wrap">
                <img src={stampUrl} alt={`Colour image of the selected ${group.name} object`} />
                <div className="crosshair" /><span className="north">N</span><span className="east">E</span>
              </div>
              <div className="coordinates">
                <span>RA {object.ra.toFixed(5)}°</span>
                <span>DEC {object.dec >= 0 ? "+" : ""}{object.dec.toFixed(5)}°</span>
              </div>
              <div className="stamp-caption"><span style={{ color: group.color }}>{group.short}</span><p>{group.lesson}</p></div>
            </aside>
          </div>

          <div className="object-navigation">
            <button onClick={() => step(-1)} aria-label="Previous object">←</button>
            <div className="sample-range">
              <input
                type="range"
                min="0"
                max={Math.max(objects.length - 1, 0)}
                value={index}
                onChange={(event) => setIndex(Number(event.target.value))}
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
              <div><dt>IN SURVEY BAND?</dt><dd>{observedLine >= (survey === "sdss" ? 3800 : 3600) && observedLine <= (survey === "sdss" ? 9200 : 9824) ? "YES" : "NO"}</dd></div>
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

      <section className="survey-compare">
        <div>
          <p className="eyebrow">One spectrum, two coordinate systems</p>
          <h2>Observed tells you where.<br />Rest tells you what.</h2>
        </div>
        <div className="compare-equation">
          <span>λ<sub>obs</sub></span><b>=</b><span>λ<sub>rest</sub></span><b>×</b><span>(1 + z)</span>
        </div>
        <p>
          SDSS supplies nearby examples where the familiar optical diagnostic
          lines often appear together. DESI extends the exercise to higher
          redshift, where the same rest-frame features slide redward and leave
          the detector one by one.
        </p>
      </section>

      <section className="export-panel">
        <div><p className="eyebrow">Turn looking into memory</p><h2>Keep the spectrum.<br />Build your own atlas.</h2></div>
        <p>Export the current numerical spectrum, marked lines, postage stamp, redshift and lesson as a 1600 × 900 PNG study card.</p>
        <button onClick={downloadCard} disabled={downloading || !spectrum}>
          {downloading ? "Composing image…" : "Download study card"} <span>↓</span>
        </button>
      </section>

      <footer>
        <div><strong>LINE / ATLAS</strong><span>Learn galaxy spectra with SDSS and DESI</span></div>
        <p>Spectra: SDSS DR18 and DESI DR1. Postage stamps: SDSS DR18, with NASA SkyView DSS2 coverage outside the SDSS footprint. Class selections are educational guides, not definitive diagnoses.</p>
        <div className="footer-links">
          <a href="https://skyserver.sdss.org/dr18/" target="_blank" rel="noreferrer">SDSS ↗</a>
          <a href="https://data.desi.lbl.gov/doc/releases/dr1/" target="_blank" rel="noreferrer">DESI DR1 ↗</a>
        </div>
      </footer>
    </main>
  );
}
