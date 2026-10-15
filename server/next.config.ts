import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "package.json"), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@huggingface/transformers", "onnxruntime-node", "sharp", "tesseract.js"],
  turbopack: { root: import.meta.dirname },
  // Reported by GET /api/health. Set ORION_VERSION at build time (for example to the git sha) to override.
  env: { ORION_VERSION: process.env.ORION_VERSION || pkg.version },
};

export default nextConfig;
