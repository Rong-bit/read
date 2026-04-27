import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const plugins = {};

try {
  require.resolve("@tailwindcss/postcss");
  plugins["@tailwindcss/postcss"] = {};
} catch {
  // CI occasionally misses optional dependencies; fall back gracefully.
}

export default { plugins };
