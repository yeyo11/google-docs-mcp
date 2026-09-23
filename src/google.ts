import { google, type docs_v1, type drive_v3 } from "googleapis";
import { AuthError, getAuthorizedClient } from "./auth.js";

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export interface Clients {
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
}

let clientsPromise: Promise<Clients> | undefined;

export function getClients(): Promise<Clients> {
  clientsPromise ??= getAuthorizedClient()
    .then((auth) => ({
      drive: google.drive({ version: "v3", auth }),
      docs: google.docs({ version: "v1", auth }),
    }))
    .catch((err) => {
      clientsPromise = undefined;
      throw err;
    });
  return clientsPromise;
}

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

/** Accepts a document ID or a Google Docs URL and returns the ID. */
export function parseDocumentId(input: string): string {
  const fromUrl = /\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/.exec(input);
  if (fromUrl?.[1]) return fromUrl[1];
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  throw new Error(`"${input}" is not a Google Docs URL or document ID.`);
}

// ---------------------------------------------------------------------------
// Normalized model
// ---------------------------------------------------------------------------

export interface Person {
  name: string;
  email?: string;
  /** true when this is the signed-in account */
  isMe: boolean;
}

export interface CommentReply {
  id: string;
  author: Person;
  createdTime: string;
  modifiedTime?: string;
  content: string;
  /** Present when the reply resolves or reopens the thread. */
  action?: "resolve" | "reopen";
  deleted: boolean;
}

export interface CommentContext {
  paragraphIndex: number;
  paragraph: string;
}

export interface DocComment {
  id: string;
  author: Person;
  createdTime: string;
  modifiedTime?: string;
  content: string;
  /** Fragment of the document the comment was made on. */
  quotedText?: string;
  status: "open" | "resolved";
  deleted: boolean;
  replies: CommentReply[];
  resolution?: { by: Person; at: string };
  /** Document paragraph where the quoted text appears (optional). */
  context?: CommentContext;
}

export interface DocumentInfo {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  owners: Person[];
  lastModifiedBy?: Person;
  webViewLink?: string;
}

export interface DocumentText {
  title: string;
  paragraphs: string[];
  text: string;
}

function toPerson(u?: drive_v3.Schema$User | null): Person {
  return {
    name: u?.displayName ?? "Unknown",
    ...(u?.emailAddress ? { email: u.emailAddress } : {}),
    isMe: u?.me ?? false,
  };
}

function toReply(r: drive_v3.Schema$Reply): CommentReply {
  const action = r.action === "resolve" || r.action === "reopen" ? r.action : undefined;
  return {
    id: r.id ?? "",
    author: toPerson(r.author),
    createdTime: r.createdTime ?? "",
    ...(r.modifiedTime ? { modifiedTime: r.modifiedTime } : {}),
    content: r.content ?? "",
    ...(action ? { action } : {}),
    deleted: r.deleted ?? false,
  };
}

export function normalizeComment(c: drive_v3.Schema$Comment): DocComment {
  const replies = (c.replies ?? []).map(toReply);
  const resolveReply = [...replies].reverse().find((r) => r.action === "resolve");
  const quoted = c.quotedFileContent?.value?.trim();
  return {
    id: c.id ?? "",
    author: toPerson(c.author),
    createdTime: c.createdTime ?? "",
    ...(c.modifiedTime ? { modifiedTime: c.modifiedTime } : {}),
    content: c.content ?? "",
    ...(quoted ? { quotedText: quoted } : {}),
    status: c.resolved ? "resolved" : "open",
    deleted: c.deleted ?? false,
    replies,
    ...(c.resolved && resolveReply
      ? { resolution: { by: resolveReply.author, at: resolveReply.createdTime } }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Drive: documents and comments
// ---------------------------------------------------------------------------

const FILE_FIELDS =
  "id,name,createdTime,modifiedTime,webViewLink,owners(displayName,emailAddress,me),lastModifyingUser(displayName,emailAddress,me)";

const COMMENT_FIELDS =
  "id,createdTime,modifiedTime,resolved,deleted,content,quotedFileContent(value),author(displayName,emailAddress,me)," +
  "replies(id,createdTime,modifiedTime,deleted,content,action,author(displayName,emailAddress,me))";

function toDocumentInfo(f: drive_v3.Schema$File): DocumentInfo {
  return {
    id: f.id ?? "",
    name: f.name ?? "(untitled)",
    ...(f.createdTime ? { createdTime: f.createdTime } : {}),
    ...(f.modifiedTime ? { modifiedTime: f.modifiedTime } : {}),
    owners: (f.owners ?? []).map(toPerson),
    ...(f.lastModifyingUser ? { lastModifiedBy: toPerson(f.lastModifyingUser) } : {}),
    ...(f.webViewLink ? { webViewLink: f.webViewLink } : {}),
  };
}

export async function getDocumentInfo(drive: drive_v3.Drive, fileId: string): Promise<DocumentInfo> {
  const res = await drive.files.get({ fileId, fields: FILE_FIELDS, supportsAllDrives: true });
  if (res.data.mimeType && res.data.mimeType !== GOOGLE_DOC_MIME) {
    throw new Error(`File ${fileId} is not a Google Doc (mimeType ${res.data.mimeType}).`);
  }
  return toDocumentInfo(res.data);
}

export interface ListDocumentsOptions {
  query?: string;
  pageSize: number;
  pageToken?: string;
}

export async function listDocuments(
  drive: drive_v3.Drive,
  opts: ListDocumentsOptions,
): Promise<{ documents: DocumentInfo[]; nextPageToken?: string }> {
  const clauses = [`mimeType = '${GOOGLE_DOC_MIME}'`, "trashed = false"];
  if (opts.query?.trim()) {
    const q = opts.query.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    clauses.push(`(name contains '${q}' or fullText contains '${q}')`);
  }
  const res = await drive.files.list({
    q: clauses.join(" and "),
    pageSize: opts.pageSize,
    ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
    orderBy: "modifiedTime desc",
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return {
    documents: (res.data.files ?? []).map(toDocumentInfo),
    ...(res.data.nextPageToken ? { nextPageToken: res.data.nextPageToken } : {}),
  };
}

export interface ListCommentsOptions {
  includeDeleted: boolean;
  pageSize: number;
  pageToken?: string;
}

export async function listCommentsPage(
  drive: drive_v3.Drive,
  fileId: string,
  opts: ListCommentsOptions,
): Promise<{ comments: DocComment[]; nextPageToken?: string }> {
  const res = await drive.comments.list({
    fileId,
    includeDeleted: opts.includeDeleted,
    pageSize: opts.pageSize,
    ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
    fields: `nextPageToken,comments(${COMMENT_FIELDS})`,
  });
  return {
    comments: (res.data.comments ?? []).map(normalizeComment),
    ...(res.data.nextPageToken ? { nextPageToken: res.data.nextPageToken } : {}),
  };
}

export async function listAllComments(
  drive: drive_v3.Drive,
  fileId: string,
  includeDeleted = false,
): Promise<DocComment[]> {
  const all: DocComment[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listCommentsPage(drive, fileId, {
      includeDeleted,
      pageSize: 100,
      ...(pageToken ? { pageToken } : {}),
    });
    all.push(...page.comments);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all;
}

export async function getComment(
  drive: drive_v3.Drive,
  fileId: string,
  commentId: string,
): Promise<DocComment> {
  const res = await drive.comments.get({
    fileId,
    commentId,
    includeDeleted: true,
    fields: COMMENT_FIELDS,
  });
  return normalizeComment(res.data);
}

// ---------------------------------------------------------------------------
// Docs: document text and comment context
// ---------------------------------------------------------------------------

function collectParagraphs(
  elements: docs_v1.Schema$StructuralElement[] | undefined,
  out: string[],
): void {
  for (const el of elements ?? []) {
    if (el.paragraph) {
      const text = (el.paragraph.elements ?? [])
        .map((e) => e.textRun?.content ?? "")
        .join("")
        .replace(/\n$/, "");
      out.push(text);
    } else if (el.table) {
      for (const row of el.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          collectParagraphs(cell.content, out);
        }
      }
    } else if (el.tableOfContents) {
      collectParagraphs(el.tableOfContents.content, out);
    }
  }
}

function collectTabs(tabs: docs_v1.Schema$Tab[] | undefined, out: string[]): void {
  for (const tab of tabs ?? []) {
    collectParagraphs(tab.documentTab?.body?.content, out);
    collectTabs(tab.childTabs, out);
  }
}

export async function getDocumentText(docs: docs_v1.Docs, documentId: string): Promise<DocumentText> {
  const res = await docs.documents.get({ documentId, includeTabsContent: true });
  const doc = res.data;
  const paragraphs: string[] = [];
  if (doc.tabs?.length) {
    collectTabs(doc.tabs, paragraphs);
  } else {
    collectParagraphs(doc.body?.content, paragraphs);
  }
  return {
    title: doc.title ?? "(untitled)",
    paragraphs,
    text: paragraphs.join("\n"),
  };
}

const CONTEXT_MAX_CHARS = 600;

/** Finds the document paragraph that contains the text quoted by a comment. */
export function findContext(paragraphs: string[], quotedText: string): CommentContext | undefined {
  const needle = quotedText.replace(/\s+/g, " ").trim();
  if (!needle) return undefined;

  const normalized = paragraphs.map((p) => p.replace(/\s+/g, " "));
  // Quoted text may span several paragraphs; when there is no exact match, try its beginning.
  const probes = [needle, needle.slice(0, 60), needle.slice(0, 25)].filter((p) => p.length >= 8);
  for (const probe of probes) {
    const idx = normalized.findIndex((p) => p.includes(probe));
    if (idx === -1) continue;
    let paragraph = paragraphs[idx] ?? "";
    if (paragraph.length > CONTEXT_MAX_CHARS) {
      const at = Math.max(0, normalized[idx]!.indexOf(probe) - CONTEXT_MAX_CHARS / 3);
      paragraph = `${at > 0 ? "…" : ""}${paragraph.slice(at, at + CONTEXT_MAX_CHARS)}…`;
    }
    return { paragraphIndex: idx, paragraph };
  }
  return undefined;
}

export function attachContext(comments: DocComment[], docText: DocumentText): void {
  for (const c of comments) {
    if (!c.quotedText) continue;
    const ctx = findContext(docText.paragraphs, c.quotedText);
    if (ctx) c.context = ctx;
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

interface GaxiosLike {
  message?: string;
  code?: number | string;
  response?: { status?: number; data?: { error?: { message?: string } } };
}

/** Turns googleapis/auth errors into an actionable message for the MCP consumer. */
export function describeError(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  const e = (err ?? {}) as GaxiosLike;
  const status = e.response?.status ?? (typeof e.code === "number" ? e.code : Number(e.code));
  const apiMessage = e.response?.data?.error?.message ?? e.message ?? String(err);

  switch (status) {
    case 401:
      return `Google rejected the credentials (401). Re-run \`npm run auth\`. Details: ${apiMessage}`;
    case 403:
      return (
        `Access denied (403). Check that the signed-in account can view the document and that the ` +
        `Google Drive API and Google Docs API are enabled in the Cloud project. Details: ${apiMessage}`
      );
    case 404:
      return `Document not found (404) or not shared with the signed-in account. Details: ${apiMessage}`;
    case 429:
      return `Google API quota exceeded (429). Retry later. Details: ${apiMessage}`;
    default:
      return apiMessage;
  }
}
