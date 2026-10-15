import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { DOMAINS, NODE_TYPES, STATUSES } from "@/contract/types";
import { readGraph } from "@/graph/view";
import { buildContext, findNodes, findSources, publicClusters } from "@/retrieval/context";
import { feedFor } from "@/retrieval/feed";
import { neighborhood } from "@/mcp/neighborhood";
import { buildTaskContext, WRITE_TO } from "@/mcp/taskContext";
import { isHidden, type Viewer } from "@/orgs/visibility";
import { getEmbedder, getStore, requireUser } from "@/http/deps";

const INSTRUCTIONS = `Orion holds the latest work context for one person in one org: what teammates captured from web pages and screenshots (Google Ads, HubSpot, docs, consoles), what they committed, and the work graph built from it (status, owners, blockers), ranked for this person.
At the start of any task, call context_for_task with the task in the user's words and save the returned markdown to ${WRITE_TO}. Then drill in with read_document (full text of a source id), graph_neighborhood (what blocks or feeds an item), search_context, and whats_new.
Cite sources by their ref (URL or repo@sha) when you rely on them. Everything here is read only.`;

const HIDDEN = "only the author and admins can read Mac activity text";
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

/** Read-only MCP server for one org and one person, built per request (stateless Streamable HTTP). */
export function mcpHandlerFor(orgId: string, userId: string, viewer: Viewer = null) {
  const store = getStore(orgId);
  const embedder = getEmbedder();
  requireUser(store, userId);

  return createMcpHandler(
    (server) => {
      server.registerTool(
        "context_for_task",
        {
          title: "Context for a task",
          description: `Call this at the start of any coding task. Returns ONE markdown context file tailored to the task: a situation summary, the most relevant work items (status, owner, todo, what blocks or feeds them), what teammates changed recently that touches them (newest first, with who, when, and source URL, including status flips like at_risk), key source documents (excerpts with ids for read_document), open gaps, and what to do next. Save the markdown to ${WRITE_TO} (overwrite) and read it before planning. Deterministic and fast, no LLM call.`,
          inputSchema: z.object({
            task: z.string().min(1).describe("The task in plain words, e.g. the user's request. More specific is better."),
            k: z.number().int().min(1).max(30).optional().describe("Work items to include, default 10."),
            sinceHours: z.number().positive().max(2160).optional().describe("How far back to look for changes, default 168 (7 days)."),
          }),
          annotations: READ_ONLY,
        },
        async ({ task, k, sinceHours }) => {
          const ctx = await buildTaskContext(store, embedder, { userId, task, k, sinceHours, viewer });
          const meta = {
            write_to: ctx.writeTo,
            hint: `Save the markdown above to ${ctx.writeTo} at the repo root, overwriting it. It is a local file; do not commit it.`,
            itemIds: ctx.itemIds,
            sourceIds: ctx.sourceIds,
            truncated: ctx.truncated,
          };
          return {
            content: [
              { type: "text" as const, text: ctx.markdown },
              { type: "text" as const, text: JSON.stringify(meta) },
            ],
          };
        },
      );

      server.registerTool(
        "search_context",
        {
          title: "Search Orion",
          description:
            "Search work items and source documents (captured pages, screenshots, commits) by meaning, ranked for this person. Use when context_for_task did not cover something. Returns items and document excerpts; call read_document for full text.",
          inputSchema: z.object({
            query: z.string().min(1),
            limit: z.number().int().min(1).max(20).optional().describe("Per kind, default 8 items and 5 documents."),
            sinceHours: z.number().positive().optional().describe("Only documents from the last N hours."),
          }),
          annotations: READ_ONLY,
        },
        async ({ query, limit, sinceHours }) => {
          const items = await findNodes(store, embedder, { userId, q: query, k: limit ?? 8 });
          const sources = await findSources(store, embedder, { userId, q: query, k: limit ?? 5, sinceHours, viewer });
          return json({ items: items.map(({ readLinks: _l, sourceKind: _k, sourceRef: _r, ...n }) => n), sources });
        },
      );

      server.registerTool(
        "read_document",
        {
          title: "Read a document",
          description:
            "Full text of one source document by id (src-... or dg-...): the captured page text or commit diff, plus ocrText read off the screenshot, and which work items it changed. Use ids from context_for_task, search_context, or whats_new.",
          inputSchema: z.object({ id: z.string().describe("A source id like src-81cd0e4490df, or a digest id like dg-...") }),
          annotations: READ_ONLY,
        },
        async ({ id }) => json(isHidden(store, viewer, id) ? { error: HIDDEN } : (store.readDocument(id) ?? { error: `unknown document ${id}` })),
      );

      server.registerTool(
        "graph_neighborhood",
        {
          title: "Graph neighborhood",
          description:
            "The work items around one item, up to `depth` hops: what blocks or feeds it, what it is part of, what it governs or influences, each with its effective status (risk ripples down blocks and feeds), owner, and todo. Use to explain why something is blocked or at risk.",
          inputSchema: z.object({
            id: z.string().describe("A work item id like voice-latency-fix."),
            depth: z.number().int().min(1).max(3).optional().describe("Hops to follow, default 1."),
          }),
          annotations: READ_ONLY,
        },
        async ({ id, depth }) => json(neighborhood(store, id, depth ?? 1) ?? { error: `unknown item ${id}` }),
      );

      server.registerTool(
        "get_my_context",
        {
          title: "Get my context",
          description:
            "Raw JSON version of context_for_task: the most relevant and most recent work items and source documents for this person, for an optional question. Prefer context_for_task at the start of a task.",
          inputSchema: z.object({
            query: z.string().optional().describe("The task or question. Omit for a general catch up."),
            limit: z.number().int().min(1).max(30).optional().describe("Work items to return, default 16."),
          }),
          annotations: READ_ONLY,
        },
        async ({ query, limit }) => {
          const ctx = await buildContext(store, embedder, { userId, q: query ?? "", k: limit ?? 16, viewer });
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
          description:
            "Recent changes feed: pages captured from tools like Google Ads or HubSpot, and commits, that other people added recently and that affect this person, most relevant first, with why each one matters and which items it changed or flipped status on.",
          inputSchema: z.object({
            sinceHours: z.number().positive().max(2160).optional().describe("Look back this many hours, default 72."),
            limit: z.number().int().min(1).max(50).optional().describe("Default 15."),
          }),
          annotations: READ_ONLY,
        },
        async ({ sinceHours, limit }) =>
          json({ items: await feedFor(store, embedder, { userId, sinceHours: sinceHours ?? 72, limit: limit ?? 15, viewer }) }),
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
          description: "Search captured pages, screenshots, and commits, ranked for this person. Returns excerpts; use read_document for full text.",
          inputSchema: z.object({
            query: z.string().optional(),
            sinceHours: z.number().positive().optional(),
            limit: z.number().int().min(1).max(20).optional(),
          }),
          annotations: READ_ONLY,
        },
        async ({ query, sinceHours, limit }) =>
          json({ sources: await findSources(store, embedder, { userId, q: query, k: limit ?? 5, sinceHours, viewer }) }),
      );

      server.registerTool(
        "get_source",
        {
          title: "Get a source document",
          description:
            "Same as read_document, kept for older clients. Full text of one captured page, commit, or digest by id, with what it changed and the text read off the screenshot.",
          inputSchema: z.object({ id: z.string() }),
          annotations: READ_ONLY,
        },
        async ({ id }) => json(isHidden(store, viewer, id) ? { error: HIDDEN } : (store.readDocument(id) ?? { error: `unknown source ${id}` })),
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
            const s = isHidden(store, viewer, sid) ? null : store.getSource(sid);
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
