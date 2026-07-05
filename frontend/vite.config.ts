import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { viteSingleFile } from "vite-plugin-singlefile";
import pkg from "./package.json";

// The single-file plugin inlines all JS/CSS/assets into one self-contained
// dist/index.html, which is then embedded into the native binary
// (see cmake/EmbedAssets.cmake). This is what keeps Quaero a single executable.
export default defineConfig({
  plugins: [solid(), viteSingleFile()],
  // Single build-time source for the displayed app version (issue #181, About):
  // package.json's version is inlined so utils/version.ts can read it.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: "esnext",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
  },
});
