/**
 * HTML for candidate emails, matching the product prototype's "branded card"
 * (invite email A, code email). Email clients ignore stylesheets and flexbox,
 * so everything is tables and inline styles, with web-safe font fallbacks.
 * Every email also has a plain-text version, built by the caller.
 */

const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY = "'Space Grotesk', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const C = {
  page: "#E7EAEE",
  card: "#FFFFFF",
  subtle: "#F0F2F4",
  line: "#E1E4E8",
  ink: "#15181C",
  ink2: "#434B55",
  ink3: "#5E6772",
  brand: "#1F2A37",
  accent: "#1B45CA",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Up to two initials for the company tile ("Calder & Finch" → "CF"). */
export function companyInitials(name: string): string {
  const words = name.split(/[\s&._-]+/).filter((w) => /^[a-z0-9]/i.test(w));
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked.map((w) => w[0]!.toUpperCase()).join("") || "?";
}

/** The card: company header, body rows, "Sent by Mantle" footer. `body` is trusted HTML. */
function card(orgName: string, body: string): string {
  const org = escapeHtml(orgName);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;background:${C.card};border-radius:12px;border-collapse:separate;overflow:hidden">
<tr><td style="padding:28px 40px;border-bottom:1px solid ${C.line}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="44" height="44" align="center" valign="middle" style="width:44px;height:44px;border-radius:8px;background:${C.brand};color:#FFFFFF;font:600 15px ${DISPLAY};letter-spacing:.02em">${escapeHtml(companyInitials(orgName))}</td>
<td style="padding-left:12px;font:600 18px ${DISPLAY};color:${C.ink}">${org}</td>
</tr></table>
</td></tr>
<tr><td style="padding:36px 40px 32px;font-family:${FONT};color:${C.ink}">${body}</td></tr>
<tr><td style="padding:16px 40px;background:${C.subtle};font:400 12px ${FONT};color:${C.ink3}">Sent by Mantle on behalf of ${org}</td></tr>
</table>`;
}

function page(preheader: string, inner: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}">
<tr><td align="center" style="padding:40px 16px">${inner}</td></tr>
</table>
</body></html>`;
}

const eyebrow = (text: string) =>
  `<p style="margin:0 0 18px;font:600 12px ${FONT};letter-spacing:.04em;text-transform:uppercase;color:${C.ink3}">${escapeHtml(text)}</p>`;
const heading = (text: string, size: number) =>
  `<h1 style="margin:0 0 18px;font:600 ${size}px/1.2 ${DISPLAY};letter-spacing:-.015em;color:${C.ink}">${escapeHtml(text)}</h1>`;
const lead = (html: string) => `<p style="margin:0 0 18px;font:400 15px/1.6 ${FONT};color:${C.ink2}">${html}</p>`;
const small = (html: string, color = C.ink2, margin = "0 0 18px") => `<p style="margin:${margin};font:400 13px/1.5 ${FONT};color:${color}">${html}</p>`;
const divider = `<div style="height:1px;background:${C.line};margin:0 0 18px;line-height:1px;font-size:1px">&nbsp;</div>`;

/** Invite email (prototype "A · Branded card email"). */
export function inviteEmailHtml(args: {
  orgName: string;
  jobTitle: string;
  link: string;
  /** Already formatted, e.g. "Nov 21, 2026". */
  completeBy: string;
  minutes?: number;
  firstName?: string | null;
  needsWebcam?: boolean;
}): string {
  const facts: [string, string][] = [];
  if (args.minutes) facts.push(["Time needed", `${args.minutes} min, timed`]);
  facts.push(["Complete by", args.completeBy]);
  facts.push(["You'll need", args.needsWebcam ? "Laptop + webcam" : "Laptop or desktop"]);
  const factCells = facts
    .map(
      ([k, v], i) =>
        `<td valign="top" style="padding:14px 16px;${i < facts.length - 1 ? `border-right:1px solid ${C.line};` : ""}width:${Math.floor(100 / facts.length)}%">
<div style="font:400 12px ${FONT};color:${C.ink3}">${escapeHtml(k)}</div>
<div style="margin-top:4px;font:600 14px ${FONT};color:${C.ink}">${escapeHtml(v)}</div></td>`,
    )
    .join("");
  const hi = args.firstName ? `Hi ${escapeHtml(args.firstName)}` : "Hi";
  const time = args.minutes ? `${args.minutes} minutes` : "a short, timed session";
  const body = [
    eyebrow(`${args.jobTitle} · Next step`),
    heading("Show us how you'd handle a real day on the job", 28),
    lead(`${hi} — thanks for applying. Instead of a quiz, you'll spend ${time} working through a realistic task from the ${escapeHtml(args.jobTitle)} role.`),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:10px;border-collapse:separate;margin:0 0 18px"><tr>${factCells}</tr></table>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr><td style="border-radius:7px;background:${C.brand}">
<a href="${escapeHtml(args.link)}" style="display:inline-block;padding:13px 28px;font:500 15px ${FONT};color:#FFFFFF;text-decoration:none;border-radius:7px">Start the simulation &rarr;</a>
</td></tr></table>`,
    small("No account or download needed. You can open the link now to check your setup and start later.", C.ink3),
    divider,
    small(`This link is personal to you. If you weren't expecting this email, you can ignore it.`, C.ink2, "0"),
  ].join("\n");
  return page(`${args.orgName} invited you to a work simulation for ${args.jobTitle}.`, card(args.orgName, body));
}

/** Sign-in code email (prototype "Code email · Invite A style"). */
export function codeEmailHtml(args: { orgName: string; code: string; ttlMinutes: number }): string {
  const spaced = `${args.code.slice(0, 3)} ${args.code.slice(3)}`;
  const body = [
    eyebrow("Your sign-in code"),
    heading("Enter this code on the page you just opened", 26),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr>
<td align="center" style="padding:22px;border-radius:10px;background:${C.subtle};border:1px solid ${C.line};font:700 40px ${FONT};letter-spacing:.18em;color:${C.ink}">${escapeHtml(spaced)}</td>
</tr></table>`,
    lead(`It expires in ${args.ttlMinutes} minutes and works once. If it runs out, ask for a new one on the same page.`),
    divider,
    small("Didn't ask for a code? Someone may have opened your invitation link. You can ignore this email — nothing starts without the code.", C.ink2, "0"),
  ].join("\n");
  return page(`${args.code} is your code. It expires in ${args.ttlMinutes} minutes.`, card(args.orgName, body));
}
