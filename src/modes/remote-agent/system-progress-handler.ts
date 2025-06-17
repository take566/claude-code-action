import * as core from "@actions/core";
import type {
  ProgressEvent,
  SystemProgressPayload,
  SystemProgressConfig,
  WorkflowInitializingEvent,
  ClaudeStartingEvent,
  ClaudeCompleteEvent,
  WorkflowFailedEvent,
} from "./progress-types";

/**
 * Send a progress event to the system progress endpoint (fire-and-forget)
 */
function sendProgressEvent(
  event: ProgressEvent,
  config: SystemProgressConfig,
  oidcToken: string,
): void {
  const payload: SystemProgressPayload = event;

  console.log(
    `Sending system progress event: ${event.event_type}`,
    JSON.stringify(payload, null, 2),
  );

  // Fire and forget - don't await
  Promise.resolve().then(async () => {
    try {
      // Create an AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        config.timeout_ms || 5000,
      );

      try {
        const response = await fetch(config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${oidcToken}`,
            ...config.headers,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          console.error(
            `System progress endpoint returned ${response.status}: ${response.statusText}`,
          );
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      // Log but don't throw - we don't want progress reporting to interrupt the workflow
      core.warning(`Failed to send system progress event: ${error}`);
    }
  });
}

/**
 * Report workflow initialization complete
 */
export function reportWorkflowInitialized(
  config: SystemProgressConfig,
  oidcToken: string,
  branch: string,
  baseBranch: string,
  sessionId?: string,
): void {
  const event: WorkflowInitializingEvent = {
    timestamp: new Date().toISOString(),
    event_type: "workflow_initializing",
    data: {
      branch,
      base_branch: baseBranch,
      ...(sessionId && { session_id: sessionId }),
    },
  };

  sendProgressEvent(event, config, oidcToken);
}

/**
 * Report Claude is starting
 */
export function reportClaudeStarting(
  config: SystemProgressConfig,
  oidcToken: string,
): void {
  const event: ClaudeStartingEvent = {
    timestamp: new Date().toISOString(),
    event_type: "claude_starting",
    data: {},
  };

  sendProgressEvent(event, config, oidcToken);
}

/**
 * Report Claude completed
 */
export function reportClaudeComplete(
  config: SystemProgressConfig,
  oidcToken: string,
  exitCode: number,
  durationMs: number,
): void {
  const event: ClaudeCompleteEvent = {
    timestamp: new Date().toISOString(),
    event_type: "claude_complete",
    data: {
      exit_code: exitCode,
      duration_ms: durationMs,
    },
  };

  sendProgressEvent(event, config, oidcToken);
}

/**
 * Report workflow failed
 */
export function reportWorkflowFailed(
  config: SystemProgressConfig,
  oidcToken: string,
  phase: "initialization" | "claude_execution",
  error: Error | string,
  code: string,
): void {
  const errorMessage = error instanceof Error ? error.message : error;

  const event: WorkflowFailedEvent = {
    timestamp: new Date().toISOString(),
    event_type: "workflow_failed",
    data: {
      error: {
        phase,
        message: errorMessage,
        code,
      },
    },
  };

  sendProgressEvent(event, config, oidcToken);
}
