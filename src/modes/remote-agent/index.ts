import * as core from "@actions/core";
import { mkdir, writeFile } from "fs/promises";
import type { Mode, ModeOptions, ModeResult } from "../types";
import { isRepositoryDispatchEvent } from "../../github/context";
import type { GitHubContext } from "../../github/context";
import { setupBranch } from "../../github/operations/branch";
import { configureGitAuth } from "../../github/operations/git-config";
import { prepareMcpConfig } from "../../mcp/install-mcp-server";
import { GITHUB_SERVER_URL } from "../../github/api/config";
import {
  buildAllowedToolsString,
  buildDisallowedToolsString,
  type PreparedContext,
} from "../../create-prompt";
import {
  reportWorkflowInitialized,
  reportClaudeStarting,
  reportWorkflowFailed,
} from "./system-progress-handler";
import type { SystemProgressConfig } from "./progress-types";
import { fetchUserDisplayName } from "../../github/data/fetcher";
import { createOctokit } from "../../github/api/client";
import type { StreamConfig } from "../../types/stream-config";

/**
 * Fetches a Claude Code OAuth token from the specified endpoint using OIDC authentication
 */
async function fetchClaudeCodeOAuthToken(
  oauthTokenEndpoint: string,
  oidcToken?: string,
  sessionId?: string,
): Promise<string> {
  console.log(`Fetching Claude Code OAuth token from: ${oauthTokenEndpoint}`);

  try {
    if (!oidcToken) {
      throw new Error("OIDC token is required for OAuth authentication");
    }

    // Make request to OAuth token endpoint
    const response = await fetch(oauthTokenEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oidcToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(sessionId && { session_id: sessionId }),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OAuth token request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      oauth_token?: string;
      message?: string;
    };

    if (!data.oauth_token) {
      const message = data.message || "Unknown error";
      throw new Error(`OAuth token request failed: ${message}`);
    }

    console.log("Successfully fetched Claude Code OAuth token");
    return data.oauth_token;
  } catch (error) {
    console.error("Failed to fetch Claude Code OAuth token:", error);
    throw error;
  }
}

/**
 * Remote Agent mode implementation.
 *
 * This mode is specifically designed for repository_dispatch events triggered by external APIs.
 * It bypasses the standard trigger checking, comment tracking, and GitHub data fetching used by tag mode,
 * making it ideal for automated tasks triggered via API calls with custom payloads.
 */
export const remoteAgentMode: Mode = {
  name: "remote-agent",
  description: "Remote automation mode for repository_dispatch events",

  shouldTrigger(context) {
    // Only trigger for repository_dispatch events
    return isRepositoryDispatchEvent(context);
  },

  prepareContext(context, data) {
    // Remote agent mode uses minimal context
    return {
      mode: "remote-agent",
      githubContext: context,
      baseBranch: data?.baseBranch,
      claudeBranch: data?.claudeBranch,
    };
  },

  getAllowedTools() {
    return [];
  },

  getDisallowedTools() {
    return [];
  },

  shouldCreateTrackingComment() {
    return false;
  },

  async prepare({
    context,
    octokit,
    githubToken,
  }: ModeOptions): Promise<ModeResult> {
    // Remote agent mode handles repository_dispatch events only

    if (!isRepositoryDispatchEvent(context)) {
      throw new Error(
        "Remote agent mode can only handle repository_dispatch events",
      );
    }

    // Extract task details from client_payload
    const payload = context.payload;
    const clientPayload = payload.client_payload as {
      prompt?: string;
      stream_endpoint?: string;
      headers?: Record<string, string>;
      resume_endpoint?: string;
      session_id?: string;
      endpoints?: {
        stream?: string;
        progress?: string;
        systemProgress?: string;
        oauthToken?: string;
      };
      overrideInputs?: {
        model?: string;
        base_branch?: string;
      };
    };

    // Get OIDC token for streaming and potential OAuth token fetching
    let oidcToken: string;
    try {
      oidcToken = await core.getIDToken("claude-code-github-action");
    } catch (error) {
      console.error("Failed to get OIDC token:", error);
      throw new Error(
        `OIDC token required for remote-agent mode. Please add 'id-token: write' to your workflow permissions. Error: ${error}`,
      );
    }

    // Set up system progress config if endpoint is provided
    let systemProgressConfig: SystemProgressConfig | null = null;
    if (context.progressTracking?.systemProgressEndpoint) {
      systemProgressConfig = {
        endpoint: context.progressTracking.systemProgressEndpoint,
        headers: context.progressTracking.headers,
      };
    }

    // Handle authentication - fetch OAuth token if needed
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const claudeCodeOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

    if (!anthropicApiKey && !claudeCodeOAuthToken) {
      const oauthTokenEndpoint = context.progressTracking?.oauthTokenEndpoint;

      if (oauthTokenEndpoint) {
        console.log(
          "No API key or OAuth token found, fetching OAuth token from endpoint",
        );
        try {
          const fetchedToken = await fetchClaudeCodeOAuthToken(
            oauthTokenEndpoint,
            oidcToken,
            context.progressTracking?.sessionId,
          );
          core.setOutput("claude_code_oauth_token", fetchedToken);
          console.log(
            "Successfully fetched and set OAuth token for Claude Code",
          );
        } catch (error) {
          console.error("Failed to fetch OAuth token:", error);
          throw new Error(
            `Authentication failed: No API key or OAuth token available, and OAuth token fetching failed: ${error}`,
          );
        }
      } else {
        throw new Error(
          "No authentication available: Missing ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, and no OAuth token endpoint provided",
        );
      }
    } else {
      console.log("Using existing authentication (API key or OAuth token)");
    }

    const taskDescription =
      clientPayload.prompt ||
      context.inputs.directPrompt ||
      "No task description provided";

    // Setup branch for work isolation
    let branchInfo;
    try {
      branchInfo = await setupBranch(octokit, null, context);
    } catch (error) {
      // Report failure if we have system progress config
      if (systemProgressConfig) {
        reportWorkflowFailed(
          systemProgressConfig,
          oidcToken,
          "initialization",
          error as Error,
          "branch_setup_failed",
        );
      }
      throw error;
    }

    // Configure git authentication if not using commit signing
    if (!context.inputs.useCommitSigning) {
      try {
        // Force Claude bot as git user
        await configureGitAuth(githubToken, context, {
          login: "claude[bot]",
          id: 209825114,
        });
      } catch (error) {
        console.error("Failed to configure git authentication:", error);
        // Report failure if we have system progress config
        if (systemProgressConfig) {
          reportWorkflowFailed(
            systemProgressConfig,
            oidcToken,
            "initialization",
            error as Error,
            "git_config_failed",
          );
        }
        throw error;
      }
    }

    // Report workflow initialized
    if (systemProgressConfig) {
      reportWorkflowInitialized(
        systemProgressConfig,
        oidcToken,
        branchInfo.claudeBranch || branchInfo.currentBranch,
        branchInfo.baseBranch,
        context.progressTracking?.sessionId,
      );
    }

    // Create prompt directory
    await mkdir(`${process.env.RUNNER_TEMP}/claude-prompts`, {
      recursive: true,
    });

    // Fetch trigger user display name from context.actor
    let triggerDisplayName: string | null | undefined;
    if (context.actor) {
      try {
        const octokits = createOctokit(githubToken);
        triggerDisplayName = await fetchUserDisplayName(
          octokits,
          context.actor,
        );
      } catch (error) {
        console.warn(
          `Failed to fetch user display name for ${context.actor}:`,
          error,
        );
      }
    }

    // Generate dispatch-specific prompt (just the task description)
    const promptContent = generateDispatchPrompt(taskDescription);

    console.log("Writing prompt file...");
    console.log("Contents: ", promptContent);
    // Write the prompt file
    await writeFile(
      `${process.env.RUNNER_TEMP}/claude-prompts/claude-prompt.txt`,
      promptContent,
    );
    console.log(
      `Prompt file written successfully to ${process.env.RUNNER_TEMP}/claude-prompts/claude-prompt.txt`,
    );

    // Set stream configuration for repository_dispatch events
    if (context.progressTracking) {
      const streamConfig: StreamConfig = {};

      if (context.progressTracking.resumeEndpoint) {
        streamConfig.resume_endpoint = context.progressTracking.resumeEndpoint;
      }

      if (context.progressTracking.sessionId) {
        streamConfig.session_id = context.progressTracking.sessionId;
      }

      if (context.progressTracking.progressEndpoint) {
        streamConfig.progress_endpoint =
          context.progressTracking.progressEndpoint;
      }

      if (context.progressTracking.systemProgressEndpoint) {
        streamConfig.system_progress_endpoint =
          context.progressTracking.systemProgressEndpoint;
      }

      // Merge provided headers with OIDC token
      const headers: Record<string, string> = {
        ...(context.progressTracking.headers || {}),
      };

      // Use existing OIDC token for streaming
      headers["Authorization"] = `Bearer ${oidcToken}`;

      if (Object.keys(headers).length > 0) {
        streamConfig.headers = headers;
      }

      console.log("Setting stream config:", streamConfig);
      core.setOutput("stream_config", JSON.stringify(streamConfig));
    }

    // Export tool environment variables for remote agent mode
    // Check if we have actions:read permission for CI tools
    const hasActionsReadPermission =
      context.inputs.additionalPermissions.get("actions") === "read";

    const allowedToolsString = buildAllowedToolsString(
      context.inputs.allowedTools,
      hasActionsReadPermission,
      context.inputs.useCommitSigning,
    );
    const disallowedToolsString = buildDisallowedToolsString(
      context.inputs.disallowedTools,
    );

    core.exportVariable("ALLOWED_TOOLS", allowedToolsString);
    core.exportVariable("DISALLOWED_TOOLS", disallowedToolsString);

    // Handle model override from repository_dispatch payload
    if (clientPayload.overrideInputs?.model) {
      core.setOutput("anthropic_model", clientPayload.overrideInputs.model);
    }

    // Get minimal MCP configuration for remote agent mode
    const additionalMcpConfig = process.env.MCP_CONFIG || "";
    const mcpConfig = await prepareMcpConfig({
      githubToken,
      owner: context.repository.owner,
      repo: context.repository.repo,
      branch: branchInfo.claudeBranch || branchInfo.currentBranch,
      baseBranch: branchInfo.baseBranch,
      additionalMcpConfig,
      claudeCommentId: "", // No comment ID for remote agent mode
      allowedTools: context.inputs.allowedTools,
      context,
    });

    core.setOutput("mcp_config", mcpConfig);

    // Report Claude is starting
    if (systemProgressConfig) {
      reportClaudeStarting(systemProgressConfig, oidcToken);
    }

    // Track Claude start time for duration calculation
    core.setOutput("claude_start_time", Date.now().toString());

    // Export system prompt for remote agent mode
    const systemPrompt = generateDispatchSystemPrompt(
      context,
      branchInfo.baseBranch,
      branchInfo.claudeBranch,
      context.actor,
      triggerDisplayName,
    );
    core.exportVariable("APPEND_SYSTEM_PROMPT", systemPrompt);

    return {
      commentId: undefined, // No comment tracking for remote agent mode
      branchInfo,
      mcpConfig,
    };
  },

  generatePrompt(context: PreparedContext): string {
    // TODO: update this to generate a more meaningful prompt
    return `Repository: ${context.repository}`;
  },
};

/**
 * Generates a task-focused prompt for repository_dispatch events
 */
function generateDispatchPrompt(taskDescription: string): string {
  return taskDescription;
}

/**
 * Generates the system prompt portion for repository_dispatch events
 */
function generateDispatchSystemPrompt(
  context: GitHubContext,
  baseBranch: string,
  claudeBranch: string | undefined,
  triggerUsername?: string,
  triggerDisplayName?: string | null,
): string {
  const { repository } = context;

  const coAuthorLine =
    triggerUsername && (triggerDisplayName || triggerUsername !== "Unknown")
      ? `Co-authored-by: ${triggerDisplayName ?? triggerUsername} <${triggerUsername}@users.noreply.github.com>`
      : "";

  let commitInstructions = "";
  if (context.inputs.useCommitSigning) {
    commitInstructions = `- Use mcp__github_file_ops__commit_files and mcp__github_file_ops__delete_files to commit and push changes`;
    if (coAuthorLine) {
      commitInstructions += `
- When pushing changes, include a Co-authored-by trailer in the commit message
- Use: "${coAuthorLine}"`;
    }
  } else {
    commitInstructions = `- Use git commands via the Bash tool to commit and push your changes:
  - Stage files: Bash(git add <files>)
  - Commit with a descriptive message: Bash(git commit -m "<message>")`;
    if (coAuthorLine) {
      commitInstructions += `
  - When committing, include a Co-authored-by trailer:
    Bash(git commit -m "<message>\\n\\n${coAuthorLine}")`;
    }
    commitInstructions += `
  - Be sure to follow your commit message guidelines
  - Push to the remote: Bash(git push origin HEAD)`;
  }

  return `You are Claude, an AI assistant designed to help with GitHub issues and pull requests. Think carefully as you analyze the context and respond appropriately. Here's the context for your current task:

Your task is to complete the request described in the task description.

Instructions:
1. For questions: Research the codebase and provide a detailed answer
2. For implementations: Make the requested changes, commit, and push

Key points:
- You're already on a new branch - NEVER create another branch (this is very important). ${claudeBranch} is the ONLY branch you should work on.
${commitInstructions}
${
  claudeBranch
    ? `- After completing your work, provide a URL to create a PR in this format:

    ${GITHUB_SERVER_URL}/${repository.owner}/${repository.repo}/compare/${baseBranch}...${claudeBranch}?quick_pull=1`
    : ""
}`;
}
