# Orion MCP server

Orion serves a read-only MCP server over Streamable HTTP at `/api/mcp`. A coding agent (Claude Code, Cursor, Codex) connects to it and pulls the latest org context for one person: what teammates captured in the browser (Google Ads, HubSpot, docs, consoles), what they committed, and the work graph built from it (status, owners, blockers, gaps).

The intended flow: someone changes a campaign in Google Ads, the Orion extension captures it, the graph updates. An engineer then asks their agent for a task, the agent calls `context_for_task`, saves the result to `.orion/context.md`, and works from it.

## Connect Claude Code

Authentication is a bearer token. Put yours in the environment:

```sh
export ORION_TOKEN=...   # your Orion token
```

Add the server (user scope, available in every repo):

```sh
claude mcp add --transport http orion https://<your-orion-host>/api/mcp \
  --header "Authorization: Bearer $ORION_TOKEN"
```

For local development against `npm run dev`:

```sh
claude mcp add --transport http orion http://localhost:3000/api/mcp \
  --header "Authorization: Bearer $ORION_TOKEN"
```

Or share it with the team by checking in `.mcp.json` at the repo root. Claude Code expands `${ORION_TOKEN}` from each developer's environment, so no secret is committed:

```json
{
  "mcpServers": {
    "orion": {
      "type": "http",
      "url": "https://<your-orion-host>/api/mcp",
      "headers": {
        "Authorization": "Bearer ${ORION_TOKEN}"
      }
    }
  }
}
```

Check it with `claude mcp list` or `/mcp` inside Claude Code.

Until token auth ships, the org and person come from the query string (`/api/mcp?orgId=demo&userId=devon`) or the `x-orion-org` and `x-orion-user` headers.

## Tools

All tools are read only.

| Tool | Use it for |
| --- | --- |
| `context_for_task` `{task, k?, sinceHours?}` | **Call at the start of every task.** Returns one markdown context file (under 12k chars, most relevant first) plus a JSON block with `write_to: ".orion/context.md"`, `itemIds`, `sourceIds`. |
| `search_context` `{query, limit?, sinceHours?}` | Search work items and source documents by meaning, ranked for this person. |
| `read_document` `{id}` | Full text of a source (`src-...`) or digest (`dg-...`): page text or diff, `ocrText` read off the screenshot, and the items it changed. |
| `whats_new` `{sinceHours?, limit?}` | Recent changes by other people that affect this person, with why each matters. |
| `graph_neighborhood` `{id, depth?}` | Items within 1 to 3 hops of a work item, with effective status (risk ripples down `blocks` and `feeds`), owner, and todo. |
| `get_my_context`, `find_items`, `search_sources`, `get_source`, `get_item`, `list_areas` | Older JSON tools, kept for existing clients. `get_source` is the same as `read_document`. |

### What `context_for_task` returns

Deterministic and fast: the only model call is embedding the task (about 0.3 s warm). Sections:

1. **Situation**: one paragraph. The closest item, how many related items are blocked or at risk and why, the latest change to this work, open gap count.
2. **Work items**: status (with the cause when risk rippled in from upstream), owner, todo, upstream blockers and feeders, downstream items, parent, read links, and why each item was included.
3. **What changed recently**: captures and commits that touched these items, newest first, with time, who, source URL, source id, and status flips such as `on track -> **blocked**`.
4. **Key documents**: excerpts with ids for `read_document`.
5. **Open gaps**: no owner, single-threaded deals.
6. **What to do next**: the top item's todo, the blockers to check first, the document to read in full, gaps to raise.

If the file would pass 12k chars, the middle sections are trimmed and a note says so. Gaps and next steps are always kept.

## Try it with curl

```sh
URL='http://localhost:3000/api/mcp?orgId=demo&userId=devon'
H=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H "Authorization: Bearer $ORION_TOKEN")

curl -s "${H[@]}" "$URL" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
curl -s "${H[@]}" "$URL" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s "${H[@]}" "$URL" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"context_for_task","arguments":{"task":"wire the voice latency fix to the audio streaming service"}}}'
```

The server is stateless, so each request stands alone. Responses come back as server-sent events (`data: {...}` lines).

## Skill

`.agents/skills/orion-context/SKILL.md` tells Claude Code to call `context_for_task` at the start of a task, write `.orion/context.md`, and drill in with the other tools. Add `.orion/` to your repo's ignore file.
