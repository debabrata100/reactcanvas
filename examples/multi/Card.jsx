export default function Card({ framework, liked, onToggle }) {
  return (
    <button className={`card ${liked ? 'liked' : ''}`} onClick={onToggle} style={{ borderColor: framework.color }}>
      <span className="dot" style={{ background: framework.color }} />
      <span className="name">{framework.name}</span>
      <span className="heart">{liked ? '♥' : '♡'}</span>
    </button>
  );
}
