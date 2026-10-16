"use client";

import { CopyButton } from "@/components/ui/CopyButton";
import { API } from "@/lib/api/client";
import { useEffect, useState } from "react";

/** What the server's /api/downloads/mac/latest returns (server/src/downloads/mac.ts). */
type MacRelease = { version: string; file: string; sha256: string; size: number; publishedAt: string; minMacos: string };

type State = { kind: "loading" } | { kind: "ready"; release: MacRelease } | { kind: "none" } | { kind: "error" };

const INSTALL = `curl -fsSL ${API}/api/downloads/mac/install.sh | bash`;

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

function Command({ text }: { text: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-xl border border-line-strong bg-panel p-2 pl-4">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-ink select-all">{text}</code>
      <CopyButton text={text} label="Copy the install command" />
    </div>
  );
}

/**
 * The Mac app is not notarized by Apple, so the install command leads: files curl fetches are not quarantined, so
 * macOS opens the app without the "unidentified developer" block, and the script checks the download's checksum.
 * The zip is offered too, with the steps macOS then asks for.
 */
export function MacDownload() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    fetch(`${API}/api/downloads/mac/latest`, { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) return setState({ kind: "none" });
        if (!res.ok) return setState({ kind: "error" });
        setState({ kind: "ready", release: (await res.json()) as MacRelease });
      })
      .catch(() => live && setState({ kind: "error" }));
    return () => {
      live = false;
    };
  }, []);

  const release = state.kind === "ready" ? state.release : null;

  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-ink">Constellation for Mac</h1>
      <p className="mt-3 leading-relaxed">
        Constellation reads the work on your screen from the apps you turn on, removes private details on your Mac, and sends only what you approve
        in its Outbox to your team&apos;s Orion.
      </p>
      <p className="mt-2 text-[13px] text-faint" role="status">
        {state.kind === "loading" && "Checking for the latest version…"}
        {release && `Version ${release.version} · ${mb(release.size)} · macOS ${release.minMacos} or later · Apple silicon and Intel`}
        {state.kind === "none" && "No version has been published on this server yet. Ask your Orion admin."}
        {state.kind === "error" && "Couldn't reach the Orion server to check the latest version. The steps below still work once it's back."}
      </p>

      <section className="mt-8">
        <h2 className="text-[17px] font-semibold text-ink">Install</h2>
        <p className="mt-2 leading-relaxed">
          Open Terminal (press ⌘ Space, type <span className="text-ink">Terminal</span>, press Return), paste this, and press Return:
        </p>
        <Command text={INSTALL} />
        <p className="mt-2 text-[13px] leading-relaxed text-faint">
          It downloads the app from this Orion server, checks it isn&apos;t damaged, puts it in Applications, and opens it. Run the same command
          again to update.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-[17px] font-semibold text-ink">Then</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-relaxed">
          <li>
            When Constellation asks, allow it in System Settings, Privacy &amp; Security, <span className="text-ink">Accessibility</span>. That is how
            it reads text on screen. It never takes screenshots.
          </li>
          <li>
            In Orion, open Settings, <span className="text-ink">Connect your Mac</span>, and make a code.
          </li>
          <li>In Constellation, open the Outbox, choose Connect, and enter the code.</li>
          <li>Choose which apps it may read. Every app starts off.</li>
        </ol>
      </section>

      <section className="mt-8">
        <h2 className="text-[17px] font-semibold text-ink">Prefer a download?</h2>
        {release ? (
          <a
            href={`${API}/api/downloads/mac/${release.file}`}
            className="mt-3 inline-flex h-10 items-center rounded-lg border border-line-strong px-4 text-[14px] font-medium text-ink transition-colors hover:bg-raised"
          >
            Download {release.file}
          </a>
        ) : (
          <p className="mt-2">The download link appears here once a version is published.</p>
        )}
        <p className="mt-3 leading-relaxed">
          Unzip it and move Constellation to Applications. The app isn&apos;t notarized by Apple, so the first time you open it macOS blocks it. Open
          System Settings, Privacy &amp; Security, scroll down, choose <span className="text-ink">Open Anyway</span> next to Constellation, and
          confirm.
        </p>
        {release && (
          <p className="mt-3 text-[12px] break-all text-faint">
            SHA-256: <span className="font-mono">{release.sha256}</span>
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[17px] font-semibold text-ink">Claude Code and GitHub</h2>
        <p className="mt-2 leading-relaxed">
          Nothing to download. Sign in to Orion and open Settings: <span className="text-ink">Connect Claude Code</span> gives you one command
          that hands your coding agent the team&apos;s context, and <span className="text-ink">Connect GitHub</span> (admins) gives you a workflow
          file that tells Orion what each push to main changed.
        </p>
        <a href="/settings#claude-code" className="mt-3 inline-block text-[14px] text-ink underline underline-offset-4">
          Open Settings
        </a>
      </section>
    </>
  );
}
