import { cpSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [
    react(),
    {
      name: "local-pdf-resources",
      closeBundle() {
        for (const directory of ["cmaps", "standard_fonts"]) {
          cpSync(
            new URL(`node_modules/pdfjs-dist/${directory}`, import.meta.url),
            new URL(`public/pdf/${directory}`, import.meta.url),
            { recursive: true },
          );
        }
      },
    },
  ],
  build: { outDir: "../public", emptyOutDir: true },
});
