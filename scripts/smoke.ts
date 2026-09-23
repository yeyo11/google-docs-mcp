/**
 * Smoke test that needs no Google credentials:
 *  1. Starts the server over stdio and lists its tools.
 *  2. Verifies that, without a token, tools return a readable isError result instead of crashing.
 *  3. Exercises comment normalization, summary and formatting with fixture data.
 */
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { normalizeComment, findContext, parseDocumentId } from "../src/google.js";
import { formatComment, formatSummary } from "../src/format.js";
import { summarizeComments } from "../src/summary.js";

const here = path.dirname(new URL(import.meta.url).pathname);

async function testServerWithoutCredentials(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--import", "tsx", path.join(here, "..", "src", "index.ts")],
    env: { ...process.env, GOOGLE_DOCS_MCP_CONFIG_DIR: path.join(os.tmpdir(), "gdocs-mcp-smoke-empty") },
    stderr: "pipe",
  });
  const client = new Client({ name: "smoke", version: "0.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "get_auth_status",
    "get_comment",
    "get_comments_summary",
    "get_document",
    "list_comments",
    "list_documents",
  ]);
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} must be read-only`);
    assert.equal(t.annotations?.destructiveHint, false, `${t.name} must not be destructive`);
  }

  const status = await client.callTool({ name: "get_auth_status", arguments: {} });
  const statusText = (status.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(statusText, /Not signed in/);

  const list = await client.callTool({
    name: "list_comments",
    arguments: { document: "https://docs.google.com/document/d/1abcdefghijklmnopqrstuvwxyz/edit" },
  });
  assert.equal(list.isError, true);
  const listText = (list.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  assert.match(listText, /credentials not found|No stored Google credentials/);

  const bad = await client.callTool({ name: "list_comments", arguments: { document: "not a doc" } });
  assert.equal(bad.isError, true);

  await client.close();
  console.log(`✔ server: ${tools.length} read-only tools, auth errors handled gracefully`);
}

function testFormatting(): void {
  assert.equal(parseDocumentId("https://docs.google.com/document/d/1AbC_def-123456/edit#heading=h.x"), "1AbC_def-123456");
  assert.equal(parseDocumentId("https://docs.google.com/document/u/1/d/1AbC_def-123456/edit"), "1AbC_def-123456");
  assert.equal(parseDocumentId("  1AbC_def-123456 "), "1AbC_def-123456");

  const raw = {
    id: "AAAA",
    createdTime: "2026-09-20T10:32:00.000Z",
    modifiedTime: "2026-09-21T12:00:00.000Z",
    resolved: true,
    content: "Shouldn't this paragraph go in the introduction?",
    quotedFileContent: { mimeType: "text/html", value: "the project scope" },
    author: { displayName: "Ana", emailAddress: "ana@example.com", me: false },
    replies: [
      {
        id: "r1",
        createdTime: "2026-09-21T09:00:00.000Z",
        content: "Yes, moving it.",
        author: { displayName: "Jose", emailAddress: "jose@example.com", me: true },
      },
      {
        id: "r2",
        createdTime: "2026-09-21T12:00:00.000Z",
        content: "",
        action: "resolve",
        author: { displayName: "Jose", emailAddress: "jose@example.com", me: true },
      },
    ],
  };
  const openRaw = {
    id: "BBBB",
    createdTime: "2026-09-22T08:00:00.000Z",
    resolved: false,
    content: "The delivery date is missing.",
    author: { displayName: "Ana", emailAddress: "ana@example.com" },
    replies: [],
  };

  const resolved = normalizeComment(raw);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.quotedText, "the project scope");
  assert.equal(resolved.resolution?.by.name, "Jose");
  assert.equal(resolved.replies[1]?.action, "resolve");

  const paragraphs = ["Introduction", "This document defines the project scope and its milestones.", "End"];
  const ctx = findContext(paragraphs, resolved.quotedText!);
  assert.equal(ctx?.paragraphIndex, 1);
  resolved.context = ctx;

  const md = formatComment(resolved, 1);
  assert.match(md, /RESOLVED — Ana <ana@example.com> · 2026-09-20 10:32 UTC/);
  assert.match(md, /> the project scope/);
  assert.match(md, /Surrounding paragraph \(#2\)/);
  assert.match(md, /Jose <jose@example.com> \(you\) · 2026-09-21 12:00 UTC — marked as RESOLVED/);
  assert.match(md, /Resolved by Jose/);

  const summary = summarizeComments([resolved, normalizeComment(openRaw)]);
  assert.equal(summary.total, 2);
  assert.equal(summary.open, 1);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.totalReplies, 2);
  assert.equal(summary.unanswered.length, 1);
  assert.equal(summary.unanswered[0]?.id, "BBBB");
  assert.equal(summary.byAuthor[0]?.name, "Ana");
  const jose = summary.byAuthor.find((a) => a.name === "Jose");
  assert.equal(jose?.replies, 2);
  assert.equal(jose?.resolvedByThem, 1);

  const summaryMd = formatSummary({ id: "doc1", name: "Project plan", owners: [] }, summary);
  assert.match(summaryMd, /Total comments: 2 \(1 open, 1 resolved\)/);
  assert.match(summaryMd, /Open comments with no replies \(1\)/);
  console.log("✔ formatting: normalize, context lookup, markdown and summary");
}

testFormatting();
await testServerWithoutCredentials();
console.log("All smoke checks passed.");
