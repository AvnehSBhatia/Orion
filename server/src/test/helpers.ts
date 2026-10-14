import { seedDemo } from "@/db/seed";
import { Store, type ExtractedNode, type GraphUpdate } from "@/db/store";
import type { IngestDeps } from "@/ingest/pipeline";
import { LocalHashEmbedder } from "@/llm/embed";
import type { Extractor } from "@/llm/extract";

export function memoryStore({ seed = false } = {}): Store {
  const store = Store.open(":memory:");
  if (seed) seedDemo(store);
  return store;
}

export function extracted(partial: Partial<ExtractedNode> & Pick<ExtractedNode, "label">): ExtractedNode {
  return {
    type: "feature",
    domain: "engineering",
    summary: `${partial.label} summary`,
    todo: null,
    readLinks: [],
    owner: null,
    status: "on_track",
    sellable: null,
    ...partial,
  };
}

/** Extractor that returns a fixed update and records what it was asked. */
export function fakeExtractor(update: GraphUpdate): Extractor & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async fromCapture(input) {
      calls.push(input);
      return update;
    },
    async fromCode(input) {
      calls.push(input);
      return update;
    },
  };
}

/** No background work; OCR reads `ocrText` off every screenshot (default: nothing, so screenshots are kept). */
export function deps(store: Store, update: GraphUpdate = { nodes: [], edges: [] }, { ocrText = "" } = {}) {
  const extractor = fakeExtractor(update);
  const d: IngestDeps = {
    store,
    embedder: new LocalHashEmbedder(),
    extractor,
    ocr: async () => ({ text: ocrText, confidence: ocrText ? 90 : 0 }),
  };
  return { ...d, extractor };
}
