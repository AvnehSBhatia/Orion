"use client";

// In-app viewer drawer for sources and nodes. Mounted once (AppShell); opened from anywhere via
// openSource(id) / openNode(id) in "@/lib/viewer". Esc or a click outside closes it.

import { Mark } from "@/components/ui/StatusMark";
import { api } from "@/lib/api/client";
import { friendlyError } from "@/lib/errors";
import type { PublicNode, Source, SourceDetail } from "@/lib/api/types";
import { DOMAIN_LABEL, DOMAIN_TINT } from "@/lib/domain";
import { refUrl, shortRef } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/status";
import { since } from "@/lib/time";
import { fetchSource, OPEN_NODE, OPEN_SOURCE, openNode, openSource } from "@/lib/viewer";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

type Target = { kind: "source" | "node"; id: string; at: number };

type View =
  | { kind: "source"; detail: SourceDetail }
  | { kind: "node"; node: PublicNode; related: Source[] }
  | { kind: "error"; message: string }
  | null;

export function SourceViewer({ orgId }: { orgId: string | null }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [view, setView] = useState<View>(null);

  useEffect(() => {
    const open = (kind: Target["kind"]) => (e: Event) => {
      setView(null);
      setTarget({ kind, id: (e as CustomEvent<{ id: string }>).detail.id, at: Date.now() });
    };
    const onSource = open("source");
    const onNode = open("node");
    window.addEventListener(OPEN_SOURCE, onSource);
    window.addEventListener(OPEN_NODE, onNode);
    return () => {
      window.removeEventListener(OPEN_SOURCE, onSource);
      window.removeEventListener(OPEN_NODE, onNode);
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTarget(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);

  useEffect(() => {
    if (!target || !orgId) return;
    let alive = true;
    const load = async (): Promise<View> => {
      if (target.kind === "source") return { kind: "source", detail: await fetchSource(orgId, target.id) };
      const [graph, activity] = await Promise.all([api.graph(orgId), api.activity(orgId, 120).catch(() => null)]);
      const node = graph.nodes.find((n) => n.id === target.id);
      if (!node) return { kind: "error", message: "That node is no longer in the graph." };
      const related = (activity?.sources ?? []).filter((s) => s.changes.some((c) => c.nodeId === node.id)).slice(0, 8);
      return { kind: "node", node, related };
    };
    load()
      .then((v) => alive && setView(v))
      .catch((e) => alive && setView({ kind: "error", message: friendlyError(e, "open this") }));
    return () => {
      alive = false;
    };
  }, [target, orgId]);

  const close = () => setTarget(null);

  // Focus moves into the drawer when it opens and back to whatever opened it when it closes.
  const panelRef = useRef<HTMLElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const open = !!target;
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>("button")?.focus(), 30);
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex='0']")];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", trap);
      returnTo.current?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          key="viewer"
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            data-testid="source-viewer"
            aria-label={target.kind === "source" ? "Source" : "Node"}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="absolute top-0 right-0 flex h-full w-full max-w-[560px] flex-col border-l border-line-strong bg-panel shadow-[-24px_0_48px_rgba(0,0,0,0.5)]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
              <span className="font-mono text-[11px] tracking-wide text-faint uppercase">{target.kind === "source" ? "Source" : "Node"}</span>
              <button
                type="button"
                onClick={close}
                className="rounded-md px-2 py-1 font-mono text-[11px] text-muted uppercase transition-colors hover:bg-raised hover:text-ink"
                aria-label="Close"
              >
                Esc
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {!view ? (
                <Loading />
              ) : view.kind === "error" ? (
                <p className="text-[14px] text-muted">{view.message}</p>
              ) : view.kind === "source" ? (
                <SourceBody orgId={orgId!} detail={view.detail} />
              ) : (
                <NodeBody node={view.node} related={view.related} />
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Loading() {
  return (
    <div className="space-y-3" aria-busy>
      <div className="h-5 w-3/4 animate-pulse rounded bg-raised" />
      <div className="h-3 w-1/3 animate-pulse rounded bg-raised" />
      <div className="h-32 w-full animate-pulse rounded bg-raised" />
    </div>
  );
}

function SourceBody({ orgId, detail }: { orgId: string; detail: SourceDetail }) {
  const { source, text, ocrText } = detail;
  const code = source.kind === "code";
  const body = text || source.excerpt;
  return (
    <article>
      <h2 className="text-[18px] leading-snug font-medium text-ink">{source.title || shortRef(source.ref)}</h2>
      <p className="mt-1 text-[13px] text-muted">
        {[source.authorName, since(source.createdAt), source.kind === "extension" ? "Page" : source.kind === "code" ? "Commit" : source.kind].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-faint">
        <span className="max-w-full truncate">{source.ref}</span>
        {refUrl(source.ref) && (
          <a href={refUrl(source.ref)!} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-line-strong px-2 py-0.5 text-ink hover:bg-raised">
            {source.kind === "code" ? "Open commit ↗" : "Open page ↗"}
          </a>
        )}
      </p>

      {source.changes.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {source.changes.map((c) => (
            <li key={c.nodeId + c.change}>
              <button
                type="button"
                onClick={() => openNode(c.nodeId)}
                className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                <Mark status={c.statusTo} size={10} />
                <span className="max-w-[22ch] truncate">{c.label}</span>
                <span className="text-faint">
                  {c.change === "created" ? "new" : c.statusFrom && c.statusFrom !== c.statusTo ? `${STATUS_LABEL[c.statusFrom]} → ${STATUS_LABEL[c.statusTo]}` : STATUS_LABEL[c.statusTo]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {source.hasImage && <Screenshot orgId={orgId} id={source.id} />}

      {body && (
        <pre
          className={
            code
              ? "mt-5 overflow-x-auto rounded-lg border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed whitespace-pre text-muted"
              : "mt-5 font-sans text-[14px] leading-relaxed whitespace-pre-wrap text-muted"
          }
        >
          {body}
        </pre>
      )}
      {ocrText && !text && <pre className="mt-4 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-faint">{ocrText}</pre>}
    </article>
  );
}

function NodeBody({ node, related }: { node: PublicNode; related: Source[] }) {
  return (
    <article>
      <p className="flex items-center gap-2 font-mono text-[11px] tracking-wide text-faint uppercase">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: DOMAIN_TINT[node.domain] }} />
        {DOMAIN_LABEL[node.domain]} · {node.type}
      </p>
      <h2 className="mt-1 text-[18px] leading-snug font-medium text-ink">{node.label}</h2>
      <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
        <Mark status={node.status} size={11} /> {STATUS_LABEL[node.status]}
        {node.owner && <> · {node.owner}</>} · {since(node.updatedAt)}
      </p>
      {node.summary && <p className="mt-4 text-[14px] leading-relaxed text-muted">{node.summary}</p>}
      {node.todo && (
        <p className="mt-3 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink">
          <span className="mr-1.5 font-mono text-[10.5px] text-faint uppercase">Next</span>
          {node.todo}
        </p>
      )}
      {node.readLinks.length > 0 && (
        <ul className="mt-4 space-y-1">
          {node.readLinks.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noreferrer" className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline">
                {l.title || shortRef(l.url)} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
      {related.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 font-mono text-[11px] tracking-wide text-faint uppercase">Sources</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {related.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => openSource(s.id)} className="block w-full px-3 py-2 text-left transition-colors hover:bg-raised">
                  <span className="block truncate text-[13px] text-ink">{s.title || shortRef(s.ref)}</span>
                  <span className="text-[12px] text-faint">{[s.authorName, since(s.createdAt)].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

/**
 * The capture's screenshot. Screenshots can be limited to their author and admins (403); the image is checked
 * with a credentialed request first so a refusal reads as a note, not a broken image.
 */
function Screenshot({ orgId, id }: { orgId: string; id: string }) {
  const [state, setState] = useState<{ id: string; url: string | null; status: number } | null>(null);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    fetch(api.sources.imageUrl(orgId, id), { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return alive && setState({ id, url: null, status: res.status });
        url = URL.createObjectURL(await res.blob());
        if (alive) setState({ id, url, status: 200 });
      })
      .catch(() => alive && setState({ id, url: null, status: 0 }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [orgId, id]);
  if (!state || state.id !== id) return <div className="mt-5 h-40 w-full animate-pulse rounded-lg bg-raised" aria-label="Loading screenshot" />;
  if (!state.url) {
    return (
      <p className="mt-5 rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted">
        {state.status === 403
          ? "Screenshot hidden. Only the person who captured it and your org's admins can see it."
          : state.status === 404
            ? "The screenshot was removed by your org's retention policy."
            : "The screenshot couldn't be loaded."}
      </p>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={state.url} alt="Screenshot of the captured page" className="mt-5 w-full rounded-lg border border-line" />;
}
