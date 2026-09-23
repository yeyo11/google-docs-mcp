import type { DocComment } from "./google.js";

export interface AuthorStats {
  name: string;
  email?: string;
  comments: number;
  replies: number;
  resolvedByThem: number;
}

export interface CommentsSummary {
  total: number;
  open: number;
  resolved: number;
  deleted: number;
  totalReplies: number;
  /** Open comments with no replies at all (need attention). */
  unanswered: DocComment[];
  /** Open comments whose last reply is not from the original author. */
  awaitingAuthor: DocComment[];
  byAuthor: AuthorStats[];
  oldestOpen?: DocComment;
  latestActivity?: { comment: DocComment; at: string };
}

function authorKey(p: { name: string; email?: string }): string {
  return p.email ?? p.name;
}

function lastActivityTime(c: DocComment): string {
  const times = [c.modifiedTime ?? c.createdTime, ...c.replies.map((r) => r.modifiedTime ?? r.createdTime)];
  return times.reduce((max, t) => (t > max ? t : max), "");
}

export function summarizeComments(comments: DocComment[]): CommentsSummary {
  const live = comments.filter((c) => !c.deleted);
  const open = live.filter((c) => c.status === "open");
  const byAuthor = new Map<string, AuthorStats>();

  const bump = (p: { name: string; email?: string }, field: keyof Omit<AuthorStats, "name" | "email">) => {
    const key = authorKey(p);
    const entry = byAuthor.get(key) ?? {
      name: p.name,
      ...(p.email ? { email: p.email } : {}),
      comments: 0,
      replies: 0,
      resolvedByThem: 0,
    };
    entry[field] += 1;
    byAuthor.set(key, entry);
  };

  let totalReplies = 0;
  for (const c of live) {
    bump(c.author, "comments");
    for (const r of c.replies) {
      if (r.deleted) continue;
      totalReplies += 1;
      bump(r.author, "replies");
      if (r.action === "resolve") bump(r.author, "resolvedByThem");
    }
  }

  const unanswered = open.filter((c) => c.replies.every((r) => r.deleted));
  const awaitingAuthor = open.filter((c) => {
    const visible = c.replies.filter((r) => !r.deleted);
    const last = visible.at(-1);
    return last !== undefined && authorKey(last.author) !== authorKey(c.author);
  });

  const oldestOpen = [...open].sort((a, b) => a.createdTime.localeCompare(b.createdTime))[0];
  const latest = live
    .map((comment) => ({ comment, at: lastActivityTime(comment) }))
    .sort((a, b) => b.at.localeCompare(a.at))[0];

  return {
    total: live.length,
    open: open.length,
    resolved: live.length - open.length,
    deleted: comments.length - live.length,
    totalReplies,
    unanswered,
    awaitingAuthor,
    byAuthor: [...byAuthor.values()].sort((a, b) => b.comments + b.replies - (a.comments + a.replies)),
    ...(oldestOpen ? { oldestOpen } : {}),
    ...(latest ? { latestActivity: latest } : {}),
  };
}
