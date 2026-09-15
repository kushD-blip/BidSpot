# BidSpot agent team

Five specialised agents defined in this directory. Each one has a narrow job,
concrete deliverables, and — most importantly — a written trail so Kushagra can
read what they did without opening a chat window.

## The five

| Agent | Cadence | Deliverable | Where |
|-------|---------|-------------|-------|
| `product-lead` | Weekly | Status file with numbers, decisions needed | `product-notes/` |
| `systems-engineer` | On every payment/auth change | GitHub issues + security-fix PRs | `security` label |
| `marketing-lead` | Every 1-2 days | 3 pitch briefs + summary issue | `marketing-notes/`, `outreach` label |
| `bug-fixer` | Continuous | Small PRs closing bug issues + daily log | `bug-log/`, `bug` label |
| `content-lead` | Weekly + on ship | LinkedIn drafts, launch write-ups, copy PRs | `content-drafts/`, small copy PRs |

## How Kushagra sees their work

- **Files in the repo** (`product-notes/`, `marketing-notes/`, `bug-log/`,
  `content-drafts/`) — durable, reviewable, greppable.
- **GitHub issues** with labels (`security`, `outreach`, `bug`) — sorted queue
  when he opens the repo each morning.
- **Small PRs** — the code changes are always PRs, never direct pushes to
  `main`. Kushagra approves the merge.

No DMs, no email, no Slack. The repo IS the coordination channel.

## Invoking one from Claude Code

```
> use the marketing-lead agent to find three candidates today
> systems-engineer, review the diff on the current branch
> product-lead, write this week's status
```

## Rules that apply to all five

- **Never fabricate.** If a number can't be verified, mark it `<VERIFY>` or
  say "unknown". This is the same rule the codebase already applies to live
  visitor counts and bid volumes — the agents inherit it.
- **Never touch payment or auth code without pinging `systems-engineer`.**
- **Never bypass hooks or force-push.** If a hook fails, the fix is in the
  hook or in the code, not the flag `--no-verify`.
- **Every agent's output includes the git SHA it was based on.** So a note
  from Monday can be traced to exactly what was on `main` when it was
  written, and stale notes are obvious.
