import { useState } from 'react';

// Source-map demo: click the button to throw. The error overlay reports the
// failure at THIS file and line (Boom.jsx), not at some compiled blob URL.
function crash() {
  const value = null;
  return value.toUpperCase(); // ← throws: Cannot read properties of null
}

export default function Boom() {
  const [armed, setArmed] = useState(false);

  if (armed) {
    crash();
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', textAlign: 'center', marginTop: '3rem' }}>
      <h1>Source-map demo</h1>
      <p>Click to trigger a runtime error and check the overlay's line number.</p>
      <button onClick={() => setArmed(true)}>Throw an error</button>
    </div>
  );
}
