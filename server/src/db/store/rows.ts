import type Database from "better-sqlite3";
import type { Vectors } from "./types";

/** The connection every table module works on. */
export type Db = Database.Database;

/** Vectors are stored as raw little-endian float32 blobs. */
export function toBlob(vec: Float32Array | null): Buffer | null {
  return vec ? Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength) : null;
}

export function fromBlob(buf: Buffer | null): Float32Array | null {
  if (!buf) return null;
  const copy = new Uint8Array(buf);
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

/** The vector columns shared by nodes and sources. */
export type VectorRow = {
  embedding: Buffer | null;
  embed_model: string | null;
  embed_ctx: string | null;
  z: Buffer | null;
  z_version: string | null;
  cluster_id: string | null;
};

export const NO_VECTORS: Vectors = { embedding: null, embedModel: null, embedCtx: null, z: null, zVersion: null, clusterId: null };

export function rowVectors(r: VectorRow): Vectors {
  return {
    embedding: fromBlob(r.embedding),
    embedModel: r.embed_model,
    embedCtx: r.embed_ctx,
    z: fromBlob(r.z),
    zVersion: r.z_version,
    clusterId: r.cluster_id,
  };
}
