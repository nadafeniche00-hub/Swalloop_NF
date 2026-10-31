import { useRef } from 'react';
import { registry } from './core/registry.js';

// The opening screen. Nothing is loaded until the user chooses: the tower case is a
// template like any other, only marked "featured" in its file.
export default function Start({ onTemplate, onBlank, onFile, error }) {
  const fileInput = useRef(null);
  const names = Object.keys(registry.templates);
  const info = registry.templateInfo;
  const featured = names.find((n) => info[n]?.featured) ?? names[0];
  const featuredGroup = info[featured]?.group;
  const variants = names.filter((n) => n !== featured && info[n]?.group === featuredGroup);
  const otherGroups = [...new Set(names.map((n) => info[n]?.group).filter((g) => g && g !== featuredGroup))];

  return (
    <div className="start">
      <header className="start-head">
        <svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true">
          <path d="M2 6 C16 2 26 10 32 22 C38 10 48 2 62 6 C50 8 42 16 36 28 L40 38 L32 31 L24 38 L28 28 C22 16 14 8 2 6 Z" fill="currentColor" />
        </svg>
        <div>
          <h1>Swalloop</h1>
          <p>Loops that take off, travel and come home. <span>Hironboucle · Schwalbenschleife</span></p>
        </div>
      </header>

      {featured && (
        <section className="start-feature">
          <div className="kicker">{featuredGroup}</div>
          <h2>{featured}</h2>
          <p>{info[featured]?.description}</p>
          <button className="primary" onClick={() => onTemplate(featured)}>
            Open the {featuredGroup?.toLowerCase() ?? 'template'} template
          </button>
          {variants.length > 0 && (
            <div className="start-variants">
              <span>or a variant:</span>
              {variants.map((n) => (
                <button key={n} title={info[n]?.description} onClick={() => onTemplate(n)}>
                  {n}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="start-row">
        <button className="card" onClick={onBlank}>
          <strong>Blank canvas</strong>
          <span>Start from nothing and wire your own loop.</span>
        </button>
        <button className="card" onClick={() => fileInput.current?.click()}>
          <strong>Open file…</strong>
          <span>A saved canvas (.swalloop.json).</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.swalloop"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
      </section>

      {error && <div className="start-error">{error}</div>}

      {otherGroups.map((g) => (
        <section key={g} className="start-group">
          <h3>{g}</h3>
          <div className="start-list">
            {names
              .filter((n) => info[n]?.group === g)
              .map((n) => (
                <button key={n} className="card small" onClick={() => onTemplate(n)}>
                  <strong>{n.replace(/^Demo: /, '')}</strong>
                  <span>{info[n]?.description}</span>
                </button>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
