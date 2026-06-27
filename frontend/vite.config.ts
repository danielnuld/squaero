import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { viteSingleFile } from "vite-plugin-singlefile";

// The single-file plugin inlines all JS/CSS/assets into one self-contained
// dist/index.html, which is then embedded into the native binary
// (see cmake/EmbedAssets.cmake). This is what keeps Quaero a single executable.
export default defineConfig({
  plugins: [solid(), viteSingleFile()],
  build: {
    target: "esnext",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
  },
});
