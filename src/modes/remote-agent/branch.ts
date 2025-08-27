/**
 * Branch handling for remote-agent mode with resume support
 */

import { $ } from "bun";
import * as core from "@actions/core";
import type { GitHubContext } from "../../github/context";
import type { Octokits } from "../../github/api/client";
import type { ResumeResponse, ResumeResult } from "../../types/resume";
import {
  setupBranch as setupBaseBranch,
  type BranchInfo,
} from "../../github/operations/branch";

export type RemoteBranchInfo = BranchInfo & {
  resumeMessages?: ResumeResult["messages"];
};

/**
 * Attempts to resume from an existing session using the resume endpoint
 * @param resumeEndpoint The URL to fetch the resume data from
 * @param headers Headers to include in the request (including auth)
 * @returns ResumeResult if successful, null otherwise
 */
async function fetchResumeData(
  resumeEndpoint: string,
  headers?: Record<string, string>,
): Promise<ResumeResult | null> {
  try {
    console.log(`Attempting to resume from: ${resumeEndpoint}`);

    const response = await fetch(resumeEndpoint, {
      method: "GET",
      headers: headers || {},
    });

    if (!response.ok) {
      console.log(
        `Resume endpoint returned ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data = (await response.json()) as ResumeResponse;

    if (!data.log || !Array.isArray(data.log)) {
      console.log("Resume endpoint returned invalid data structure");
      return null;
    }

    console.log(
      `Successfully fetched resume data with ${data.log.length} messages`,
    );

    // If a branch is specified in the response, we'll use it
    // Otherwise, we'll determine the branch from the current git state
    const branchName = data.branch || "";

    return {
      messages: data.log,
      branchName,
    };
  } catch (error) {
    console.error("Failed to fetch resume data:", error);
    return null;
  }
}

/**
 * Setup branch for remote-agent mode with resume support
 * @param octokits GitHub API clients
 * @param context GitHub context
 * @param oidcToken OIDC token for authentication
 * @returns Branch information with optional resume messages
 */
export async function setupBranchWithResume(
  octokits: Octokits,
  context: GitHubContext,
  oidcToken: string,
): Promise<RemoteBranchInfo> {
  const { owner, repo } = context.repository;
  const { baseBranch } = context.inputs;

  // Check if we have a resume endpoint
  if (context.progressTracking?.resumeEndpoint) {
    console.log("Resume endpoint detected, attempting to resume session...");

    // Prepare headers with OIDC token
    const headers: Record<string, string> = {
      ...(context.progressTracking.headers || {}),
      Authorization: `Bearer ${oidcToken}`,
    };

    const resumeData = await fetchResumeData(
      context.progressTracking.resumeEndpoint,
      headers,
    );

    if (resumeData && resumeData.branchName) {
      // Try to checkout the resumed branch
      try {
        console.log(`Resuming on branch: ${resumeData.branchName}`);

        // Fetch the branch from origin
        await $`git fetch origin ${resumeData.branchName}`;

        // Checkout the branch
        await $`git checkout ${resumeData.branchName}`;

        console.log(`Successfully resumed on branch: ${resumeData.branchName}`);

        // Get the base branch for this branch (we'll use the default branch as fallback)
        let resumeBaseBranch = baseBranch;
        if (!resumeBaseBranch) {
          const repoResponse = await octokits.rest.repos.get({
            owner,
            repo,
          });
          resumeBaseBranch = repoResponse.data.default_branch;
        }

        // Set outputs for GitHub Actions
        core.setOutput("CLAUDE_BRANCH", resumeData.branchName);
        core.setOutput("BASE_BRANCH", resumeBaseBranch);

        return {
          baseBranch: resumeBaseBranch,
          claudeBranch: resumeData.branchName,
          currentBranch: resumeData.branchName,
          resumeMessages: resumeData.messages,
        };
      } catch (error) {
        console.error(
          `Failed to checkout resumed branch ${resumeData.branchName}:`,
          error,
        );
        console.log("Falling back to creating a new branch...");
        // Fall through to normal branch creation
      }
    } else if (resumeData) {
      console.log(
        "Resume data fetched but no branch specified, will create new branch",
      );
      // We have messages but no branch, so we'll create a new branch
      // but still pass along the messages
      const branchInfo = await setupBaseBranch(octokits, null, context);
      return {
        ...branchInfo,
        resumeMessages: resumeData.messages,
      };
    }
  }

  // No resume endpoint or resume failed, use normal branch setup
  console.log("No resume endpoint or resume failed, creating new branch...");
  return setupBaseBranch(octokits, null, context);
}
