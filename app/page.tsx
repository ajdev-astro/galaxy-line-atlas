"use client";

import { useMemo, useState } from "react";
import {
  categories,
  galaxies,
  spectralLines,
  type CategoryId,
} from "./data";

const LRS_MIN = 3700;
const LRS_MAX = 9500;

function imgUrl(kind: "spectrum" | "stamp", galaxy: (typeof galaxies)[number]) {
  return kind === "spectrum"
    ? `/api/sdss/spectrum?id=${galaxy.id}`
    : `/api/sdss/stamp?ra=${galaxy.ra}&dec=${galaxy.dec}`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export default function Home() {
  const [categoryId, setCategoryId] = useState<CategoryId>("star-forming");
  const [index, setIndex] = useState(0);
  const [lineIndex, setLineIndex] = useState(12);
  const [revealed, setRevealed] = useState(false);
  const [frame, setFrame] = useState<"observed" | "rest">("observed");
  const [downloading, setDownloading] = useState(false);

  const category = categories.find((item) => item.id === categoryId)!;
  const categoryGalaxies = useMemo(
    () => galaxies.filter((galaxy) => galaxy.category === categoryId),
    [categoryId],
  );
  const galaxy = categoryGalaxies[index % categoryGalaxies.length];
  const selectedLine = spectralLines[lineIndex];
  const observedLine = selectedLine.rest * (1 + galaxy.z);

  const chooseCategory = (id: CategoryId) => {
    setCategoryId(id);
    setIndex(0);
    setRevealed(false);
  };

  const step = (amount: number) => {
    setIndex((current) => (current + amount + categoryGalaxies.length) % categoryGalaxies.length);
    setRevealed(false);
  };

  const randomise = () => {
    const nextCategory = categories[Math.floor(Math.random() * categories.length)];
    setCategoryId(nextCategory.id);
    setIndex(Math.floor(Math.random() * 20));
    setRevealed(false);
  };

  const downloadCard = async () => {
    setDownloading(true);
    try {
      const [spectrum, stamp] = await Promise.all([
        loadImage(imgUrl("spectrum", galaxy)),
        loadImage(imgUrl("stamp", galaxy)),
      ]);
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 900;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0a0c0d";
      ctx.fillRect(0, 0, 1600, 900);

      ctx.strokeStyle = "#252a28";
      ctx.lineWidth = 1;
      for (let x = 40; x < 1560; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 900);
        ctx.stroke();
      }
      for (let y = 40; y < 900; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1600, y);
        ctx.stroke();
      }

      ctx.fillStyle = "#f4efdf";
      ctx.font = "700 58px Georgia";
      ctx.fillText("LINE / ATLAS", 58, 78);
      ctx.fillStyle = category.color;
      ctx.font = "600 24px ui-monospace";
      ctx.fillText(category.name.toUpperCase(), 60, 124);
      ctx.fillStyle = "#aaa99f";
      ctx.font = "18px ui-monospace";
      ctx.fillText(
        `SDSS ${galaxy.plate}-${galaxy.mjd}-${String(galaxy.fiber).padStart(4, "0")}   z = ${galaxy.z.toFixed(4)}`,
        292,
        124,
      );

      ctx.fillStyle = "#f6f2e8";
      ctx.fillRect(58, 160, 1090, 625);
      ctx.drawImage(spectrum, 70, 175, 1066, 598);
      ctx.drawImage(stamp, 1190, 160, 350, 350);
      ctx.strokeStyle = category.color;
      ctx.lineWidth = 4;
      ctx.strokeRect(1188, 158, 354, 354);

      ctx.fillStyle = "#f4efdf";
      ctx.font = "700 30px Georgia";
      ctx.fillText("What to notice", 1190, 560);
      ctx.fillStyle = "#c8c5ba";
      ctx.font = "21px Arial";
      const words = category.lesson.split(" ");
      let line = "";
      let y = 600;
      for (const word of words) {
        const test = `${line}${word} `;
        if (ctx.measureText(test).width > 345) {
          ctx.fillText(line, 1190, y);
          line = `${word} `;
          y += 31;
        } else line = test;
      }
      ctx.fillText(line, 1190, y);

      let x = 1190;
      y += 62;
      ctx.font = "600 17px ui-monospace";
      for (const feature of category.lookFor) {
        ctx.fillStyle = category.color;
        const width = ctx.measureText(feature).width + 24;
        if (x + width > 1540) {
          x = 1190;
          y += 38;
        }
        ctx.strokeStyle = category.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y - 24, width, 32);
        ctx.fillText(feature, x + 12, y);
        x += width + 10;
      }

      ctx.fillStyle = "#777b76";
      ctx.font = "16px ui-monospace";
      ctx.fillText("SDSS DR18 · spectrum and imaging", 60, 844);
      ctx.fillText("4MOST LRS transfer view · 3700–9500 Å", 1110, 844);

      const link = document.createElement("a");
      link.download = `line-atlas-${category.id}-${galaxy.plate}-${galaxy.mjd}-${galaxy.fiber}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      alert("The SDSS images are still loading. Please try the download again in a moment.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Line Atlas home">
          <span className="brand-mark">L/A</span>
          <span>
            <strong>LINE / ATLAS</strong>
            <small>Galaxy spectra by sight</small>
          </span>
        </a>
        <div className="survey-note">
          <span className="live-dot" />
          160 curated SDSS DR18 spectra
        </div>
        <button className="random-button" onClick={randomise}>
          <span>↝</span> Surprise me
        </button>
      </header>

      <section className="intro" id="top">
        <div>
          <p className="eyebrow">A visual field guide for 4MOST</p>
          <h1>Learn the lines.<br />Read the galaxy.</h1>
        </div>
        <div className="intro-copy">
          <p>
            Build pattern recognition with real SDSS spectra. Move from the continuum,
            to individual features, to the line ratios that separate star formation
            from nuclear activity.
          </p>
          <div className="instrument-strip">
            <span>4MOST LRS</span>
            <strong>3700 — 9500 Å</strong>
            <span>R ≈ 4,000–7,700</span>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="category-panel" aria-label="Galaxy categories">
          <div className="section-label">
            <span>01</span> Choose a population
          </div>
          <nav>
            {categories.map((item) => (
              <button
                key={item.id}
                className={item.id === categoryId ? "category active" : "category"}
                style={{ "--accent": item.color } as React.CSSProperties}
                onClick={() => chooseCategory(item.id)}
              >
                <span className="category-code">{item.short}</span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.signal}</small>
                </span>
                <span className="count">20</span>
              </button>
            ))}
          </nav>
          <div className="method-note">
            <span>Selection note</span>
            <p>
              Pipeline subclasses plus BPT line-ratio and MPA–JHU spectral-index selections.
            </p>
          </div>
        </aside>

        <div className="study-area">
          <div className="study-head">
            <div>
              <div className="section-label"><span>02</span> Inspect the evidence</div>
              <h2>{category.name}</h2>
            </div>
            <div className="object-id">
              <span>SDSS PLATE–MJD–FIBER</span>
              <strong>
                {galaxy.plate}–{galaxy.mjd}–{String(galaxy.fiber).padStart(4, "0")}
              </strong>
            </div>
            <div className="redshift">
              <span>REDSHIFT</span>
              <strong>z {galaxy.z.toFixed(4)}</strong>
            </div>
          </div>

          <div className="evidence-grid" style={{ "--accent": category.color } as React.CSSProperties}>
            <div className="spectrum-card">
              <div className="card-toolbar">
                <div className="frame-switch" role="group" aria-label="Wavelength frame">
                  <button className={frame === "observed" ? "active" : ""} onClick={() => setFrame("observed")}>Observed</button>
                  <button className={frame === "rest" ? "active" : ""} onClick={() => setFrame("rest")}>Rest guide</button>
                </div>
                <span>Flux density →</span>
              </div>
              <div className="spectrum-wrap">
                <img
                  key={galaxy.id}
                  src={imgUrl("spectrum", galaxy)}
                  alt={`SDSS spectrum for ${category.name} galaxy ${galaxy.plate}-${galaxy.mjd}-${galaxy.fiber}`}
                />
              </div>
              <div className="wavelength-ruler">
                <div className="ruler-labels"><span>3700 Å</span><span>4MOST LRS window</span><span>9500 Å</span></div>
                <div className="ruler-track">
                  {spectralLines.map((line, i) => {
                    const wave = frame === "observed" ? line.rest * (1 + galaxy.z) : line.rest;
                    const left = ((wave - LRS_MIN) / (LRS_MAX - LRS_MIN)) * 100;
                    if (left < 0 || left > 100) return null;
                    return (
                      <button
                        key={`${line.name}-${line.rest}`}
                        className={`line-marker ${i === lineIndex ? "active" : ""} ${line.kind}`}
                        style={{ left: `${left}%` }}
                        onClick={() => setLineIndex(i)}
                        title={`${line.name} ${line.rest} Å`}
                        aria-label={`Select ${line.name} at ${line.rest} angstrom`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            <aside className="postage-card">
              <div className="stamp-wrap">
                <img
                  key={`stamp-${galaxy.id}`}
                  src={imgUrl("stamp", galaxy)}
                  alt={`SDSS colour image of the selected ${category.name} galaxy`}
                />
                <div className="crosshair" />
                <span className="north">N</span>
                <span className="east">E</span>
              </div>
              <div className="coordinates">
                <span>RA {galaxy.ra.toFixed(5)}°</span>
                <span>DEC {galaxy.dec >= 0 ? "+" : ""}{galaxy.dec.toFixed(5)}°</span>
              </div>
              <div className="stamp-caption">
                <span style={{ color: category.color }}>{category.short}</span>
                <p>{category.lesson}</p>
              </div>
            </aside>
          </div>

          <div className="object-navigation">
            <button onClick={() => step(-1)} aria-label="Previous galaxy">←</button>
            <div className="sample-dots">
              {categoryGalaxies.map((item, i) => (
                <button
                  key={item.id}
                  className={i === index ? "active" : ""}
                  onClick={() => { setIndex(i); setRevealed(false); }}
                  aria-label={`Open example ${i + 1}`}
                >
                  {String(i + 1).padStart(2, "0")}
                </button>
              ))}
            </div>
            <button onClick={() => step(1)} aria-label="Next galaxy">→</button>
          </div>
        </div>
      </section>

      <section className="learning-grid">
        <article className="line-focus">
          <div className="section-label"><span>03</span> Decode a feature</div>
          <div className="line-focus-inner">
            <div className="line-number">{String(lineIndex + 1).padStart(2, "0")}</div>
            <div>
              <p className="line-kind">{selectedLine.kind}</p>
              <h3>{selectedLine.name}</h3>
              <p>{selectedLine.note}</p>
            </div>
            <dl>
              <div><dt>REST</dt><dd>{selectedLine.rest} Å</dd></div>
              <div><dt>OBSERVED</dt><dd>{observedLine.toFixed(0)} Å</dd></div>
              <div><dt>IN 4MOST LRS?</dt><dd>{observedLine >= LRS_MIN && observedLine <= LRS_MAX ? "YES" : "NO"}</dd></div>
            </dl>
          </div>
          <div className="line-chips" aria-label="Spectral line guide">
            {spectralLines.map((line, i) => (
              <button
                key={`${line.name}-${line.rest}-chip`}
                className={i === lineIndex ? "active" : ""}
                onClick={() => setLineIndex(i)}
              >
                <strong>{line.name}</strong><span>{line.rest}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="quiz-card" style={{ "--accent": category.color } as React.CSSProperties}>
          <div className="section-label"><span>04</span> Test your eye</div>
          <p className="quiz-kicker">ONE-MINUTE CHECK</p>
          <h3>{category.question}</h3>
          {revealed ? (
            <div className="answer"><span>Answer</span><p>{category.answer}</p></div>
          ) : (
            <button className="reveal" onClick={() => setRevealed(true)}>Reveal the reasoning →</button>
          )}
          <div className="look-for">
            <span>LOOK FOR</span>
            {category.lookFor.map((item) => <b key={item}>{item}</b>)}
          </div>
        </article>
      </section>

      <section className="export-panel">
        <div>
          <p className="eyebrow">Turn looking into memory</p>
          <h2>Keep the spectrum.<br />Build your own atlas.</h2>
        </div>
        <p>
          Export the current SDSS spectrum, postage stamp, class, redshift and
          “what to notice” notes as a 1600 × 900 PNG study card.
        </p>
        <button onClick={downloadCard} disabled={downloading}>
          {downloading ? "Composing image…" : "Download study card"} <span>↓</span>
        </button>
      </section>

      <footer>
        <div><strong>LINE / ATLAS</strong><span>Built for transfer learning from SDSS to 4MOST</span></div>
        <p>
          Spectra, classifications and images: Sloan Digital Sky Survey DR18.
          BPT classes are learning selections, not definitive physical diagnoses.
        </p>
        <a href="https://skyserver.sdss.org/dr18/" target="_blank" rel="noreferrer">Open SDSS SkyServer ↗</a>
      </footer>
    </main>
  );
}

