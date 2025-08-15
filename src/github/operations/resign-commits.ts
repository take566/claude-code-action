import type { Octokits } from "../api/client";
import type { GitHubContext } from "../context";
import { $ } from "bun";

interface CommitInfo {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  files: string[];
}

/**
 * Get all commits made by claude[bot] on the current branch that aren't on the base branch
 */
async function getClaudeCommits(baseBranch: string): Promise<CommitInfo[]> {
  try {
    // Get commits that are on current branch but not on base branch
    const output =
      await $`git log ${baseBranch}..HEAD --pretty=format:"%H|%an|%ae|%aI|%B%x00" --name-only`.quiet();
    const rawCommits = output.stdout
      .toString()
      .trim()
      .split("\x00")
      .filter((c) => c);

    const commits: CommitInfo[] = [];

    for (const rawCommit of rawCommits) {
      const lines = rawCommit.trim().split("\n");
      if (lines.length === 0) continue;

      const firstLine = lines[0];
      if (!firstLine) continue;

      const parts = firstLine.split("|");
      if (parts.length < 4) continue;

      const [sha, authorName, authorEmail, date, ...rest] = parts;

      // Find where the file list starts (after empty line)
      let messageEndIndex = rest.findIndex((line) => line === "");
      if (messageEndIndex === -1) messageEndIndex = rest.length;

      const message = rest.slice(0, messageEndIndex).join("\n");
      const files = rest.slice(messageEndIndex + 1).filter((f) => f);

      // Only include commits by claude[bot]
      if (
        authorName &&
        authorEmail &&
        (authorName === "claude[bot]" || authorEmail.includes("claude"))
      ) {
        commits.push({
          sha: sha || "",
          message,
          author: {
            name: authorName,
            email: authorEmail,
            date: date || new Date().toISOString(),
          },
          files,
        });
      }
    }

    return commits.reverse(); // Return in chronological order
  } catch (error) {
    console.error("Error getting Claude commits:", error);
    return [];
  }
}

/**
 * Re-create commits using GitHub API to get them signed
 */
export async function resignCommits(
  branch: string,
  baseBranch: string,
  client: Octokits,
  context: GitHubContext,
): Promise<boolean> {
  try {
    console.log(
      `Checking for unsigned commits by Claude on branch ${branch}...`,
    );

    // Get all commits made by Claude
    const claudeCommits = await getClaudeCommits(baseBranch);

    if (claudeCommits.length === 0) {
      console.log("No commits by Claude found to re-sign");
      return false;
    }

    console.log(`Found ${claudeCommits.length} commits by Claude to re-sign`);

    // Get the base commit (last commit before Claude's commits)
    const baseCommitOutput = await $`git rev-parse ${baseBranch}`.quiet();
    const baseCommitSha = baseCommitOutput.stdout.toString().trim();

    // Create a mapping of old SHA to new SHA
    const shaMapping = new Map<string, string>();
    let currentParentSha = baseCommitSha;

    for (const commit of claudeCommits) {
      console.log(
        `Re-signing commit: ${commit.sha.substring(0, 7)} - ${commit.message.split("\n")[0]}`,
      );

      // Get the tree SHA for this commit
      const treeOutput = await $`git rev-parse ${commit.sha}^{tree}`.quiet();
      const treeSha = treeOutput.stdout.toString().trim();

      // Create the commit via API (which will sign it)
      const { data: newCommit } = await client.rest.git.createCommit({
        owner: context.repository.owner,
        repo: context.repository.repo,
        message: commit.message,
        tree: treeSha,
        parents: [currentParentSha],
        author: {
          name: commit.author.name,
          email: commit.author.email,
          date: commit.author.date,
        },
      });

      console.log(`  Created signed commit: ${newCommit.sha.substring(0, 7)}`);
      shaMapping.set(commit.sha, newCommit.sha);
      currentParentSha = newCommit.sha;
    }

    // Update the branch to point to the new commit
    console.log(`Updating branch ${branch} to point to signed commits...`);
    await client.rest.git.updateRef({
      owner: context.repository.owner,
      repo: context.repository.repo,
      ref: `heads/${branch}`,
      sha: currentParentSha,
      force: true,
    });

    // Pull the updated branch locally
    console.log("Pulling signed commits locally...");
    await $`git fetch origin ${branch}`;
    await $`git reset --hard origin/${branch}`;

    console.log(`✅ Successfully re-signed ${claudeCommits.length} commits`);
    return true;
  } catch (error) {
    console.error("Error re-signing commits:", error);
    // Don't fail the action if we can't re-sign
    return false;
  }
}
