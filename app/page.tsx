"use client";

import { useEffect, useMemo, useState } from "react";
import {
  categories,
  desiFamilies,
  spectralLines,
  type CategoryId,
} from "./data";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const OBS_MIN = 3600;
const OBS_MAX = 10000;

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
          <p className="eyebrow">A visual field guide for 4MOST</p>
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
            <span>4MOST LRS: 3700–9500 Å</span>
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
              <div><dt>IN 4MOST LRS?</dt><dd>{observedLine >= 3700 && observedLine <= 9500 ? "YES" : "NO"}</dd></div>
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
        <div><strong>LINE / ATLAS</strong><span>Transfer learning from SDSS and DESI to 4MOST</span></div>
        <p>Spectra: SDSS DR18 and DESI DR1. Postage stamps: SDSS DR18, with NASA SkyView DSS2 coverage outside the SDSS footprint. Class selections are educational guides, not definitive diagnoses.</p>
        <div className="footer-links">
          <a href="https://skyserver.sdss.org/dr18/" target="_blank" rel="noreferrer">SDSS ↗</a>
          <a href="https://data.desi.lbl.gov/doc/releases/dr1/" target="_blank" rel="noreferrer">DESI DR1 ↗</a>
        </div>
      </footer>
    </main>
  );
}
