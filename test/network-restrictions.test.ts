import { describe, test, expect } from "bun:test";

describe("Network Restrictions", () => {
  test("should block access to unauthorized domains", async () => {
    const url = "https://example.com/api/data";

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      expect(response.ok).toBe(false);
      throw new Error(`Unauthorized domain ${url} was not blocked by proxy`);
    } catch (error) {
      expect(error).toBeDefined();
      console.log(`Successfully blocked: ${url}`);
    }
  });

  test("should allow access to whitelisted domains", async () => {
    const url = "https://api.github.com/zen";

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      expect(response.ok).toBe(true);
      console.log(`Successfully allowed: ${url}`);
    } catch (error: any) {
      throw new Error(
        `Whitelisted domain ${url} was blocked: ${error.message}`,
      );
    }
  });
});
