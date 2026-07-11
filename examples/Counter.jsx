import { useState } from 'react';
import './Counter.css';

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export default function Counter() {
  const [count, setCount] = useState(0);
  const [clicks, setClicks] = useState(0);

  const bump = (delta) => {
    setCount(count + delta);
    setClicks(clicks + 1);
  };

  return (
    <div className="counter">
      <h1 style={{ marginTop: 0 }}>ReactCanvas demo</h1>
      <div className="stats">
        <Stat label="count" value={count} />
        <Stat label="clicks" value={clicks} />
      </div>
      <div className="buttons">
        <button onClick={() => bump(-1)}>−1</button>
        <button onClick={() => bump(1)}>+1</button>
        <button onClick={() => { setCount(0); setClicks(0); }}>reset</button>
      </div>
      <p>Edit this file — the preview reloads as you type.</p>
    </div>
  );
}
