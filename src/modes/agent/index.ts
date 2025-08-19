import * as core from "@actions/core";
import { mkdir, writeFile } from "fs/promises";
import type { Mode, ModeOptions, ModeResult } from "../types";
import type { PreparedContext } from "../../create-prompt/types";

/**
 * Agent mode implementation.
 *
 * This mode runs whenever an explicit prompt is provided in the workflow configuration.
 * It bypasses the standard @claude mention checking and comment tracking used by tag mode,
 * providing direct access to Claude Code for automation workflows.
 */
export const agentMode: Mode = {
  name: "agent",
  description: "Direct automation mode for explicit prompts",

  shouldTrigger(context) {
    // Only trigger when an explicit prompt is provided
    return !!context.inputs?.prompt;
  },

  prepareContext(context) {
    // Agent mode doesn't use comment tracking or branch management
    return {
      mode: "agent",
      githubContext: context,
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

  async prepare({ context, githubToken }: ModeOptions): Promise<ModeResult> {
    // Agent mode handles automation events and any event with explicit prompts

    // TODO: handle by createPrompt (similar to tag and review modes)
    // Create prompt directory
    await mkdir(`${process.env.RUNNER_TEMP}/claude-prompts`, {
      recursive: true,
    });
    // Write the prompt file - the base action requires a prompt_file parameter.
    // Use the unified prompt field from v1.0.
    const promptContent =
      context.inputs.prompt ||
      `Repository: ${context.repository.owner}/${context.repository.repo}`;
    await writeFile(
      `${process.env.RUNNER_TEMP}/claude-prompts/claude-prompt.txt`,
      promptContent,
    );

    // Agent mode: User has full control via claudeArgs
    // No default tools are enforced - Claude Code's defaults will apply

    // Always include the GitHub comment server in agent mode
    // This ensures GitHub tools (PR reviews, comments, etc.) work out of the box
    // without requiring users to manually configure the MCP server
    const mcpConfig: any = {
      mcpServers: {
        "github-comment-server": {
          command: "bun",
          args: [
            "run",
            `${process.env.GITHUB_ACTION_PATH}/src/mcp/github-comment-server.ts`,
          ],
          env: {
            GITHUB_TOKEN: githubToken || "",
            REPO_OWNER: context.repository.owner,
            REPO_NAME: context.repository.repo,
            GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || "",
            GITHUB_API_URL:
              process.env.GITHUB_API_URL || "https://api.github.com",
          },
        },
      },
    };

    // Add GitHub file ops server when using commit signing
    if (context.inputs?.useCommitSigning) {
      mcpConfig.mcpServers["github-file-ops-server"] = {
        command: "bun",
        args: [
          "run",
          `${process.env.GITHUB_ACTION_PATH}/src/mcp/github-file-ops-server.ts`,
        ],
        env: {
          GITHUB_TOKEN: githubToken || "",
          REPO_OWNER: context.repository.owner,
          REPO_NAME: context.repository.repo,
          BRANCH_NAME: "", // Agent mode doesn't pre-create branches
          BASE_BRANCH: "",
          REPO_DIR: process.env.GITHUB_WORKSPACE || process.cwd(),
          GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || "",
          IS_PR: "false", // Agent mode doesn't create PRs by default
          GITHUB_API_URL:
            process.env.GITHUB_API_URL || "https://api.github.com",
        },
      };
    }

    // Add user-provided additional MCP config if any
    const additionalMcpConfig = process.env.MCP_CONFIG || "";
    if (additionalMcpConfig.trim()) {
      try {
        const additional = JSON.parse(additionalMcpConfig);
        if (additional && typeof additional === "object") {
          // Merge mcpServers if both have them
          if (additional.mcpServers && mcpConfig.mcpServers) {
            Object.assign(mcpConfig.mcpServers, additional.mcpServers);
          } else {
            Object.assign(mcpConfig, additional);
          }
        }
      } catch (error) {
        core.warning(`Failed to parse additional MCP config: ${error}`);
      }
    }

    // Agent mode: pass through user's claude_args with MCP config and allowed_tools
    const userClaudeArgs = process.env.CLAUDE_ARGS || "";
    const userAllowedTools = process.env.ALLOWED_TOOLS || "";
    const escapedMcpConfig = JSON.stringify(mcpConfig).replace(/'/g, "'\\''");
    let claudeArgs = `--mcp-config '${escapedMcpConfig}'`;
    
    // Add allowed_tools if specified
    if (userAllowedTools) {
      claudeArgs += ` --allowedTools "${userAllowedTools}"`;
    }
    
    // Add user's additional claude_args
    if (userClaudeArgs) {
      claudeArgs += ` ${userClaudeArgs}`;
    }
    
    core.setOutput("claude_args", claudeArgs.trim());

    return {
      commentId: undefined,
      branchInfo: {
        baseBranch: "",
        currentBranch: "",
        claudeBranch: undefined,
      },
      mcpConfig: JSON.stringify(mcpConfig),
    };
  },

  generatePrompt(context: PreparedContext): string {
    // Agent mode uses prompt field
    if (context.prompt) {
      return context.prompt;
    }

    // Minimal fallback - repository is a string in PreparedContext
    return `Repository: ${context.repository}`;
  },

  getSystemPrompt() {
    // Agent mode doesn't need additional system prompts
    return undefined;
  },
};
