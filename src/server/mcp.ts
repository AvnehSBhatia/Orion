import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { DOMAINS, NODE_TYPES, STATUSES } from "@/contract/types";
import { readGraph } from "@/graph/view";
import { buildContext, findNodes, findSources, publicClusters } from "@/steer/context";
import { feedFor } from "@/steer/feed";
import { getEmbedder, getStore, requireUser } from "./deps";

const INSTRUCTIONS = `Orion holds the latest work context for one person in one org: what teammates captured from web pages and screenshots, what they committed, and the work graph built from it, ranked for this person.
Call get_my_context at the start of a task, with the task as the query. Call whats_new to catch up on what others changed that affects this person. Cite sources by their ref (URL or repo@sha) when you rely on them.
Everything here is read only.`;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

/** Read-only MCP server for one org and one person, built per request (stateless Streamable HTTP). */
export function mcpHandlerFor(orgId: string, userId: string) {
  const store = getStore(orgId);
  const embedder = getEmbedder();
  requireUser(store, userId);

  return createMcpHandler(
    (server) => {
      server.registerTool(
        "get_my_context",
        {
          title: "Get my context",
          description:
            "The most relevant and most recent work items and source documents for this person, for an optional question or task. Start here.",
          inputSchema: z.object({
            query: z.string().optional().describe("The task or question. Omit for a general catch up."),
            limit: z.number().int().min(1).max(30).optional().describe("Work items to return, default 16."),
          }),
          annotations: READ_ONLY,
        },
        async ({ query, limit }) => {
          const ctx = await buildContext(store, embedder, { userId, q: query ?? "", k: limit ?? 16 });
          return json({
            items: ctx.items.map(({ readLinks: _l, sourceKind: _k, sourceRef: _r, ...n }) => n),
            sources: ctx.sources,
          });
        },
      );

      server.registerTool(
        "whats_new",
        {
          title: "What's new for me",
          description: "Documents and commits other people added recently that affect this person, with why each one matters.",
          inputSchema: z.object({
            sinceHours: z.number().positive().max(2160).optional().describe("Look back this many hours, default 72."),
            limit: z.number().int().min(1).max(50).optional().describe("Default 15."),
          }),
          annotations: READ_ONLY,
        },
        async ({ sinceHours, limit }) =>
          json({ items: await feedFor(store, embedder, { userId, sinceHours: sinceHours ?? 72, limit: limit ?? 15 }) }),
      );

      server.registerTool(
        "find_items",
        {
          title: "Find work items",
          description:
            "Filter the work graph by status, sellable, domain, type, or recency, ranked for this person. Status includes risk passed down from blocked work.",
          inputSchema: z.object({
            query: z.string().optional(),
            statuses: z.array(z.enum(STATUSES)).optional(),
            sellable: z.boolean().optional(),
            domains: z.array(z.enum(DOMAINS)).optional(),
            types: z.array(z.enum(NODE_TYPES)).optional(),
            updatedWithinHours: z.number().positive().optional(),
            limit: z.number().int().min(1).max(50).optional(),
          }),
          annotations: READ_ONLY,
        },
        async ({ query, limit, ...filter }) =>
          json({ items: await findNodes(store, embedder, { userId, q: query, k: limit ?? 10, filter }) }),
      );

      server.registerTool(
        "search_sources",
        {
          title: "Search source documents",
          description: "Search captured pages, screenshots, and commits, ranked for this person. Returns excerpts; use get_source for full text.",
          inputSchema: z.object({
            query: z.string().optional(),
            sinceHours: z.number().positive().optional(),
            limit: z.number().int().min(1).max(20).optional(),
          }),
          annotations: READ_ONLY,
        },
        async ({ query, sinceHours, limit }) =>
          json({ sources: await findSources(store, embedder, { userId, q: query, k: limit ?? 5, sinceHours }) }),
      );

      server.registerTool(
        "get_source",
        {
          title: "Get a source document",
          description:
            "Full text of one captured page, commit, or digest by id, with what it changed. Includes text read off the screenshot. A digest lists the documents it merges.",
          inputSchema: z.object({ id: z.string() }),
          annotations: READ_ONLY,
        },
        async ({ id }) => json(store.readDocument(id) ?? { error: `unknown source ${id}` }),
      );

      server.registerTool(
        "list_areas",
        {
          title: "List org areas",
          description:
            "The named areas of this org (for example a team or workstream), each a cluster of related documents and work items. Questions are routed to the nearest area.",
          inputSchema: z.object({}),
          annotations: READ_ONLY,
        },
        async () => json({ areas: publicClusters(store) }),
      );

      server.registerTool(
        "get_item",
        {
          title: "Get a work item",
          description: "One work item by id with its direct links and the documents behind it, newest first.",
          inputSchema: z.object({ id: z.string() }),
          annotations: READ_ONLY,
        },
        async ({ id }) => {
          const graph = readGraph(store);
          const node = graph.nodes.find((n) => n.id === id);
          if (!node) return json({ error: `unknown item ${id}` });
          const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
          const links = graph.edges
            .filter((e) => e.source === id || e.target === id)
            .map((e) => ({ from: label.get(e.source), relation: e.relation, to: label.get(e.target) }));
          const sources = store.sourceIdsForNode(id, 5).flatMap((sid) => {
            const s = store.getSource(sid);
            return s ? [store.toPublicSource(s)] : [];
          });
          return json({ item: node, links, sources });
        },
      );
    },
    {
      serverInfo: { name: "orion", version: "0.1.0" },
      instructions: INSTRUCTIONS,
    },
  );
}
