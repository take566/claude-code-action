/**
 * Configuration for streaming and progress tracking
 */
export type StreamConfig = {
  /** Endpoint for streaming Claude execution progress */
  progress_endpoint?: string;

  /** Endpoint for system-level progress reporting (workflow lifecycle events) */
  system_progress_endpoint?: string;

  /** Resume endpoint for teleport functionality */
  resume_endpoint?: string;

  /** Session ID for tracking */
  session_id?: string;

  /** Headers to include with streaming requests (includes Authorization) */
  headers?: Record<string, string>;
};
