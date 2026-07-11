// The CJS *browser* build of esbuild-wasm shares the public API of the
// package root; it just runs the wasm in-process instead of spawning a
// child process (which the Node build does).
declare module 'esbuild-wasm/lib/browser.js' {
  export * from 'esbuild-wasm';
}
