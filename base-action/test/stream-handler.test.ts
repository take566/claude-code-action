import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  StreamHandler,
  parseStreamHeaders,
  type TokenGetter,
} from "../src/stream-handler";

describe("parseStreamHeaders", () => {
  it("should return empty object for empty input", () => {
    expect(parseStreamHeaders("")).toEqual({});
    expect(parseStreamHeaders(undefined)).toEqual({});
    expect(parseStreamHeaders("   ")).toEqual({});
  });

  it("should parse single header", () => {
    const result = parseStreamHeaders('{"X-Correlation-Id": "12345"}');
    expect(result).toEqual({ "X-Correlation-Id": "12345" });
  });

  it("should parse multiple headers", () => {
    const headers = JSON.stringify({
      "X-Correlation-Id": "12345",
      "X-Custom-Header": "custom-value",
      Authorization: "Bearer token123",
    });

    const result = parseStreamHeaders(headers);
    expect(result).toEqual({
      "X-Correlation-Id": "12345",
      "X-Custom-Header": "custom-value",
      Authorization: "Bearer token123",
    });
  });

  it("should handle headers with spaces", () => {
    const headers = JSON.stringify({
      "X-Header-One": "value with spaces",
      "X-Header-Two": "another value",
    });

    const result = parseStreamHeaders(headers);
    expect(result).toEqual({
      "X-Header-One": "value with spaces",
      "X-Header-Two": "another value",
    });
  });

  it("should skip empty lines and comments", () => {
    const headers = JSON.stringify({
      "X-Header-One": "value1",
      "X-Header-Two": "value2",
      "X-Header-Three": "value3",
    });

    const result = parseStreamHeaders(headers);
    expect(result).toEqual({
      "X-Header-One": "value1",
      "X-Header-Two": "value2",
      "X-Header-Three": "value3",
    });
  });

  it("should skip lines without colons", () => {
    const headers = JSON.stringify({
      "X-Header-One": "value1",
      "X-Header-Two": "value2",
    });

    const result = parseStreamHeaders(headers);
    expect(result).toEqual({
      "X-Header-One": "value1",
      "X-Header-Two": "value2",
    });
  });

  it("should handle headers with colons in values", () => {
    const headers = JSON.stringify({
      "X-URL": "https://example.com:8080/path",
      "X-Time": "10:30:45",
    });

    const result = parseStreamHeaders(headers);
    expect(result).toEqual({
      "X-URL": "https://example.com:8080/path",
      "X-Time": "10:30:45",
    });
  });
});

describe("StreamHandler", () => {
  let handler: StreamHandler;
  let mockFetch: ReturnType<typeof mock>;
  let mockTokenGetter: TokenGetter;
  const mockEndpoint = "https://test.example.com/stream";
  const mockToken = "mock-oidc-token";

  beforeEach(() => {
    // Mock fetch
    mockFetch = mock(() => Promise.resolve({ ok: true }));
    global.fetch = mockFetch as any;

    // Mock token getter
    mockTokenGetter = mock(() => Promise.resolve(mockToken));
  });

  describe("basic functionality", () => {
    it("should batch lines up to BATCH_SIZE", async () => {
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      // Add 9 lines (less than batch size of 10)
      for (let i = 1; i <= 9; i++) {
        await handler.addOutput(`line ${i}\n`);
      }

      // Should not have sent anything yet
      expect(mockFetch).not.toHaveBeenCalled();

      // Add the 10th line to trigger flush
      await handler.addOutput("line 10\n");

      // Should have sent the batch
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(mockEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mockToken}`,
        },
        body: expect.stringContaining(
          '"output":["line 1","line 2","line 3","line 4","line 5","line 6","line 7","line 8","line 9","line 10"]',
        ),
        signal: expect.any(AbortSignal),
      });
    });

    it("should flush on timeout", async () => {
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      // Add a few lines
      await handler.addOutput("line 1\n");
      await handler.addOutput("line 2\n");

      // Should not have sent anything yet
      expect(mockFetch).not.toHaveBeenCalled();

      // Wait for the timeout to trigger
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should have sent the batch
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call).toBeDefined();
      const body = JSON.parse(call![1].body);
      expect(body.output).toEqual(["line 1", "line 2"]);
    });

    it("should include custom headers", async () => {
      const customHeaders = {
        "X-Correlation-Id": "12345",
        "X-Custom": "value",
      };
      handler = new StreamHandler(mockEndpoint, customHeaders, mockTokenGetter);

      // Trigger a batch
      for (let i = 1; i <= 10; i++) {
        await handler.addOutput(`line ${i}\n`);
      }

      expect(mockFetch).toHaveBeenCalledWith(mockEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mockToken}`,
          "X-Correlation-Id": "12345",
          "X-Custom": "value",
        },
        body: expect.any(String),
        signal: expect.any(AbortSignal),
      });
    });

    it("should include timestamp in payload", async () => {
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      const beforeTime = new Date().toISOString();

      // Trigger a batch
      for (let i = 1; i <= 10; i++) {
        await handler.addOutput(`line ${i}\n`);
      }

      const afterTime = new Date().toISOString();

      const call = mockFetch.mock.calls[0];
      expect(call).toBeDefined();
      const body = JSON.parse(call![1].body);

      expect(body).toHaveProperty("timestamp");
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
      expect(body.timestamp >= beforeTime).toBe(true);
      expect(body.timestamp <= afterTime).toBe(true);
    });
  });

  describe("token management", () => {
    it("should fetch token on first request", async () => {
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      // Trigger a flush
      for (let i = 1; i <= 10; i++) {
        await handler.addOutput(`line ${i}\n`);
      }

      expect(mockTokenGetter).toHaveBeenCalledWith("claude-code-github-action");
      expect(mockTokenGetter).toHaveBeenCalledTimes(1);
    });

    it("should reuse token within 4 minutes", async () => {
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      // First batch
      for (let i = 1; i <= 10; i++) {
        await handler.addOutput(`line ${i}\n`);
      }

      // Second batch immediately (within 4 minutes)
      for (let i = 11; i <= 20; i++) {
        await handler.addOutput(`line ${i}\n`);
      }

      // Should have only fetched token once
      expect(mockTokenGetter).toHaveBeenCalledTimes(1);
    });

    it("should handle token fetch errors", async () => {
      const errorTokenGetter = mock(() =>
        Promise.reject(new Error("Token fetch failed")),
      );
      handler = new StreamHandler(mockEndpoint, {}, errorTokenGetter);

      // Try to send data
      for (let i = 1; i <= 10; i++) {
        await handler.addOutput(`line ${i}\n`);
      }

      // Should not have made fetch request
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle fetch errors gracefully", async () => {
      mockFetch.mockImplementation(() =>
        Promise.reject(new Error("Network error")),
      );
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      // Send data - should not throw
      for (let i = 1; i <= 10; i++) {
        await handler.addOutput(`line ${i}\n`);
      }

      // Should have attempted to fetch
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should continue processing after errors", async () => {
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      // First batch - make it fail
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("First batch failed"));
        }
        return Promise.resolve({ ok: true });
      });

      for (let i = 1; i <= 10; i++) {
        await handler.addOutput(`line ${i}\n`);
      }

      // Second batch - should work
      for (let i = 11; i <= 20; i++) {
        await handler.addOutput(`line ${i}\n`);
      }

      // Should have attempted both batches
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("close functionality", () => {
    it("should flush remaining data on close", async () => {
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      // Add some data but not enough to trigger batch
      await handler.addOutput("line 1\n");
      await handler.addOutput("line 2\n");

      expect(mockFetch).not.toHaveBeenCalled();

      // Close should flush
      await handler.close();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call).toBeDefined();
      const body = JSON.parse(call![1].body);
      expect(body.output).toEqual(["line 1", "line 2"]);
    });

    it("should not accept new data after close", async () => {
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      await handler.close();

      // Try to add data after close
      await handler.addOutput("should not be sent\n");

      // Should not have sent anything
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("data handling", () => {
    it("should filter out empty lines", async () => {
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      await handler.addOutput("line 1\n\n\nline 2\n\n");
      await handler.close();

      const call = mockFetch.mock.calls[0];
      expect(call).toBeDefined();
      const body = JSON.parse(call![1].body);
      expect(body.output).toEqual(["line 1", "line 2"]);
    });

    it("should handle data without newlines", async () => {
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      await handler.addOutput("single line");
      await handler.close();

      const call = mockFetch.mock.calls[0];
      expect(call).toBeDefined();
      const body = JSON.parse(call![1].body);
      expect(body.output).toEqual(["single line"]);
    });

    it("should handle multi-line input correctly", async () => {
      handler = new StreamHandler(mockEndpoint, {}, mockTokenGetter);

      await handler.addOutput("line 1\nline 2\nline 3");
      await handler.close();

      const call = mockFetch.mock.calls[0];
      expect(call).toBeDefined();
      const body = JSON.parse(call![1].body);
      expect(body.output).toEqual(["line 1", "line 2", "line 3"]);
    });
  });
});
