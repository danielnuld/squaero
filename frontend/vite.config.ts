import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Single source of truth for the product version (issue #192): the repo-root
// VERSION file, shared with CMake project() and the Windows VERSIONINFO. The
// About panel (issue #181) reads it via utils/version.ts. Bump it in one place
// (see docs/VERSIONING.md).
const appVersion = readFileSync(
  fileURLToPath(new URL("../VERSION", import.meta.url)),
  "utf8",
).trim();

// The single-file plugin inlines all JS/CSS/assets into one self-contained
// dist/index.html, which is then embedded into the native binary
// (see cmake/EmbedAssets.cmake). This is what keeps Quaero a single executable.
export default defineConfig({
  plugins: [solid(), viteSingleFile()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    target: "esnext",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
  },
});
