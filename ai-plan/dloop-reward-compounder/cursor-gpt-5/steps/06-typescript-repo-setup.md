Goal: Prepare a TypeScript repo with yarn, ts-node, jest, eslint, and Docker (multi-stage).

Deliverables
- In `bot-typescript/`:
  - `src/`, `test/`, `config/networks/`
  - `package.json` (scripts: lint, test, build, run)
  - `tsconfig.json`
  - `eslint.config.mjs` (align with `bot/dlend-liquidator/eslint.config.mjs` conventions)
  - `jest.config.js`
  - `Dockerfile` (multi-stage)
  - `.yarnrc.yml`, `.yarn/`, `.env.example`, `Makefile`, `README.md`

Scripts
- `make lint` → eslint
- `make test` → jest
- `make run network=<network>` → ts-node `src/runner.ts --network $network`
- `make docker.build.arm64` / `amd64`
- `make docker.run network=<network>`

Acceptance
- `yarn typecheck` clean; lint/test scripts run.
- Docker builds locally without external network fetch at runtime.

Quick check
- Ensure no references to root repo packages; all deps local.
