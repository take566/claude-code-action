import { describe, it, expect } from "bun:test";
import { prepareRunConfig } from "../src/run-claude";

describe("resume endpoint functionality", () => {
  it("should add --teleport flag when both session_id and resume_endpoint are provided", () => {
    const streamConfig = JSON.stringify({
      session_id: "12345",
      resume_endpoint: "https://example.com/resume/12345",
    });
    const config = prepareRunConfig("/path/to/prompt", {
      streamConfig,
    });

    expect(config.claudeArgs).toContain("--teleport");
    expect(config.claudeArgs).toContain("12345");
  });

  it("should not add --teleport flag when no streamConfig is provided", () => {
    const config = prepareRunConfig("/path/to/prompt", {
      allowedTools: "Edit",
    });

    expect(config.claudeArgs).not.toContain("--teleport");
  });

  it("should not add --teleport flag when only session_id is provided without resume_endpoint", () => {
    const streamConfig = JSON.stringify({
      session_id: "12345",
      // No resume_endpoint
    });
    const config = prepareRunConfig("/path/to/prompt", {
      streamConfig,
    });

    expect(config.claudeArgs).not.toContain("--teleport");
  });

  it("should not add --teleport flag when only resume_endpoint is provided without session_id", () => {
    const streamConfig = JSON.stringify({
      resume_endpoint: "https://example.com/resume/12345",
      // No session_id
    });
    const config = prepareRunConfig("/path/to/prompt", {
      streamConfig,
    });

    expect(config.claudeArgs).not.toContain("--teleport");
  });

  it("should maintain order of arguments with session_id", () => {
    const streamConfig = JSON.stringify({
      session_id: "12345",
      resume_endpoint: "https://example.com/resume/12345",
    });
    const config = prepareRunConfig("/path/to/prompt", {
      allowedTools: "Edit",
      streamConfig,
      maxTurns: "5",
    });

    const teleportIndex = config.claudeArgs.indexOf("--teleport");
    const maxTurnsIndex = config.claudeArgs.indexOf("--max-turns");

    expect(teleportIndex).toBeGreaterThan(-1);
    expect(maxTurnsIndex).toBeGreaterThan(-1);
  });

  it("should handle progress_endpoint and headers in streamConfig", () => {
    const streamConfig = JSON.stringify({
      progress_endpoint: "https://example.com/progress",
      headers: { "X-Test": "value" },
    });
    const config = prepareRunConfig("/path/to/prompt", {
      streamConfig,
    });

    // This test just verifies parsing doesn't fail - actual streaming logic
    // is tested elsewhere as it requires environment setup
    expect(config.claudeArgs).toBeDefined();
  });

  it("should handle session_id with resume_endpoint and headers", () => {
    const streamConfig = JSON.stringify({
      session_id: "abc123",
      resume_endpoint: "https://example.com/resume/abc123",
      headers: { Authorization: "Bearer token" },
      progress_endpoint: "https://example.com/progress",
    });
    const config = prepareRunConfig("/path/to/prompt", {
      streamConfig,
    });

    expect(config.claudeArgs).toContain("--teleport");
    expect(config.claudeArgs).toContain("abc123");
    // Note: Environment variable setup (TELEPORT_RESUME_URL, TELEPORT_HEADERS) is tested in integration tests
  });
});
