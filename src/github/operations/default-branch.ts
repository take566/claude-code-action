import type { Octokit } from "@octokit/rest";

export async function getDefaultBranch(
  rest: Octokit,
  owner: string,
  repo: string,
): Promise<string> {
  const repoResponse = await rest.repos.get({
    owner,
    repo,
  });
  return repoResponse.data.default_branch;
}
