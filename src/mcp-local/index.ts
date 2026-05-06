// Public entry point for V2's local MCP module (T071).

export { createLocalMcpServer, LOCAL_TOOL_FACTORIES } from './server.js';
export type { LocalMcpServer } from './server.js';
export { LOCAL_ADAPTER_NAME } from './types.js';
export type { LocalToolDeps, LocalToolContext, LocalToolFactory } from './types.js';
