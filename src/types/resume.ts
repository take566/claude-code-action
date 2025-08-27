/**
 * Types for resume endpoint functionality
 */

/**
 * Message structure from the resume endpoint
 * This matches the structure used in Claude CLI's teleport feature
 */
export type ResumeMessage = {
  role: "user" | "assistant" | "system";
  content: string | Array<{ type: string; text?: string; [key: string]: any }>;
  [key: string]: any;
};

/**
 * Response structure from the resume endpoint
 */
export type ResumeResponse = {
  log: ResumeMessage[];
  branch?: string;
};

/**
 * Result after processing resume endpoint
 */
export type ResumeResult = {
  messages: ResumeMessage[];
  branchName: string;
};
