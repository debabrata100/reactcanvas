import { useState } from 'react';
import Card from './Card';
import { FRAMEWORKS } from './data';
import './app.css';

// Multi-file demo: ReactCanvas follows the relative imports below and bundles
// Card.jsx, data.js and app.css into the preview. Edit any of them and the
// preview live-reloads.
export default function App() {
  const [liked, setLiked] = useState(() => new Set());

  const toggle = (name) =>
    setLiked((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  return (
    <div className="app">
      <h1>Pick your stack</h1>
      <div className="grid">
        {FRAMEWORKS.map((f) => (
          <Card key={f.name} framework={f} liked={liked.has(f.name)} onToggle={() => toggle(f.name)} />
        ))}
      </div>
      <p className="count">{liked.size} liked</p>
    </div>
  );
}
