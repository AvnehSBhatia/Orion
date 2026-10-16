// The Mac app download: `mac/Constellation/scripts/package.sh` builds Constellation.app, zips it, and writes
// latest.json beside it; the operator copies both into `${downloadsDir}/mac` on the box. Nothing is in git or the
// image. The app is not notarized, so the page leads with install.sh: files curl fetches carry no quarantine flag,
// so Gatekeeper does not stop the app, and the script checks the zip's SHA-256 before installing it.
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { config } from "@/config";
import { HttpError } from "@/http/error";

const release = z.object({
  version: z.string().regex(/^[\w.+-]{1,32}$/),
  file: z.string().regex(/^Constellation-[\w.+-]{1,64}\.zip$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive(),
  publishedAt: z.string(),
  minMacos: z.string().max(16),
});
export type MacRelease = z.infer<typeof release>;

const dir = () => path.join(config.downloadsDir, "mac");

/** The newest release, or null when none has been published (or latest.json is unreadable). */
export async function latestMac(): Promise<MacRelease | null> {
  try {
    const parsed = release.safeParse(JSON.parse(await fs.readFile(path.join(dir(), "latest.json"), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A release zip as a download. Only names latest.json could point at are served, so nothing else in the folder is. */
export async function macZip(name: string): Promise<Response> {
  if (!release.shape.file.safeParse(name).success) throw new HttpError(404, "no such download");
  const file = path.join(dir(), name);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new HttpError(404, "no such download");
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

/** The API's own origin as the Mac sees it, for the install script. Behind the proxy the request says http. */
export function publicOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = (config.trustProxy && req.headers.get("x-forwarded-host")) || req.headers.get("host") || url.host;
  const proto = config.cookieSecure ? "https" : (config.trustProxy && req.headers.get("x-forwarded-proto")) || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/**
 * `curl -fsSL <api>/api/downloads/mac/install.sh | bash`: downloads the latest zip, checks its SHA-256, quits a
 * running copy, and puts Constellation.app in /Applications (~/Applications when that is not writable). Running it
 * again is how a Mac updates.
 */
export function installScript(origin: string): string {
  return `#!/bin/bash
# Installs or updates Constellation, the Orion Mac app, from ${origin}.
set -euo pipefail
API="${origin}"
[ "$(uname -s)" = Darwin ] || { echo "Constellation runs on macOS only." >&2; exit 1; }
meta=$(curl -fsSL "$API/api/downloads/mac/latest")
field() { /usr/bin/plutil -extract "$1" raw -o - - <<<"$meta"; }
version=$(field version); file=$(field file); sum=$(field sha256)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
echo "Downloading Constellation $version..."
curl -fL --progress-bar -o "$tmp/$file" "$API/api/downloads/mac/$file"
[ "$(shasum -a 256 "$tmp/$file" | cut -d' ' -f1)" = "$sum" ] || { echo "The download is damaged (checksum mismatch). Nothing was installed." >&2; exit 1; }
/usr/bin/ditto -x -k "$tmp/$file" "$tmp/app"
dest="\${CONSTELLATION_DEST:-/Applications}"
[ -w "$dest" ] || { dest="$HOME/Applications"; mkdir -p "$dest"; }
/usr/bin/osascript -e 'tell application id "ai.orion.constellation" to quit' >/dev/null 2>&1 || true
pkill -x Constellation >/dev/null 2>&1 || true
rm -rf "$dest/Constellation.app"
/usr/bin/ditto "$tmp/app/Constellation.app" "$dest/Constellation.app"
/usr/bin/xattr -dr com.apple.quarantine "$dest/Constellation.app" 2>/dev/null || true
echo "Installed Constellation $version in $dest."
[ -n "\${CONSTELLATION_NO_OPEN:-}" ] || open "$dest/Constellation.app"
`;
}
