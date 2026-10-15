import type { NextConfig } from "next";
import path from "node:path";

// Demo mode (the scripted pitch: Tab types prompts, captions, card hints) is compiled in only when asked for.
// The app imports it as "orion-demo", which resolves to inert stubs in a normal build.
const demo = process.env.NEXT_PUBLIC_ORION_DEMO === "true";

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {
    // The repo root has its own lockfile (the backend); pin the web app to this folder.
    root: path.join(__dirname),
    resolveAlias: {
      "orion-demo": demo ? "./demo/entry.ts" : "./demo/off.ts",
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
