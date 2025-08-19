---
description: Fix CI failures and commit changes (for use when branch already exists)
allowed_tools: "*"
---

# Fix CI Failures and Commit

You are on a branch that was created to fix CI failures. Your task is to fix the issues and commit the changes.

## CI Failure Information

$ARGUMENTS

## Your Tasks

1. **Analyze the failures** - Understand what went wrong from the logs
2. **Fix the issues** - Make the necessary code changes
3. **Commit your fixes** - Use git to commit all changes

## Step-by-Step Instructions

### 1. Fix the Issues

Based on the error logs:
- Fix syntax errors
- Fix formatting issues  
- Fix test failures
- Fix any other CI problems

### 2. Commit Your Changes (REQUIRED)

After fixing ALL issues, you MUST:

```bash
# Stage all changes
git add -A

# Commit with descriptive message
git commit -m "Fix CI failures

- Fixed syntax errors
- Fixed formatting issues  
- Fixed test failures
[List actual fixes made]"
```

**IMPORTANT**: You MUST use the Bash tool to run the git add and git commit commands above. The workflow expects you to commit your changes.

### 3. Verify (Optional)

If possible, run verification commands:
- `bun run format:check` for formatting
- `bun test` for tests
- `bun run typecheck` for TypeScript

Begin by analyzing the failure logs and then fix the issues.