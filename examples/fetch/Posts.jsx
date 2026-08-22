import { useEffect, useState } from 'react';

// Network demo: components can call fetch against any HTTPS API that allows
// cross-origin requests. The preview iframe is sandboxed, so requests are sent
// with `Origin: null` — public APIs like this one accept that.
function usePosts() {
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('https://jsonplaceholder.typicode.com/posts?_limit=5')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => !cancelled && setPosts(data))
      .catch((err) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, []);

  return { posts, error };
}

export default function Posts() {
  const { posts, error } = usePosts();

  if (error) {
    return <p style={{ color: 'crimson' }}>Failed to load: {error.message}</p>;
  }
  if (!posts) {
    return <p>Loading…</p>;
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 480, margin: '2rem auto' }}>
      <h1 style={{ fontSize: '1.1rem' }}>Latest posts</h1>
      <ul>
        {posts.map((post) => (
          <li key={post.id} style={{ marginBottom: '0.5rem' }}>
            {post.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
