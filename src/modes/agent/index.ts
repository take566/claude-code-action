import * as core from "@actions/core";
import { mkdir, writeFile } from "fs/promises";
import type { Mode, ModeOptions, ModeResult } from "../types";
import type { PreparedContext } from "../../create-prompt/types";
import { GITHUB_API_URL, GITHUB_SERVER_URL } from "../../github/api/config";
import { fetchGitHubData } from "../../github/data/fetcher";
import { 
  formatContext, 
  formatBody, 
  formatComments,
  formatReviewComments,
  formatChangedFilesWithSHA 
} from "../../github/data/formatter";
import { isEntityContext } from "../../github/context";

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

  async prepare({ context, githubToken, octokit }: ModeOptions): Promise<ModeResult> {
    // Agent mode handles automation events and any event with explicit prompts
    
    console.log(`Agent mode: githubToken provided: ${!!githubToken}, length: ${githubToken?.length || 0}`);

    // Create prompt directory
    await mkdir(`${process.env.RUNNER_TEMP}/claude-prompts`, {
      recursive: true,
    });
    
    // Fetch GitHub context data if we're in an entity context (PR/issue)
    let githubContextPrefix = '';
    if (isEntityContext(context)) {
      try {
        const githubData = await fetchGitHubData({
          octokits: octokit,
          repository: `${context.repository.owner}/${context.repository.repo}`,
          prNumber: context.entityNumber.toString(),
          isPR: context.isPR,
          triggerUsername: context.actor,
        });
        
        // Format the GitHub data into a readable context
        const formattedContext = formatContext(githubData.contextData, context.isPR);
        const formattedBody = githubData.contextData?.body 
          ? formatBody(githubData.contextData.body, githubData.imageUrlMap)
          : "No description provided";
        const formattedComments = formatComments(githubData.comments, githubData.imageUrlMap);
        
        // Build the context prefix
        githubContextPrefix = `## GitHub Context

${formattedContext}

### Description
${formattedBody}`;
        
        if (formattedComments && formattedComments.trim()) {
          githubContextPrefix += `\n\n### Comments\n${formattedComments}`;
        }
        
        if (context.isPR && githubData.changedFilesWithSHA) {
          const formattedFiles = formatChangedFilesWithSHA(githubData.changedFilesWithSHA);
          githubContextPrefix += `\n\n### Changed Files\n${formattedFiles}`;
        }
        
        githubContextPrefix += '\n\n## Your Task\n\n';
      } catch (error) {
        console.warn('Failed to fetch GitHub context:', error);
        // Continue without GitHub context if fetching fails
      }
    }
    
    // Write the prompt file with GitHub context prefix
    const userPrompt = context.inputs.prompt || 
      `Repository: ${context.repository.owner}/${context.repository.repo}`;
    const promptContent = githubContextPrefix + userPrompt;
    
    await writeFile(
      `${process.env.RUNNER_TEMP}/claude-prompts/claude-prompt.txt`,
      promptContent,
    );

    // Agent mode: User has full control via claudeArgs
    // No default tools are enforced - Claude Code's defaults will apply

    // Include both GitHub comment server and main GitHub MCP server by default
    // This ensures comprehensive GitHub tools work out of the box
    const mcpConfig: any = {
      mcpServers: {
        // GitHub comment server for updating Claude comments
        github_comment: {
          command: "bun",
          args: [
            "run",
            `${process.env.GITHUB_ACTION_PATH}/src/mcp/github-comment-server.ts`,
          ],
          env: {
            GITHUB_TOKEN: githubToken || "",
            REPO_OWNER: context.repository.owner,
            REPO_NAME: context.repository.repo,
            CLAUDE_COMMENT_ID: process.env.CLAUDE_COMMENT_ID || "",
            PR_NUMBER: (context as any).entityNumber?.toString() || process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER || "",
            ISSUE_NUMBER: (context as any).entityNumber?.toString() || "",
            GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || "",
            GITHUB_API_URL:
              process.env.GITHUB_API_URL || "https://api.github.com",
          },
        },
        // Main GitHub MCP server for comprehensive GitHub operations
        github: {
          command: "docker",
          args: [
            "run",
            "-i",
            "--rm",
            "-e",
            "GITHUB_PERSONAL_ACCESS_TOKEN",
            "-e",
            "GITHUB_HOST",
            "ghcr.io/github/github-mcp-server:sha-efef8ae", // https://github.com/github/github-mcp-server/releases/tag/v0.9.0
          ],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: githubToken || "",
            GITHUB_HOST: GITHUB_SERVER_URL,
          },
        },
      },
    };
    
    // Include inline comment server for PR contexts
    if (context.eventName === "pull_request" || context.eventName === "pull_request_review") {
      // Get PR number from the context payload
      const prNumber = (context as any).payload?.pull_request?.number || 
                      (context as any).entityNumber || 
                      "";
      
      mcpConfig.mcpServers.github_inline_comment = {
        command: "bun",
        args: [
          "run",
          `${process.env.GITHUB_ACTION_PATH}/src/mcp/github-inline-comment-server.ts`,
        ],
        env: {
          GITHUB_TOKEN: githubToken || "",
          REPO_OWNER: context.repository.owner,
          REPO_NAME: context.repository.repo,
          PR_NUMBER: prNumber.toString(),
          GITHUB_API_URL: process.env.GITHUB_API_URL || "https://api.github.com",
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

    // Agent mode: pass through user's claude_args with MCP config
    const userClaudeArgs = process.env.CLAUDE_ARGS || "";
    const escapedMcpConfig = JSON.stringify(mcpConfig).replace(/'/g, "'\\''");
    const claudeArgs =
      `--mcp-config '${escapedMcpConfig}' ${userClaudeArgs}`.trim();
    core.setOutput("claude_args", claudeArgs);

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
