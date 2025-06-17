import { describe, test, expect } from "bun:test";
import type { StreamConfig } from "../src/types/stream-config";

describe("report-claude-complete", () => {
  test("StreamConfig type should include system_progress_endpoint", () => {
    const config: StreamConfig = {
      progress_endpoint: "https://example.com/progress",
      system_progress_endpoint: "https://example.com/system-progress",
      resume_endpoint: "https://example.com/resume",
      session_id: "test-session",
      headers: {
        Authorization: "Bearer test-token",
      },
    };

    expect(config.system_progress_endpoint).toBe(
      "https://example.com/system-progress",
    );
  });

  test("StreamConfig type should allow optional fields", () => {
    const config: StreamConfig = {};

    expect(config.system_progress_endpoint).toBeUndefined();
    expect(config.progress_endpoint).toBeUndefined();
    expect(config.headers).toBeUndefined();
  });
});
