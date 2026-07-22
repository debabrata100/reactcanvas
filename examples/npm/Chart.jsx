import { useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { formatDistanceToNow } from 'date-fns';

// npm demo: `d3-scale` and `date-fns` are pulled from esm.sh automatically —
// no install step. React is shared with these packages, so hooks work as
// usual. Edit the data below and the preview live-reloads.
const SAMPLES = [12, 30, 45, 22, 60, 38, 51];

export default function Chart() {
  const [since] = useState(() => new Date());

  const y = useMemo(() => scaleLinear().domain([0, Math.max(...SAMPLES)]).range([0, 120]), []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '2rem auto' }}>
      <h1 style={{ fontSize: '1.1rem' }}>Weekly samples</h1>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
        {SAMPLES.map((value, i) => (
          <div
            key={i}
            title={String(value)}
            style={{ flex: 1, height: y(value), background: '#61dafb', borderRadius: '3px 3px 0 0' }}
          />
        ))}
      </div>
      <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>
        Rendered {formatDistanceToNow(since, { addSuffix: true })}
      </p>
    </div>
  );
}
