import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist-client",
    emptyOutDir: true,
    // Dos apps (ERP y ECMS) sobre el mismo servidor: una página de entrada cada una
    rollupOptions: {
      input: {
        erp: path.resolve(__dirname, "erp.html"),
        ecms: path.resolve(__dirname, "ecms.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
