import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact(), cloudflare()],
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            main: resolve(import.meta.dirname, "index.html"),
            admin: resolve(import.meta.dirname, "admin/index.html"),
            getAndroid: resolve(import.meta.dirname, "get-android/index.html"),
            report: resolve(import.meta.dirname, "report/index.html"),
          },
        },
      },
    },
  },
});
