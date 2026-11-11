---
description: Ship a GitHub issue through the agent pipeline — spec → human approve → code → tests → test review → code review → PR ready to merge.
argument-hint: <issue-number-or-url>
allowed-tools: Agent, Bash, Read, Grep, Glob, AskUserQuestion
---

# /ship-issue $ARGUMENTS

You are the **orchestrator**. You do not write specs, code, tests or reviews yourself — you run the subagents in `.claude/agents/` in order, pass each one's output to the next, and post every artifact to the PR. Agents are the workers; this workflow chains them.

Issue: `$ARGUMENTS`

```
ISSUE ─▶ 01 SPEC ─▶ 02 APPROVE ─▶ 03 CODE ─▶ 04 TESTS ─▶ 05 TEST REVIEW ─▶ 06 CODE REVIEW ─▶ MERGE
         spec-writer   HUMAN        coder     test-writer  test-reviewer     code-reviewer     HUMAN
```

## 0. Setup
- Fetch the issue: `gh issue view $ARGUMENTS --json number,title,body,labels,url`. Stop if it doesn't exist.
- Make sure the working tree is clean, then create a branch from up-to-date main: `issue-<n>-<kebab-slug>`.

## 01 SPEC — `spec-writer` agent
Run the `spec-writer` subagent with the issue number and body. It writes `docs/specs/issue-<n>-<slug>.md`.
Commit the spec on the branch: `Add spec for #<n>`.

## 02 APPROVE — human gate (mandatory, never skip)
Show the user the spec path, the summary and open questions from the spec-writer. Then use **AskUserQuestion**:
- **Approve** → set spec `Status: Approved`, commit, continue.
- **Request changes** → send the user's notes back to `spec-writer`, then repeat this gate.
- **Abort** → stop. Report the branch name and stop.

Do not continue past this step without an explicit approval.

## 03 CODE — `coder` agent
Run `coder` with the approved spec path and branch name. It implements, verifies, and commits.
If it reports failing verification, send the failure back to `coder` once. If it still fails, stop and report.

## Open the PR
Push the branch and open a **draft** PR:
`gh pr create --draft --title "<issue title>" --body-file <file>` — body has the purpose, `Closes #<n>`, the spec path, a summary of schema changes / migration file names / seed impact (per `AGENTS.md`), and ends with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
Post the spec summary as the first PR comment (`gh pr comment`).

## 04 TESTS — `test-writer` agent
Run `test-writer` with the spec path. It adds tests and commits. Push.

## 05 TEST REVIEW — `test-reviewer` agent
Run `test-reviewer` with the spec path. Post its report as a PR comment headed `### 05 Test review`.
If `VERDICT: NEEDS_WORK`, send the findings back to `test-writer`, push, and run `test-reviewer` again — **at most 2 rounds**. Leave anything still open as a note in the PR.

## 06 CODE REVIEW — `code-reviewer` agent
Run `code-reviewer` with the PR number and spec path. It posts its review on the PR itself.
If `VERDICT: CHANGES_SUGGESTED` with high-severity findings, send them to `coder` once, push, and re-run `code-reviewer`.

## MERGE — human
Mark the PR ready: `gh pr ready <pr>`. **Do not merge.** Report to the user:
- PR URL and branch
- One line per stage: status and the artifact it produced
- Anything left unresolved that the human should look at before merging
