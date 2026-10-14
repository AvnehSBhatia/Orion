import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@huggingface/transformers", "onnxruntime-node", "sharp", "tesseract.js"],
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
