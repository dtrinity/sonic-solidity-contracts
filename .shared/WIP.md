# Ticket: Harden shared-hardhat-tools for network-wide reuse
# Summary
Shared toolkit needs cleanup before production adoption: missing entrypoints referenced by package scripts, reliance on dev-only tooling, and invasive defaults in hooks/setup workflows will block or surprise downstream repos.

# Acceptance Criteria
- Package scripts run without missing files; lint/guardrail commands either exist or are removed.
- Runtime dependencies (ts-node/typescript or compiled JS) are available when consumed via subtree install.
- Setup, subtree, CI, and hook workflows are non-destructive by default, respect minimal integration guidance, and avoid leaving behind artifacts.
- Security/analysis scripts clean up any temporary files they create.

# Tasks
- [x] Implement `scripts/linting/{eslint,prettier,run-all}.ts` and `scripts/guardrails/check.ts`, or drop the corresponding npm scripts if redundant (`package.json:11-16`).
- [x] Decide on distribution format: compile TS to JS (update `main`/`types`, publish `dist/`) **or** promote `ts-node` + `typescript` to regular dependencies and adjust docs. Ensure consuming repos don’t need extra installs. *(Promoted ts-node/typescript to runtime deps; clarified docs about bundled CLI.)*
- [x] Update all docs/scripts/hooks to call the chosen runtime command (e.g. `node dist/...` or bundled CLI) instead of assuming `ts-node`. *(Standardized on local `node_modules/.bin/ts-node` invocations and documented the expectation.)*
- [x] Tame `scripts/setup.ts`: make `--hooks/--configs/--ci` opt-in, default to no action, and avoid mutating project `package.json` unless explicitly requested. *(Refactored setup into a preflight-driven flow that enforces the shared script baseline, adds opt-in phase flags, and surfaces manual follow-ups instead of overwriting customizations.)*
- [x] Rewrite git hooks to handle directories correctly (`hooks/pre-commit:24`), drop references to missing files (e.g. `.shared/scripts/testing/run-tests.ts`), and make compile/test steps opt-in or guarded. *(Hooks now shell out through shared guardrails with robust path handling, optional compile/test gates via env vars, and no references to missing scripts.)*
- [x] Ensure analysis scripts write configs to temporary locations and clean them up (`scripts/analysis/slither.ts`). *(Slither now writes shared configs to mkdtemp directories and removes them after execution.)*
- [ ] Make subtree helpers non-interactive and side-effect free by default (no prompts, no auto `npm install`, no hook copying). Provide flags for destructive actions.
- [ ] Harden `ci/shared-guardrails.yml`: install required tooling, ensure `reports/` directory exists, and gate steps on tool availability.
- [ ] Add basic test coverage or linting to this repo (e.g. `npm run test` stub) so changes can be validated before publishing.
- [ ] Migrate guardrail scripts and utilities shared across repos (e.g. `scripts/analysis/find-hardcoded-deploy-ids.ts`, deployment helpers) into this package with coverage.
- [ ] Flesh out integration docs with end-to-end subtree add/update instructions, CI wiring guidance, and a lightweight release cadence for propagating changes downstream.
- [ ] Define and document a multi-repo validation flow (e.g. super-monorepo or scripted check) to confirm guardrails run consistently before promoting updates.

# Notes
- Keep integration docs aligned with the new behavior (INTEGRATION.md, README).
- Slither installer + presets now live in `scripts/analysis/slither.ts` and `scripts/analysis/install-slither.ts`; migrate downstream Makefiles to use them instead of raw CLI invocations.
- Once stabilized, tag a `v1.0.0` release and update downstream repos’ subtrees.
