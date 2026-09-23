import type { CommentReply, DocComment, DocumentInfo, DocumentText, Person } from "./google.js";
import type { CommentsSummary } from "./summary.js";

export function fmtDate(iso?: string): string {
  if (!iso) return "unknown date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function fmtPerson(p: Person): string {
  const email = p.email ? ` <${p.email}>` : "";
  return `${p.name}${email}${p.isMe ? " (you)" : ""}`;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function statusLabel(c: DocComment): string {
  if (c.deleted) return "🗑️ DELETED";
  return c.status === "open" ? "🟢 OPEN" : "✅ RESOLVED";
}

function formatReply(r: CommentReply): string {
  const actionTag =
    r.action === "resolve" ? " — marked as RESOLVED" : r.action === "reopen" ? " — REOPENED the thread" : "";
  const deleted = r.deleted ? " (deleted)" : "";
  const body = r.content.trim() ? `: ${r.content.trim()}` : "";
  return `  - ${fmtPerson(r.author)} · ${fmtDate(r.createdTime)}${actionTag}${deleted}${body}`;
}

export function formatComment(c: DocComment, index?: number): string {
  const lines: string[] = [];
  const prefix = index !== undefined ? `[${index}] ` : "";
  lines.push(`### ${prefix}${statusLabel(c)} — ${fmtPerson(c.author)} · ${fmtDate(c.createdTime)}`);
  if (c.modifiedTime && c.modifiedTime !== c.createdTime) {
    lines.push(`Edited: ${fmtDate(c.modifiedTime)}`);
  }
  if (c.quotedText) {
    lines.push("", "**Quoted text (what the comment refers to):**", quote(c.quotedText));
  }
  if (c.context) {
    lines.push("", `**Surrounding paragraph (#${c.context.paragraphIndex + 1}):**`, quote(c.context.paragraph));
  }
  lines.push("", "**Comment:**", c.content.trim() || "(empty)");

  const replies = c.replies;
  if (replies.length > 0) {
    lines.push("", `**Thread (${replies.length} ${replies.length === 1 ? "reply" : "replies"}):**`);
    lines.push(...replies.map(formatReply));
  } else if (c.status === "open" && !c.deleted) {
    lines.push("", "_No replies yet._");
  }

  if (c.resolution) {
    lines.push("", `Resolved by ${fmtPerson(c.resolution.by)} on ${fmtDate(c.resolution.at)}.`);
  }
  lines.push("", `Comment ID: \`${c.id}\``);
  return lines.join("\n");
}

export function formatDocumentHeader(info: DocumentInfo): string {
  const lines = [`# ${info.name}`, `- Document ID: \`${info.id}\``];
  if (info.webViewLink) lines.push(`- Link: ${info.webViewLink}`);
  if (info.owners.length) lines.push(`- Owner: ${info.owners.map(fmtPerson).join(", ")}`);
  if (info.modifiedTime) {
    const by = info.lastModifiedBy ? ` by ${fmtPerson(info.lastModifiedBy)}` : "";
    lines.push(`- Last modified: ${fmtDate(info.modifiedTime)}${by}`);
  }
  if (info.createdTime) lines.push(`- Created: ${fmtDate(info.createdTime)}`);
  return lines.join("\n");
}

export function formatCommentList(
  info: DocumentInfo,
  comments: DocComment[],
  opts: { filterLabel: string; nextPageToken?: string },
): string {
  const parts = [formatDocumentHeader(info), "", `## Comments (${opts.filterLabel}): ${comments.length}`];
  if (comments.length === 0) {
    parts.push("", "_No comments match the requested filter._");
  } else {
    comments.forEach((c, i) => parts.push("", formatComment(c, i + 1)));
  }
  if (opts.nextPageToken) {
    parts.push("", `_More comments available. Call again with page_token: \`${opts.nextPageToken}\`_`);
  }
  return parts.join("\n");
}

export function formatDocumentList(
  documents: DocumentInfo[],
  opts: { query?: string; nextPageToken?: string },
): string {
  const title = opts.query ? `Google Docs matching "${opts.query}"` : "Recent Google Docs";
  const parts = [`# ${title}: ${documents.length}`];
  if (documents.length === 0) parts.push("", "_No documents found._");
  documents.forEach((d, i) => {
    const owner = d.owners[0] ? ` · owner ${fmtPerson(d.owners[0])}` : "";
    parts.push(`${i + 1}. **${d.name}** — id \`${d.id}\` · modified ${fmtDate(d.modifiedTime)}${owner}`);
  });
  if (opts.nextPageToken) {
    parts.push("", `_More results available. Call again with page_token: \`${opts.nextPageToken}\`_`);
  }
  return parts.join("\n");
}

export function formatDocument(
  info: DocumentInfo,
  text: DocumentText | undefined,
  maxChars: number,
): string {
  const parts = [formatDocumentHeader(info)];
  if (text) {
    const truncated = text.text.length > maxChars;
    const body = truncated ? text.text.slice(0, maxChars) : text.text;
    parts.push(
      "",
      `## Content (${text.paragraphs.length} paragraphs, ${text.text.length} chars${truncated ? `, showing first ${maxChars}` : ""})`,
      "",
      body || "_(empty document)_",
    );
    if (truncated) parts.push("", `_…truncated. Increase max_chars to read more._`);
  }
  return parts.join("\n");
}

function shortComment(c: DocComment): string {
  const snippet = c.content.trim().replace(/\s+/g, " ").slice(0, 120);
  const quoted = c.quotedText ? ` (on: "${c.quotedText.replace(/\s+/g, " ").slice(0, 60)}")` : "";
  return `- ${fmtPerson(c.author)} · ${fmtDate(c.createdTime)}${quoted}: ${snippet} — id \`${c.id}\``;
}

export function formatSummary(info: DocumentInfo, s: CommentsSummary): string {
  const parts = [
    formatDocumentHeader(info),
    "",
    "## Comment summary",
    `- Total comments: ${s.total} (${s.open} open, ${s.resolved} resolved${s.deleted ? `, ${s.deleted} deleted` : ""})`,
    `- Total replies: ${s.totalReplies}`,
  ];
  if (s.oldestOpen) {
    parts.push(`- Oldest open comment: ${fmtDate(s.oldestOpen.createdTime)} by ${fmtPerson(s.oldestOpen.author)}`);
  }
  if (s.latestActivity) {
    parts.push(
      `- Latest activity: ${fmtDate(s.latestActivity.at)} on comment \`${s.latestActivity.comment.id}\``,
    );
  }

  parts.push("", "## Participants");
  if (s.byAuthor.length === 0) parts.push("_None_");
  for (const a of s.byAuthor) {
    const resolved = a.resolvedByThem ? `, resolved ${a.resolvedByThem}` : "";
    parts.push(`- ${fmtPerson({ ...a, isMe: false })}: ${a.comments} comments, ${a.replies} replies${resolved}`);
  }

  parts.push("", `## Open comments with no replies (${s.unanswered.length})`);
  parts.push(...(s.unanswered.length ? s.unanswered.map(shortComment) : ["_None_"]));

  parts.push("", `## Open comments awaiting the original author (${s.awaitingAuthor.length})`);
  parts.push(...(s.awaitingAuthor.length ? s.awaitingAuthor.map(shortComment) : ["_None_"]));

  parts.push("", "_Use `list_comments` for the full detail of every thread._");
  return parts.join("\n");
}
