import type { ThinklysClient } from "../data/thinklysClient.js";

export interface ToolContext {
  client: ThinklysClient;
}

export class ToolError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}
