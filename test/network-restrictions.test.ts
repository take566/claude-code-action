import { describe, it, expect } from "bun:test";

describe("Network Restrictions", () => {
  it("should block access to unauthorized domains", async () => {
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
          agent: undefined,
        });

        expect(response.ok).toBe(false);
        throw new Error(`Unauthorized domain ${url} was not blocked by proxy`);
      } catch (error) {
        expect(error).toBeDefined();
        console.log(`Successfully blocked: ${url}`);
      }
    }
  });

  it("should allow access to whitelisted domains", async () => {
    const allowedUrls = [
      "https://api.github.com/zen",
      "https://registry.npmjs.org/-/ping",
    ];

    for (const url of allowedUrls) {
      try {
        const response = await fetch(url, { timeout: 5000 });
        expect(response.ok).toBe(true);
        console.log(`Successfully allowed: ${url}`);
      } catch (error) {
        throw new Error(
          `Whitelisted domain ${url} was blocked: ${error.message}`,
        );
      }
    }
  });
});
