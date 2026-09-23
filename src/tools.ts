import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readStoredTokens } from "./auth.js";
import { SCOPES, TOKEN_PATH } from "./config.js";
import {
  formatComment,
  formatCommentList,
  formatDocument,
  formatDocumentList,
  formatSummary,
} from "./format.js";
import {
  attachContext,
  describeError,
  getClients,
  getComment,
  getDocumentInfo,
  getDocumentText,
  listAllComments,
  listCommentsPage,
  listDocuments,
  parseDocumentId,
  type DocComment,
} from "./google.js";
import { summarizeComments } from "./summary.js";

/** Every tool is read-only; these annotations advertise that to the MCP client. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const documentParam = z
  .string()
  .min(1)
  .describe("Google Docs document ID or full URL (https://docs.google.com/document/d/<id>/edit).");

function text(body: string): CallToolResult {
  return { content: [{ type: "text", text: body }] };
}

function jsonOrMarkdown(format: "markdown" | "json", markdown: () => string, data: unknown): CallToolResult {
  return format === "json" ? text(JSON.stringify(data, null, 2)) : text(markdown());
}

/** Wraps a handler so failures come back as isError results instead of breaking the session. */
function safe<A>(fn: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: describeError(err) }] };
    }
  };
}

function filterByStatus(comments: DocComment[], status: "all" | "open" | "resolved"): DocComment[] {
  return status === "all" ? comments : comments.filter((c) => c.status === status);
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "get_auth_status",
    {
      title: "Get authentication status",
      description:
        "Check whether the server is signed in to Google and which account is being used. " +
        "Call this first if other tools fail with authentication errors.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => {
      const stored = await readStoredTokens();
      if (!stored?.refresh_token) {
        return text(
          `Not signed in. No credentials at ${TOKEN_PATH}.\n` +
            "Ask the user to run `npm run auth` in the google-docs-mcp directory to sign in with Google (read-only access).",
        );
      }
      const { drive } = await getClients();
      const about = await drive.about.get({ fields: "user(displayName,emailAddress)" });
      const user = about.data.user;
      return text(
        [
          `Signed in as ${user?.displayName ?? "?"} <${user?.emailAddress ?? "?"}>`,
          `Access mode: READ-ONLY`,
          `Granted scopes: ${(stored.scope ?? SCOPES.join(" ")).split(/\s+/).join(", ")}`,
          `Token file: ${TOKEN_PATH}`,
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List Google Docs",
      description:
        "Search the user's Google Drive for Google Docs documents (including shared drives). " +
        "Returns name, ID, owner and last-modified date, newest first. Use the returned ID with the other tools.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Optional free-text search matched against the document title and full text."),
        max_results: z.number().int().min(1).max(100).default(20),
        page_token: z.string().optional().describe("Token from a previous call to fetch the next page."),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ query, max_results, page_token }) => {
      const { drive } = await getClients();
      const result = await listDocuments(drive, {
        ...(query ? { query } : {}),
        pageSize: max_results,
        ...(page_token ? { pageToken: page_token } : {}),
      });
      return text(
        formatDocumentList(result.documents, {
          ...(query ? { query } : {}),
          ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
        }),
      );
    }),
  );

  server.registerTool(
    "get_document",
    {
      title: "Get document",
      description:
        "Read a Google Doc: metadata (title, owner, last modified) and its plain-text content across all tabs. " +
        "Useful to understand what the comments refer to.",
      inputSchema: {
        document: documentParam,
        include_content: z.boolean().default(true).describe("Include the document text. Set false for metadata only."),
        max_chars: z
          .number()
          .int()
          .min(100)
          .max(500_000)
          .default(20_000)
          .describe("Maximum number of characters of content to return."),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ document, include_content, max_chars }) => {
      const id = parseDocumentId(document);
      const { drive, docs } = await getClients();
      const [info, content] = await Promise.all([
        getDocumentInfo(drive, id),
        include_content ? getDocumentText(docs, id) : Promise.resolve(undefined),
      ]);
      return text(formatDocument(info, content, max_chars));
    }),
  );

  server.registerTool(
    "list_comments",
    {
      title: "List comments",
      description:
        "List the comments of a Google Doc in full detail: author, dates, open/resolved status, the quoted text " +
        "each comment refers to, every reply in the thread (with who resolved or reopened it) and, optionally, " +
        "the surrounding paragraph of the document. This is the main tool of this server.",
      inputSchema: {
        document: documentParam,
        status: z
          .enum(["all", "open", "resolved"])
          .default("all")
          .describe("Filter by resolution status."),
        include_deleted: z.boolean().default(false).describe("Also return deleted comments and replies."),
        include_context: z
          .boolean()
          .default(false)
          .describe("Fetch the document text and attach the paragraph where each quoted text appears."),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(100)
          .describe("Page size. Comments are returned newest first."),
        page_token: z.string().optional().describe("Token from a previous call to fetch the next page."),
        format: z
          .enum(["markdown", "json"])
          .default("markdown")
          .describe("markdown is easier to read; json returns the structured objects."),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ document, status, include_deleted, include_context, max_results, page_token, format }) => {
      const id = parseDocumentId(document);
      const { drive, docs } = await getClients();
      const [info, page] = await Promise.all([
        getDocumentInfo(drive, id),
        listCommentsPage(drive, id, {
          includeDeleted: include_deleted,
          pageSize: max_results,
          ...(page_token ? { pageToken: page_token } : {}),
        }),
      ]);

      const comments = filterByStatus(page.comments, status);
      if (include_context && comments.some((c) => c.quotedText)) {
        attachContext(comments, await getDocumentText(docs, id));
      }

      const filterLabel = [status, include_deleted ? "including deleted" : null].filter(Boolean).join(", ");
      return jsonOrMarkdown(
        format,
        () =>
          formatCommentList(info, comments, {
            filterLabel,
            ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
          }),
        { document: info, comments, nextPageToken: page.nextPageToken ?? null },
      );
    }),
  );

  server.registerTool(
    "get_comment",
    {
      title: "Get a single comment thread",
      description:
        "Fetch one comment of a Google Doc by ID with its full reply thread, quoted text and surrounding paragraph.",
      inputSchema: {
        document: documentParam,
        comment_id: z.string().min(1).describe("Comment ID as returned by list_comments."),
        include_context: z.boolean().default(true).describe("Attach the paragraph where the quoted text appears."),
        format: z.enum(["markdown", "json"]).default("markdown"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ document, comment_id, include_context, format }) => {
      const id = parseDocumentId(document);
      const { drive, docs } = await getClients();
      const [info, comment] = await Promise.all([getDocumentInfo(drive, id), getComment(drive, id, comment_id)]);
      if (include_context && comment.quotedText) {
        attachContext([comment], await getDocumentText(docs, id));
      }
      return jsonOrMarkdown(
        format,
        () => `${formatComment(comment)}\n\nDocument: **${info.name}** (\`${info.id}\`)`,
        { document: info, comment },
      );
    }),
  );

  server.registerTool(
    "get_comments_summary",
    {
      title: "Summarize comments",
      description:
        "Aggregate view of all comments in a Google Doc: counts by status, participants and their activity, " +
        "open comments with no replies, open comments waiting for the original author, oldest open comment and " +
        "latest activity. Reads every page of comments.",
      inputSchema: {
        document: documentParam,
        format: z.enum(["markdown", "json"]).default("markdown"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ document, format }) => {
      const id = parseDocumentId(document);
      const { drive } = await getClients();
      const [info, comments] = await Promise.all([getDocumentInfo(drive, id), listAllComments(drive, id, true)]);
      const summary = summarizeComments(comments);
      return jsonOrMarkdown(format, () => formatSummary(info, summary), { document: info, summary });
    }),
  );
}
