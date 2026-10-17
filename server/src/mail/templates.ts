import type { Mail } from "./mail";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A short plain email: a few lines, one button, the link spelled out under it for clients that strip buttons. */
function layout(to: string, subject: string, lines: string[], action: { label: string; url: string }, footer: string): Mail {
  const text = [...lines, "", `${action.label}: ${action.url}`, "", footer].join("\n");
  const p = (s: string) => `<p style="margin:0 0 16px">${escapeHtml(s)}</p>`;
  const url = escapeHtml(action.url);
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;color:#111111;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:480px">
${lines.map(p).join("\n")}
<p style="margin:24px 0"><a href="${url}" style="display:inline-block;padding:10px 18px;background:#111111;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 16px;color:#666666;font-size:13px">Or paste this link into your browser:<br><a href="${url}" style="color:#666666;word-break:break-all">${url}</a></p>
<p style="margin:0;color:#666666;font-size:13px">${escapeHtml(footer)}</p>
</div></body></html>`;
  return { to, subject, text, html };
}

export function inviteMail(i: { to: string; name?: string | null; orgName: string; invitedBy: string; url: string; days: number }): Mail {
  return layout(
    i.to,
    `Join ${i.orgName} on Orion`,
    [i.name ? `Hi ${i.name},` : "Hi,", `${i.invitedBy} invited you to join ${i.orgName} on Orion. Pick a username and password to get started.`],
    { label: "Accept the invite", url: i.url },
    `This link works once and expires in ${i.days} days. If you weren't expecting it, you can ignore this email.`,
  );
}

export function resetMail(r: { to: string; url: string; hours: number; byAdmin: boolean }): Mail {
  return layout(
    r.to,
    "Reset your Orion password",
    [r.byAdmin ? "An admin of your org made a password reset link for your Orion account." : "Someone asked to reset the password of your Orion account."],
    { label: "Choose a new password", url: r.url },
    `This link works once and expires in ${r.hours} hours. If you didn't ask for it, ignore this email; your password stays the same.`,
  );
}
