import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import monacoPluginImport from "vite-plugin-monaco-editor";

const monacoEditorPlugin = (monacoPluginImport as any).default ?? monacoPluginImport;
const port = Number.parseInt(process.env.VITE_PORT ?? "5173", 10) || 5173;

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    monacoEditorPlugin({
      languageWorkers: ["editorWorkerService", "typescript", "json", "html", "css"]
    })
  ],
  optimizeDeps: {
    // Prevent Vite from scanning the huge `reference/` tree (e.g. vendored VS Code sources)
    // which contains many *.html entries and will break dependency scanning.
    entries: ["index.html"]
  },
  build: {
    rollupOptions: {
      input: {
        app: "index.html"
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true
  }
});
