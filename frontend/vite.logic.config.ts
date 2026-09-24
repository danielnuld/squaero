import { defineConfig } from "vite";

// squaero-logic.js for the iPhone app (issue #574): one IIFE that defines the
// global SquaeroLogic, for JavaScriptCore. No Solid plugin: nothing in it
// renders. ES2020 is what JavaScriptCore on iOS 17 runs without question.
export default defineConfig({
  build: {
    outDir: "dist-logic",
    target: "es2020",
    minify: false,
    lib: {
      entry: "src/logic.ts",
      name: "SquaeroLogic",
      formats: ["iife"],
      fileName: () => "squaero-logic.js",
    },
  },
});
