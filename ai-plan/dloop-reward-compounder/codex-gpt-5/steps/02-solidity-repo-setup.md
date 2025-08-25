Goal: Prepare a Hardhat-only Solidity repo mirroring root repo conventions without cross-dependency.

Deliverables
- In `bot-solidity-contracts/`:
  - `contracts/`, `test/`, `deploy/`, `config/networks/`
  - `hardhat.config.ts` (copy/trim from root; set paths to local subrepo)
  - `package.json` (hardhat, ts-node, types, ethers, chai, ts-jest)
  - `tsconfig.json`, `jest.config.ts`
  - `.solhint.json`, `.solhintignore` (match root lint rules)
  - `.yarnrc.yml`, `.yarn/` (PnP consistent with root)
  - `.env.example` (RPC, keys — but addresses in code configs not env)
  - `Makefile` with targets: compile, lint, test, deploy-contracts.*
  - `README.md` (usage, structure, scripts)

Actions
- Replicate minimal configs from root repo; adjust import paths to be local.
- Configure solhint scripts in `package.json` and `Makefile`.
- Ensure Jest runs Hardhat tests (ts-jest with `node` env).

Acceptance
- `make compile` compiles empty contracts dir.
- `make lint` runs solhint successfully.
- `make test` runs a sample placeholder test.

Quick check
- Open `hardhat.config.ts` and confirm paths resolve within subrepo.

