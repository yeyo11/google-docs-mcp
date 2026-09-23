#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { registerTools } from "./tools.js";

const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    instructions:
      "Read-only access to the user's Google Docs. The main purpose of this server is to describe the comments " +
      "of a document in detail (authors, dates, status, quoted text, reply threads). Start with list_documents " +
      "to find a document, then list_comments or get_comments_summary. Nothing here can modify Google data. " +
      "If a tool reports that the server is not signed in, ask the user to run `npm run auth`.",
  },
);

registerTools(server);

// stdout is reserved for the MCP protocol: all logging goes to stderr.
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`${SERVER_NAME} ${SERVER_VERSION} ready (read-only, stdio)`);
