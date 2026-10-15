// A small Markdown renderer for our own documents (privacy policy, monitoring notice). Builds React elements,
// never HTML strings: headings, paragraphs, nested lists, blockquotes, rules, tables, bold, italic, code, links.

import { Fragment, type ReactNode } from "react";

const SAFE_LINK = /^(https?:\/\/|mailto:|\/|#)/i;

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${n++}`;
    if (t.startsWith("**")) out.push(<strong key={k} className="font-semibold text-ink">{inline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-raised px-1 font-mono text-[0.9em] text-ink">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label, href] = t.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/) ?? [];
      out.push(
        href && SAFE_LINK.test(href) ? (
          <a key={k} href={href} className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" rel="noreferrer">
            {inline(label, k)}
          </a>
        ) : (
          label
        ),
      );
    } else out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Item = { text: string; children: Item[] };

function parseList(lines: string[]): { items: Item[]; ordered: boolean } {
  const ordered = /^\s*\d+\.\s/.test(lines[0]);
  const base = lines[0].match(/^\s*/)![0].length;
  const items: Item[] = [];
  let sub: string[] = [];
  const flush = () => {
    if (sub.length && items.length) items[items.length - 1].children = parseList(sub).items;
    sub = [];
  };
  for (const line of lines) {
    const indent = line.match(/^\s*/)![0].length;
    if (indent <= base && /^\s*([-*+]|\d+\.)\s/.test(line)) {
      flush();
      items.push({ text: line.replace(/^\s*([-*+]|\d+\.)\s+/, ""), children: [] });
    } else if (indent > base) sub.push(line);
    else if (items.length) items[items.length - 1].text += ` ${line.trim()}`;
  }
  flush();
  return { items, ordered };
}

function List({ items, ordered, k }: { items: Item[]; ordered: boolean; k: string }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={ordered ? "my-3 list-decimal space-y-1.5 pl-6" : "my-3 list-disc space-y-1.5 pl-6"}>
      {items.map((item, i) => (
        <li key={i}>
          {inline(item.text, `${k}-${i}`)}
          {item.children.length > 0 && <List items={item.children} ordered={false} k={`${k}-${i}`} />}
        </li>
      ))}
    </Tag>
  );
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${n++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls = ["", "mt-2 text-[28px] font-semibold tracking-[-0.03em] text-ink", "mt-8 text-[19px] font-semibold tracking-[-0.02em] text-ink", "mt-6 text-[16px] font-medium text-ink", "mt-4 text-[15px] font-medium text-ink"][level];
      const content = inline(h[2], k);
      blocks.push(
        level === 1 ? <h1 key={k} className={cls}>{content}</h1> : level === 2 ? <h2 key={k} className={cls}>{content}</h2> : level === 3 ? <h3 key={k} className={cls}>{content}</h3> : <h4 key={k} className={cls}>{content}</h4>,
      );
      i++;
    } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={k} className="my-6 border-line" />);
      i++;
    } else if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={k} className="my-4 rounded-lg border border-line-strong bg-panel px-4 py-3 text-[14px] text-muted">
          {inline(quote.join(" "), k)}
        </blockquote>,
      );
    } else if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      const chunk: string[] = [];
      while (i < lines.length && lines[i].trim() && (/^\s*([-*+]|\d+\.)\s/.test(lines[i]) || /^\s+/.test(lines[i]))) chunk.push(lines[i++]);
      const { items, ordered } = parseList(chunk);
      blocks.push(<List key={k} items={items} ordered={ordered} k={k} />);
    } else if (line.trim().startsWith("|") && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k} className="my-4 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[480px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-line bg-panel">
                {head.map((c, j) => (
                  <th key={j} className="px-3 py-2 font-medium text-ink">{inline(c, `${k}-h${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="border-b border-line last:border-0">
                  {row.map((c, j) => (
                    <td key={j} className="px-3 py-2 align-top text-muted">{inline(c, `${k}-${r}-${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|\s*([-*+]|\d+\.)\s|-{3,}\s*$)/.test(lines[i]) && !lines[i].trim().startsWith("|")) {
        para.push(lines[i++].trim());
      }
      if (!para.length) {
        para.push(lines[i++].trim());
      }
      blocks.push(<p key={k} className="my-3 leading-relaxed">{inline(para.join(" "), k)}</p>);
    }
  }
  return <div className={className}>{blocks.map((b, j) => <Fragment key={j}>{b}</Fragment>)}</div>;
}
