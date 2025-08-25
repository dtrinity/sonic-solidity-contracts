Goal: Finalize Docker multi-stage build and Makefiles for smooth dev/CI.

Dockerfile
- Multi-stage: builder (install deps, build), runner (copy dist + node_modules runtime subset).
- Reference: `ai-promt/dloop-reward-compounder/bot-typescript/bot.Dockerfile`.
- Entrypoint: `node dist/runner.js --network $NETWORK`.

Makefiles
- Solidity: compile, lint, test, deploy targets.
- TypeScript: lint, test, run, docker.build.arm64/amd64, docker.run.

Acceptance
- Local docker build succeeds; container runs `--help`.

