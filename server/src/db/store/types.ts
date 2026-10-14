import type { Domain, ImageStatus, NodeType, PublicNode, ReadLink, Relation, SourceChange, SourceKind, Status, User } from "@/contract/types";

/** Every embedded item carries its model, a hash of the role context it was embedded with, and its org-space projection. */
export type Vectors = {
  embedding: Float32Array | null;
  embedModel: string | null;
  embedCtx: string | null;
  /** 64d org-space embedding from the active compressor. */
  z: Float32Array | null;
  zVersion: string | null;
  clusterId: string | null;
};

export type StoredNode = PublicNode & Vectors & { key: string };

export type StoredUser = User & {
  seedVec: Float32Array | null;
  seedModel: string | null;
  userVec: Float32Array | null;
  ranked: string[] | null;
  /** Packed Gravity, see src/orgspace/gravity.ts. */
  gravity: Float32Array | null;
  gravityVersion: string | null;
};

/** A captured page or a commit: the raw document behind graph changes. */
export type StoredSource = Vectors & {
  id: string;
  kind: SourceKind;
  ref: string;
  title: string;
  text: string;
  /** Text read off the screenshot. The chat model is text only, so this is how it sees the image. */
  ocrText: string;
  imageStatus: ImageStatus;
  authorId: string | null;
  createdAt: string;
  hasImage: boolean;
};

/** A source without its text: what ranking, projection, and maintenance need. Cheap to load for a whole org. */
export type SourceMeta = Omit<StoredSource, "text" | "ocrText">;

export type NewSource = Omit<StoredSource, keyof Vectors | "hasImage" | "ocrText" | "imageStatus"> & {
  image: Buffer | null;
  ocrText?: string;
  imageStatus?: ImageStatus;
};

/** Area and use of one node or source, as labeled by the org model. */
export type Facet = { itemId: string; itemKind: "node" | "source"; area: string; use: string; textHash: string };

/** A named region of the org space. `version` is the compressor id its centroid lives in. */
export type StoredCluster = { id: string; label: string; centroid: Float32Array; size: number; version: string };

/** Several similar sources merged into one short text, with the fidelity it passed. */
export type StoredDigest = {
  id: string;
  title: string;
  text: string;
  members: string[];
  membersKey: string;
  clusterId: string | null;
  fidelity: number;
  newestAt: string;
  createdAt: string;
  embedding: Float32Array | null;
  embedModel: string | null;
};

export type StoredSummary = { sourceId: string; text: string; textHash: string; fidelity: number };

export type StoredCompressor = {
  id: string;
  kind: "mrl" | "trained";
  weights: Float32Array;
  metrics: unknown;
  createdAt: string;
};

/** A node as extracted by the model, before it has an id or provenance. */
export type ExtractedNode = {
  label: string;
  type: NodeType;
  domain: Domain;
  summary: string;
  todo: string | null;
  readLinks: ReadLink[];
  owner: string | null;
  status: Status;
  /** null keeps the stored value. Only code ingest decides what sales can mention. */
  sellable: boolean | null;
};

/** Edge endpoints are labels (or ids) as the model wrote them, resolved at upsert time. */
export type ExtractedEdge = { source: string; target: string; relation: Relation };

export type GraphUpdate = { nodes: ExtractedNode[]; edges: ExtractedEdge[] };

export type Provenance = { sourceKind: SourceKind; sourceRef: string; now?: string };

export type NodeChange = Omit<SourceChange, "label">;

export const SOURCE_TEXT_MAX = 8_000;

export function toPublicNode(node: StoredNode): PublicNode {
  const { key: _k, embedding: _e, embedModel: _m, embedCtx: _c, z: _z, zVersion: _v, clusterId: _cl, ...rest } = node;
  return rest;
}

export function toPublicUser(user: StoredUser): User {
  return { id: user.id, name: user.name, role: user.role, teamDescription: user.teamDescription };
}
