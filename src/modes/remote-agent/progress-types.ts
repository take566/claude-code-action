/**
 * System progress tracking types for remote agent mode
 */

/**
 * Base event structure
 */
type BaseProgressEvent = {
  timestamp: string; // ISO 8601
};

/**
 * Workflow initializing event
 */
export type WorkflowInitializingEvent = BaseProgressEvent & {
  event_type: "workflow_initializing";
  data: {
    branch: string;
    base_branch: string;
    session_id?: string;
  };
};

/**
 * Claude starting event
 */
export type ClaudeStartingEvent = BaseProgressEvent & {
  event_type: "claude_starting";
  data: Record<string, never>; // No data needed
};

/**
 * Claude complete event
 */
export type ClaudeCompleteEvent = BaseProgressEvent & {
  event_type: "claude_complete";
  data: {
    exit_code: number;
    duration_ms: number;
  };
};

/**
 * Workflow failed event
 */
export type WorkflowFailedEvent = BaseProgressEvent & {
  event_type: "workflow_failed";
  data: {
    error: {
      phase: "initialization" | "claude_execution";
      message: string;
      code: string;
    };
  };
};

/**
 * Discriminated union of all progress events
 */
export type ProgressEvent =
  | WorkflowInitializingEvent
  | ClaudeStartingEvent
  | ClaudeCompleteEvent
  | WorkflowFailedEvent;

/**
 * Payload sent to the system progress endpoint
 */
export type SystemProgressPayload = ProgressEvent;

/**
 * Configuration for system progress reporting
 */
export type SystemProgressConfig = {
  endpoint: string;
  headers?: Record<string, string>;
  timeout_ms?: number; // Default: 5000
};
