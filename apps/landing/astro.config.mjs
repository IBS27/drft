import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://trydrft.app",
  devToolbar: { enabled: false },
  vite: { plugins: [tailwindcss()] },
});
