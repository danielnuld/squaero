# AGENTS.md

Directives for any agent (human or AI) working on **Squaero**. Read this before touching code.

## Directives

Adhere to the rules in the [rules directory](./.rules/):

- [General Rules](./.rules/general.md) — language, tooling, architecture invariants
- [C Core Rules](./.rules/c-core.md) — module structure and conventions for `libdbcore`
- [Driver Rules](./.rules/drivers.md) — building database driver plugins
- [Frontend Rules](./.rules/frontend.md) — the webview UI
- [IPC Rules](./.rules/ipc.md) — the core ↔ frontend contract
- [Testing Conventions](./.rules/testing.md) — test layout and coverage
- [Git Rules](./.rules/git.md) — commits, branches, PRs

## The development line (follow on every change)

This is the single, consistent workflow for all work on Squaero. The
[`quaero-feature`](./.claude/skills/quaero-feature/SKILL.md) skill expands it.

1. **Understand first.** Use CodeGraph (`codegraph_*`) to locate symbols and
   assess impact *before* editing. Report HIGH/CRITICAL blast radius to the user.
2. **Respect the layers.** The C core never imports UI. Drivers only touch the
   vtable. The frontend only talks to the core via the IPC contract.
3. **Extract pure logic.** Parsers, SQL builders, identifier quoting, value
   conversion and pagination live in small, focused, testable modules.
4. **Test everything.** Every pure helper and exported function gets unit tests
   (nominal, edge, unsupported). No change is "done" until tests pass.
5. **Build + test before finishing.** Core: `ctest`. Frontend: `pnpm test`.
6. **Honest capabilities.** Never fake success for an unsupported operation —
   return an explicit error.
7. **Commit cleanly.** Conventional Commits, English, referencing the issue.
   **Never** add a `Co-Authored-By` trailer or any Claude/AI attribution.

## Skills and agents

| Need | Use |
|------|-----|
| Implement any feature/issue end-to-end | skill `quaero-feature` |
| Build or extend a database driver | skill `quaero-driver` / agent `driver-builder` |
| Review a diff against the rules | agent `quaero-reviewer` |

## CodeGraph — code intelligence

This project is meant to be indexed by CodeGraph. Prefer it over grep for
structural questions (who calls what, blast radius, where a symbol is defined).
If `.codegraph/` does not exist yet, run `codegraph init -i` to build the index.
Do not re-verify CodeGraph results with grep.
