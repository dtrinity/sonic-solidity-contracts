Goal: Create the bot parent repo and initialize git for both sub-repos, ensuring independence from the root project.

Deliverables
- Directory: `bot/dloop-reward-compounder/`
- Subdirectories: `bot-solidity-contracts/`, `bot-typescript/`
- Git initialized at `bot/dloop-reward-compounder/` (single repo tracking both subfolders)

Actions
- mkdir: `bot/dloop-reward-compounder/{bot-solidity-contracts,bot-typescript}`
- run: `cd bot/dloop-reward-compounder && git init`
- add base `.gitignore` suitable for Node/Hardhat and Yarn PnP (copy patterns from root repo where relevant)

Acceptance
- `git status` shows a clean repo.
- The folder can be moved out of root and remain self-contained.

Quick check
- Move the folder (dry-run/thought-experiment) to a temp directory; ensure no relative imports to `./` root.
