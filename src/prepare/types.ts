import type { ParsedGitHubContext } from "../github/context";
import type { Octokits } from "../github/api/client";
import type { Mode } from "../modes/types";

export type PrepareResult = {
  commentId?: number;
  branchInfo: {
    baseBranch: string;
    claudeBranch?: string;
    currentBranch: string;
  };
  mcpConfig: string;
};

export type PrepareOptions = {
  context: ParsedGitHubContext;
  octokit: Octokits;
  mode: Mode;
  githubToken: string;
};
