import * as core from "@actions/core";

export function parseStreamHeaders(
  headersInput?: string,
): Record<string, string> {
  if (!headersInput || headersInput.trim() === "") {
    return {};
  }

  try {
    return JSON.parse(headersInput);
  } catch (e) {
    console.error("Failed to parse stream headers as JSON:", e);
    return {};
  }
}

export type TokenGetter = (audience: string) => Promise<string>;

export class StreamHandler {
  private endpoint: string;
  private customHeaders: Record<string, string>;
  private tokenGetter: TokenGetter;
  private token: string | null = null;
  private tokenFetchTime: number = 0;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isClosed = false;

  private readonly TOKEN_LIFETIME_MS = 4 * 60 * 1000; // 4 minutes
  private readonly BATCH_SIZE = 10;
  private readonly BATCH_TIMEOUT_MS = 1000;
  private readonly REQUEST_TIMEOUT_MS = 5000;

  constructor(
    endpoint: string,
    customHeaders: Record<string, string> = {},
    tokenGetter?: TokenGetter,
  ) {
    this.endpoint = endpoint;
    this.customHeaders = customHeaders;
    this.tokenGetter = tokenGetter || ((audience) => core.getIDToken(audience));
  }

  async addOutput(data: string): Promise<void> {
    if (this.isClosed) return;

    // Split by newlines and add to buffer
    const lines = data.split("\n").filter((line) => line.length > 0);
    this.buffer.push(...lines);

    // Check if we should flush
    if (this.buffer.length >= this.BATCH_SIZE) {
      await this.flush();
    } else {
      // Set or reset the timer
      this.resetFlushTimer();
    }
  }

  private resetFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flush().catch((err) => {
        core.warning(`Failed to flush stream buffer: ${err}`);
      });
    }, this.BATCH_TIMEOUT_MS);
  }

  private async getToken(): Promise<string> {
    const now = Date.now();

    // Check if we need a new token
    if (!this.token || now - this.tokenFetchTime >= this.TOKEN_LIFETIME_MS) {
      try {
        this.token = await this.tokenGetter("claude-code-github-action");
        this.tokenFetchTime = now;
        core.debug("Fetched new OIDC token for streaming");
      } catch (error) {
        throw new Error(`Failed to get OIDC token: ${error}`);
      }
    }

    return this.token;
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Clear the flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Get the current buffer and clear it
    const output = [...this.buffer];
    this.buffer = [];

    try {
      const token = await this.getToken();

      const payload = {
        timestamp: new Date().toISOString(),
        output: output,
      };

      // Create an AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.REQUEST_TIMEOUT_MS,
      );

      try {
        await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...this.customHeaders,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      // Log but don't throw - we don't want to interrupt Claude's execution
      core.warning(`Failed to stream output: ${error}`);
    }
  }

  async close(): Promise<void> {
    // Clear any pending timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining output
    if (this.buffer.length > 0) {
      await this.flush();
    }

    // Mark as closed after flushing
    this.isClosed = true;
  }
}
