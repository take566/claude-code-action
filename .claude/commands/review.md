---
allowed-tools: Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh pr comment:*), Bash(gh api:*), Read, Glob, Grep
description: Review the current PR in GitHub Actions
---

Review PR #${{ github.event.pull_request.number }} and post a comment with your findings.

## Steps

1. Get the PR details to understand context:
   ```bash
   gh pr view ${{ github.event.pull_request.number }} --repo ${{ github.repository }} --json title,body,author,state,isDraft,files,baseRefName,headRefName
   ```

2. Get the diff to see what changed:
   ```bash
   gh pr diff ${{ github.event.pull_request.number }} --repo ${{ github.repository }}
   ```

3. Review the changes focusing on:
   - Code quality and best practices
   - Potential bugs or security issues
   - Performance concerns
   - Missing tests or documentation
   - Consistency with existing codebase

4. Write your review to a file, then post it:
   ```bash
   cat > /tmp/pr-review.md << 'EOF'
   ## Code Review
   
   [Your review here - be specific and constructive]
   
   🤖 Generated with [Claude Code](https://claude.ai/code)
   EOF
   
   gh pr comment ${{ github.event.pull_request.number }} --repo ${{ github.repository }} --body-file /tmp/pr-review.md
   ```

## Important
- Be constructive and specific
- Reference specific files and line numbers when pointing out issues
- Acknowledge what's done well
- Provide actionable suggestions for improvements