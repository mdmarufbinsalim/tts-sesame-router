import React, { useEffect, useRef, useState } from 'react';

// Highlights each word as it is (estimated to be) spoken into the virtual mic.
// `schedule` = [{ w, t0, t1 }] in ms, relative to playback start.
export default function Karaoke({ schedule }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    startRef.current = performance.now();
    let raf;
    const tick = () => {
      setElapsed(performance.now() - startRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [schedule]);

  let activeIdx = -1;
  for (let i = 0; i < schedule.length; i++) {
    if (elapsed >= schedule[i].t0 && elapsed < schedule[i].t1) { activeIdx = i; break; }
    if (elapsed >= schedule[i].t1) activeIdx = i; // keep last spoken as active at the tail
  }

  return (
    <div className="karaoke">
      <div className="karaoke-label"><span className="tx-dot" /> transmitting to Sesame</div>
      <div className="karaoke-words">
        {schedule.map((s, i) => (
          <span
            key={i}
            className={`kw ${i === activeIdx ? 'active' : ''} ${elapsed >= s.t1 ? 'spoken' : ''}`}
          >
            {s.w}{' '}
          </span>
        ))}
      </div>
    </div>
  );
}
