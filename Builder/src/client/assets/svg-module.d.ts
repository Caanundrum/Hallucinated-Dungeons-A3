/**
 * Vite serves `*.svg` imports as a built asset URL string. `types: []` in
 * `tsconfig.client.json` omits the ambient `vite/client` types that would
 * otherwise declare this, so Director avatar imports need this shim.
 */
declare module '*.svg' {
  const assetUrl: string;
  export default assetUrl;
}
