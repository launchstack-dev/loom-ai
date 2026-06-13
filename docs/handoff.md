# Handoff Message (copy-paste template)

This is the message I send each warm user. Edit the bracketed bits and the "ping me if" list for your relationship.

---

> Hey [Name] — handing you Loom. It's a discipline layer on top of Claude Code that turns loose AI prompts into locked scope contracts, drives convergence from Given/When/Then scenarios, and blocks bad tool calls at the hook level instead of trusting instructions.
>
> **Install** (one-liner, ~30 sec):
> ```
> curl -fsSL https://raw.githubusercontent.com/launchstack-dev/loom-ai/main/install.sh | bash
> ```
>
> **Then, in this order:**
> 1. Run `/loom-init` in a real project you have. Takes ~5 min, writes `CLAUDE.md`, `CONTEXT.md`, and `.loom/wiki/`. Read what it tells you it created.
> 2. Read `docs/concepts.md` (5 min). Five concepts, plain English. Don't skip it — you'll see these terms inside the next command.
> 3. Run `/loom-quick "<some small real task>"`. Walk through `docs/first-30-minutes.md` alongside it.
> 4. Want a cheat sheet for everything else? `docs/cheatsheet.md`.
>
> **If you'd rather see it working before installing**, the 90-second demo is in `docs/demo-script.md` (asciinema embed at the top of the README).
>
> **Ping me only if:**
> - Install fails after you tried it twice
> - You hit an error that isn't in `docs/troubleshooting.md`
> - You have a real product question (what would happen if…, can it do…, should I…)
>
> Everything else, the docs above are the answer. If they're not, that's a doc bug — tell me what you couldn't find and I'll patch it.

---

## Notes for me (Jensen)

- **Send to ONE warm user first.** Don't blast all at once. Whatever they ping about that isn't already in `troubleshooting.md` or `concepts.md` is a doc gap — patch it, then send to user #2.
- **The "ping me only if" list is load-bearing.** It sets the expectation that the docs are the first line, not me. Don't soften it.
- **Acceptance:** if user #2 and #3 onboard without pinging for the same thing user #1 hit, the kit works.
