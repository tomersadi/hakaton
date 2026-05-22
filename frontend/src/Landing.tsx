import { useState, useEffect, useRef } from 'react';

const BEFORE_CUSTOMERS = [
  { id: 'C-441', name: 'David M.', debt: '$12,400' },
  { id: 'C-882', name: 'Sara K.',  debt: '$8,200'  },
  { id: 'C-203', name: 'Ron T.',   debt: '$31,000' },
  { id: 'C-654', name: 'Lea P.',   debt: '$5,700'  },
  { id: 'C-117', name: 'Avi N.',   debt: '$19,500' },
];

const AFTER_CUSTOMERS = [
  { id: 'C-203', name: 'Ron T.',   debt: '$31,000', prob: 94, color: '#10b981' },
  { id: 'C-117', name: 'Avi N.',   debt: '$19,500', prob: 81, color: '#10b981' },
  { id: 'C-441', name: 'David M.', debt: '$12,400', prob: 67, color: '#f59e0b' },
  { id: 'C-882', name: 'Sara K.',  debt: '$8,200',  prob: 38, color: '#f59e0b' },
  { id: 'C-654', name: 'Lea P.',   debt: '$5,700',  prob: 14, color: '#ef4444' },
];

const BEFORE_ORDER    = [2, 0, 4, 1, 3];
const BEFORE_OUTCOMES = [false, false, true, false, true];
const AFTER_OUTCOMES  = [true, true, true, false, false];
const TICK = 1200;

// ── Minimal agent figure ─────────────────────────────────────────────────────
function Agent({ stressed }: { stressed: boolean }) {
  return (
    <svg width="48" height="76" viewBox="0 0 48 76" className={stressed ? 'agent-stressed' : 'agent-happy'}>
      {/* Head */}
      <circle cx="24" cy="14" r="11" fill={stressed ? '#FBBF24' : '#FCD34D'} />
      {/* Hair */}
      <ellipse cx="24" cy="4" rx="11" ry="5" fill={stressed ? '#92400E' : '#78350F'} />
      {/* Eyes */}
      {stressed
        ? <><path d="M18 12 L21 15 M21 12 L18 15" stroke="#1F2937" strokeWidth="1.5" strokeLinecap="round"/><path d="M27 12 L30 15 M30 12 L27 15" stroke="#1F2937" strokeWidth="1.5" strokeLinecap="round"/></>
        : <><circle cx="19.5" cy="13.5" r="2" fill="#1F2937"/><circle cx="28.5" cy="13.5" r="2" fill="#1F2937"/><circle cx="20" cy="13" r="0.7" fill="white"/><circle cx="29" cy="13" r="0.7" fill="white"/></>
      }
      {/* Mouth */}
      {stressed
        ? <path d="M18 21 Q24 18 30 21" stroke="#1F2937" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        : <path d="M18 20 Q24 25 30 20" stroke="#1F2937" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      }
      {/* Sweat */}
      {stressed && <ellipse cx="34" cy="10" rx="2" ry="3" fill="#93C5FD" opacity="0.9" className="sweat-drop"/>}
      {/* Body */}
      <rect x="13" y="25" width="22" height="22" rx="6" fill={stressed ? '#4A90F0' : '#1A3A8A'}/>
      {/* Tie */}
      <path d="M22 25 L24 30 L26 25" fill="white" opacity="0.3"/>
      {/* Arms */}
      <line x1="13" y1="32" x2="2"  y2="44" stroke="#FBBF24" strokeWidth="3.5" strokeLinecap="round"/>
      <line x1="35" y1="32" x2="46" y2="42" stroke="#FBBF24" strokeWidth="3.5" strokeLinecap="round"/>
      {/* Phone */}
      <rect x="-4" y="41" width="7" height="11" rx="1.5" fill="#1F2937"/>
      <rect x="-3" y="42" width="5" height="8" rx="1" fill={stressed ? '#EF4444' : '#10B981'} opacity="0.9"/>
      {/* Legs */}
      <rect x="16" y="47" width="7" height="26" rx="3.5" fill="#374151"/>
      <rect x="25" y="47" width="7" height="26" rx="3.5" fill="#374151"/>
      <ellipse cx="19.5" cy="73" rx="6" ry="3" fill="#111827"/>
      <ellipse cx="28.5" cy="73" rx="6" ry="3" fill="#111827"/>
    </svg>
  );
}

// ── Floating money ────────────────────────────────────────────────────────────
function MoneyParticle({ delay, x, flying }: { delay: number; x: number; flying: boolean }) {
  return (
    <div className={flying ? 'money-fly-particle' : 'money-save-particle'}
      style={{ animationDelay: `${delay}s`, left: `${x}%` }}>
      <svg width="26" height="16" viewBox="0 0 26 16">
        <rect width="26" height="16" rx="3" fill={flying ? '#22C55E' : '#16A34A'}/>
        <rect x="2" y="2" width="22" height="12" rx="2" fill={flying ? '#16A34A' : '#15803D'}/>
        <text x="13" y="11" textAnchor="middle" fontSize="9" fill="#DCFCE7" fontWeight="bold">$</text>
      </svg>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Landing({ onStart }: { onStart: () => void }) {
  const [phase, setPhase]               = useState(0);
  const [activeIdx, setActiveIdx]       = useState(-1);
  const [callResults, setCallResults]   = useState<Record<string, boolean>>({});
  const [afterActive, setAfterActive]   = useState(-1);
  const [afterResults, setAfterResults] = useState<Record<string, boolean>>({});
  const [statsVisible, setStatsVisible] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase !== 0) return;
    setActiveIdx(-1); setCallResults({});
    const t: ReturnType<typeof setTimeout>[] = [];
    BEFORE_ORDER.forEach((ci, step) => {
      const c = BEFORE_CUSTOMERS[ci];
      t.push(setTimeout(() => setActiveIdx(ci),          500 + step * TICK));
      t.push(setTimeout(() => {
        setCallResults(p => ({ ...p, [c.id]: BEFORE_OUTCOMES[step] }));
        setActiveIdx(-1);
      }, 500 + step * TICK + 750));
    });
    t.push(setTimeout(() => setPhase(1), 500 + BEFORE_ORDER.length * TICK + 700));
    return () => t.forEach(clearTimeout);
  }, [phase]);

  useEffect(() => {
    if (phase !== 1) return;
    const t = setTimeout(() => setPhase(2), 2200);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 2) return;
    setAfterActive(-1); setAfterResults({}); setStatsVisible(false);
    const t: ReturnType<typeof setTimeout>[] = [];
    AFTER_CUSTOMERS.forEach((c, step) => {
      t.push(setTimeout(() => setAfterActive(step),      500 + step * TICK));
      t.push(setTimeout(() => {
        setAfterResults(p => ({ ...p, [c.id]: AFTER_OUTCOMES[step] }));
        setAfterActive(-1);
      }, 500 + step * TICK + 750));
    });
    const end = 500 + AFTER_CUSTOMERS.length * TICK + 750;
    t.push(setTimeout(() => setStatsVisible(true), end));
    t.push(setTimeout(() => setPhase(0), end + 3200));
    return () => t.forEach(clearTimeout);
  }, [phase]);

  const beforeOk   = Object.values(callResults).filter(Boolean).length;
  const afterOk    = Object.values(afterResults).filter(Boolean).length;
  const beforeDone = Object.keys(callResults).length === BEFORE_CUSTOMERS.length;

  const handleFile = (f: File) => { if (f) onStart(); };

  return (
    <div className="landing" onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>

      {/* ── Header ── */}
      <header className="lnd-header">
        <div className="lnd-logo">
          <img src="/cal-logo.svg" alt="Cal" className="lnd-logo-img" />
          <span className="lnd-logo-product">Collect</span>
        </div>
        <span className="lnd-badge">POC</span>
      </header>

      {/* ── Hero ── */}
      <section className="lnd-hero">
        <div className="lnd-hero-tag">AI-Powered Debt Collection</div>
        <h1 className="lnd-title">
          Stop guessing.<br />
          <span className="lnd-title-accent">Start collecting.</span>
        </h1>
        <p className="lnd-subtitle">
          Upload your customer file — our AI ranks who's most likely to pay
          so your agents never waste another call.
        </p>

        {/* How-it-works steps */}
        <div className="lnd-steps">
          {[
            { n: '1', icon: '📂', label: 'Upload CSV / XLSX' },
            { n: '2', icon: '🤖', label: 'AI ranks customers' },
            { n: '3', icon: '📞', label: 'Call best first' },
          ].map((s, i) => (
            <div key={s.n} className="lnd-step-wrap">
              <div className="lnd-step-card">
                <div className="lnd-step-icon">{s.icon}</div>
                <div className="lnd-step-n">Step {s.n}</div>
                <div className="lnd-step-label">{s.label}</div>
              </div>
              {i < 2 && <div className="lnd-step-arrow">→</div>}
            </div>
          ))}
        </div>
      </section>

      {/* ── Before / After animation ── */}
      <section className="lnd-anim-wrapper">

        {/* Phase dots */}
        <div className="lnd-phase-dots">
          {[0,1,2].map(i => (
            <div key={i} className={`lnd-phase-dot ${phase===i?'active':''}`}
              title={['Before','Analyzing','After'][i]}/>
          ))}
        </div>

        <div className="lnd-panels-row">

          {/* BEFORE */}
          <div className={`lnd-panel ${phase===0?'panel-active':''}`}>
            <div className="lnd-panel-header bad">
              <span className="panel-status-dot bad-dot"/>
              Before CalCollect
            </div>
            {/* Agents */}
            <div className="lnd-figures">
              <div className="lnd-figure-col">
                <Agent stressed />
                <div className="lnd-figure-label stressed-lbl">😤 Frustrated</div>
              </div>
              <div className="lnd-figure-col">
                <Agent stressed />
                <div className="lnd-figure-label stressed-lbl">😰 Overwhelmed</div>
              </div>
              {/* Money flying */}
              <div className="money-overlay">
                {[0,1,2,3].map(i=><MoneyParticle key={i} delay={i*0.5} x={8+i*22} flying/>)}
                <div className="money-label bad-money">💸 $47K lost / week</div>
              </div>
            </div>
            {/* Calls */}
            <div className="lnd-call-list">
              {BEFORE_CUSTOMERS.map((c, i) => {
                const res  = callResults[c.id];
                const busy = activeIdx === i;
                return (
                  <div key={c.id} className={`lnd-call-row ${busy?'busy':''} ${res===true?'row-ok':res===false?'row-fail':''}`}>
                    <span className="lnd-call-id">{c.id}</span>
                    <span className="lnd-call-name">{c.name}</span>
                    <span className="lnd-call-debt">{c.debt}</span>
                    <span className="lnd-call-icon">
                      {busy && '📞'}{res===true && '✓'}{res===false && '✗'}
                    </span>
                  </div>
                );
              })}
            </div>
            {beforeDone && (
              <div className="lnd-rate-badge bad-badge">
                {beforeOk}/{BEFORE_CUSTOMERS.length} collected &nbsp;·&nbsp; {Math.round(beforeOk/BEFORE_CUSTOMERS.length*100)}% success
              </div>
            )}
          </div>

          {/* MIDDLE */}
          <div className="lnd-mid">
            {phase === 1 ? (
              <div className="lnd-analyzing">
                <div className="lnd-spinner"/>
                <span>Analyzing…</span>
                <div className="lnd-ai-dots">
                  <div/><div/><div/>
                </div>
              </div>
            ) : (
              <div className="lnd-mid-static">
                <div className="lnd-mid-arrow">→</div>
                <div className="lnd-brand-pill">CalCollect</div>
              </div>
            )}
          </div>

          {/* AFTER */}
          <div className={`lnd-panel ${phase===2?'panel-active':''}`}>
            <div className="lnd-panel-header good">
              <span className="panel-status-dot good-dot"/>
              With CalCollect
            </div>
            {/* Agents */}
            <div className="lnd-figures">
              <div className="lnd-figure-col">
                <Agent stressed={false}/>
                <div className="lnd-figure-label happy-lbl">😊 Confident</div>
              </div>
              <div className="lnd-figure-col">
                <Agent stressed={false}/>
                <div className="lnd-figure-label happy-lbl">🎯 Efficient</div>
              </div>
              {/* Money saved */}
              <div className="money-overlay">
                {[0,1,2].map(i=><MoneyParticle key={i} delay={i*0.6} x={12+i*30} flying={false}/>)}
                <div className="money-label good-money">💰 $31K collected / week</div>
              </div>
            </div>
            {/* Calls */}
            <div className="lnd-call-list">
              {AFTER_CUSTOMERS.map((c, i) => {
                const res  = afterResults[c.id];
                const busy = afterActive === i;
                return (
                  <div key={c.id}
                    className={`lnd-call-row ${phase===2?'slide-in':''} ${busy?'busy':''} ${res===true?'row-ok':res===false?'row-fail':''}`}
                    style={{ animationDelay: `${i*0.06}s` }}>
                    <span className="lnd-rank-badge">#{i+1}</span>
                    <span className="lnd-call-name">{c.name}</span>
                    <span className="lnd-prob-pill" style={{ color: c.color }}>{c.prob}%</span>
                    <span className="lnd-call-icon">
                      {busy && '📞'}{res===true && '✓'}{res===false && '✗'}
                    </span>
                  </div>
                );
              })}
            </div>
            {statsVisible && (
              <div className="lnd-rate-badge good-badge">
                {afterOk}/{AFTER_CUSTOMERS.length} collected &nbsp;·&nbsp; {Math.round(afterOk/AFTER_CUSTOMERS.length*100)}% success
              </div>
            )}
          </div>

        </div>
      </section>

      {/* ── Stats ── */}
      <section className="lnd-stats">
        {[
          { n: '10x', l: 'Faster prioritization' },
          { n: '+60%', l: 'Collection success' },
          { n: 'AI', l: 'Explainable scoring' },
          { n: '0', l: 'Wasted calls' },
        ].map(s => (
          <div key={s.n} className="lnd-stat-card">
            <span className="lnd-stat-n">{s.n}</span>
            <span className="lnd-stat-l">{s.l}</span>
          </div>
        ))}
      </section>

      {/* ── CTA ── */}
      <section className="lnd-cta">
        <div className="lnd-cta-label">↓ Ready to start? Upload your file below</div>
        <button className="lnd-cta-btn" onClick={onStart}>
          <span className="lnd-cta-upload-icon">☁</span>
          Upload Your File
          <span className="lnd-cta-arrow">→</span>
        </button>
        <p className="lnd-cta-sub">
          Drag &amp; drop or click · CSV / XLSX · AI ranking in under 30 seconds
        </p>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}/>
      </section>

    </div>
  );
}
