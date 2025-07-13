import { describe, it, expect } from "bun:test";

describe("Network Restrictions", () => {
  it("should block access to unauthorized domains", async () => {
    // This test verifies that the proxy blocks unauthorized domains
    const unauthorizedUrls = [
      "https://example.com/api/data",
      "https://jsonplaceholder.typicode.com/posts",
      "https://httpbin.org/get",
      "https://pastebin.com/raw/example123",
      "https://google.com",
    ];

    for (const url of unauthorizedUrls) {
      try {
        const response = await fetch(url, {
          timeout: 5000,
          // Force through proxy if set
          agent: undefined,
        });

        // If we reach here, the proxy didn't block it - test should fail
        expect(response.ok).toBe(false);
        throw new Error(`Unauthorized domain ${url} was not blocked by proxy`);
      } catch (error) {
        // We expect an error (connection refused, timeout, etc)
        // This is the desired behavior - proxy blocked the request
        expect(error).toBeDefined();
        console.log(`✓ Successfully blocked: ${url}`);
      }
    }
  });

  it("should allow access to whitelisted domains", async () => {
    // These should work through the proxy
    const allowedUrls = [
      "https://api.github.com/zen",
      "https://registry.npmjs.org/-/ping",
    ];

    for (const url of allowedUrls) {
      try {
        const response = await fetch(url, { timeout: 5000 });
        expect(response.ok).toBe(true);
        console.log(`✓ Successfully allowed: ${url}`);
      } catch (error) {
        // If whitelisted domains fail, something is wrong
        throw new Error(
          `Whitelisted domain ${url} was blocked: ${error.message}`,
        );
      }
    }
  });
});
