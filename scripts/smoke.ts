/**
 * Smoke test that needs no Google credentials:
 *  1. Starts the server over stdio and lists its tools.
 *  2. Verifies that, without a token, tools return a readable isError result instead of crashing.
 *  3. Exercises comment normalization, summary and formatting with fixture data.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { docs_v1, drive_v3 } from "googleapis";
import { SERVER_VERSION, signInCommand } from "../src/config.js";
import {
  getDocumentInfo,
  normalizeComment,
  findContext,
  parseDocumentId,
  readDocument,
} from "../src/google.js";
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
  assert.match(statusText, /`npm run auth`/); // this test runs from a clone

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

function testSignInCommand(): void {
  const npx = /^`npx -y -p @yeyo11\/google-docs-mcp google-docs-mcp-auth`/;
  assert.match(signInCommand("/home/a/.npm/_npx/f3c/node_modules/@yeyo11/google-docs-mcp/dist/config.js"), npx);
  assert.match(signInCommand("C:\\Users\\a\\node_modules\\@yeyo11\\google-docs-mcp\\dist\\config.js"), npx);
  assert.match(signInCommand("/home/a/code/google-docs-mcp/dist/config.js"), /^`npm run auth`/);
  assert.match(signInCommand("/home/a/code/google-docs-mcp/src/config.ts"), /^`npm run auth`/);
  console.log("✔ sign-in command: npx for an installed package, npm run auth for a clone");
}

/** A Drive stub that, like the real API, returns only the fields it was asked for. */
function fakeDrive(mimeType: string): drive_v3.Drive {
  const file: Record<string, string> = { id: "file1", name: "Budget", mimeType };
  const get = async ({ fields }: { fields: string }) => ({
    data: Object.fromEntries(Object.entries(file).filter(([key]) => fields.split(",").includes(key))),
  });
  return { files: { get } } as unknown as drive_v3.Drive;
}

async function testNotAGoogleDoc(): Promise<void> {
  const doc = "application/vnd.google-apps.document";
  const sheet = "application/vnd.google-apps.spreadsheet";

  assert.equal((await getDocumentInfo(fakeDrive(doc), "file1")).name, "Budget");
  await assert.rejects(getDocumentInfo(fakeDrive(sheet), "file1"), /not a Google Doc \(mimeType .*spreadsheet\)/);

  // The Docs API has its own error for a Sheet: the check must answer first, not race it.
  let docsCalls = 0;
  const docs = {
    documents: {
      get: async () => {
        docsCalls += 1;
        throw new Error("Docs API error");
      },
    },
  } as unknown as docs_v1.Docs;
  await assert.rejects(readDocument({ drive: fakeDrive(sheet), docs }, "file1", true), /not a Google Doc/);
  assert.equal(docsCalls, 0);
  console.log("✔ file type: a bare ID of another file type is refused before reading it");
}

function testCommentAuthorsWithoutEmail(): void {
  // Drive's reference: a comment or reply author's "email address and permission ID will not be populated".
  const comment = normalizeComment({
    id: "CCCC",
    createdTime: "2026-09-22T08:00:00.000Z",
    content: "Looks good.",
    author: { displayName: "Ana", me: false },
    replies: [{ id: "r1", createdTime: "2026-09-22T09:00:00.000Z", content: "Thanks", author: { displayName: "Jose", me: true } }],
  });
  assert.equal(comment.author.email, undefined);
  const md = formatComment(comment);
  assert.match(md, /OPEN — Ana · 2026-09-22 08:00 UTC/);
  assert.match(md, /- Jose \(you\) · 2026-09-22 09:00 UTC: Thanks/);
  assert.deepEqual(
    summarizeComments([comment]).byAuthor.map((a) => a.name),
    ["Ana", "Jose"],
  );
  console.log("✔ comment authors: rendered and counted by display name when Drive returns no email");
}

function testContextLimits(): void {
  // The README's "Limits" section states these.
  assert.equal(findContext(["a short one"], "short"), undefined, "quotes under 8 characters get no paragraph");
  assert.equal(findContext(["same words here", "same words here"], "same words")?.paragraphIndex, 0, "first match");
  assert.equal(findContext(["the text was edited"], "the text as written"), undefined);
  const trimmed = findContext(["x".repeat(1000) + " needle text"], "needle text");
  assert.ok(trimmed && trimmed.paragraph.length <= 602, "paragraphs over 600 characters are trimmed");
  assert.match(trimmed.paragraph, /needle text/);
  console.log("✔ context lookup limits: first match, 8-character minimum, 600-character trim");
}

function testVersionsAgree(): void {
  const read = (file: string) => JSON.parse(readFileSync(path.join(here, "..", file), "utf8"));
  const pkg = read("package.json");
  const lock = read("package-lock.json");
  const registry = read("server.json");
  const versions = {
    "package-lock.json": lock.version,
    'package-lock.json packages[""]': lock.packages[""].version,
    "server.json": registry.version,
    "server.json packages[0]": registry.packages[0].version,
    "src/config.ts": SERVER_VERSION,
  };
  for (const [where, version] of Object.entries(versions)) {
    assert.equal(version, pkg.version, `${where} must match package.json`);
  }
  console.log(`✔ versions: ${pkg.version} everywhere`);
}

testFormatting();
testSignInCommand();
await testNotAGoogleDoc();
testCommentAuthorsWithoutEmail();
testContextLimits();
testVersionsAgree();
await testServerWithoutCredentials();
console.log("All smoke checks passed.");
