import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During `npm run dev` the panel runs on :5173 and proxies /api to the
// backend on :8000. In production the FastAPI app serves the built files,
// so no proxy is involved.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
