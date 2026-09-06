import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import react from "@astrojs/react";

// The build output is served by the Worker as static assets — see wrangler.jsonc.
export default defineConfig({
  output: "static",
  integrations: [tailwind(), react()],
});
