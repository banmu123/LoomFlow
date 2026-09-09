import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react()],

  resolve: {
    alias: {
      "@desktop": path.resolve(__dirname, "src"),
      "@": path.resolve(__dirname, "../src"),
      "next/link": path.resolve(__dirname, "src/shims/next-link.tsx"),
      "next/navigation": path.resolve(__dirname, "src/shims/next-navigation.tsx"),
      "next/dynamic": path.resolve(__dirname, "src/shims/next-dynamic.tsx"),
      "next/image": path.resolve(__dirname, "src/shims/next-image.tsx"),
    },
    // 强制所有 import 解析到同一个 React 实例，避免 hooks 报错
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    modules: [
      path.resolve(__dirname, "node_modules"),
      path.resolve(__dirname, "../node_modules"),
      "node_modules",
    ],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
