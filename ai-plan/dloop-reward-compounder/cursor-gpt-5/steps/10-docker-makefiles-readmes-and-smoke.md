Goal: Add Dockerfiles, Makefiles, READMEs and final smoke checks.

Deliverables
- Solidity subrepo: `Makefile`, README with compile/lint/test/deploy instructions.
- TypeScript subrepo: multi-stage Dockerfile, Makefile, README with run/test instructions.

Smoke
- Build TypeScript Docker image for both arm64 and amd64.
- Run `make run network=sonic_testnet` against mocks.
- Confirm no cross-repo path leaks; everything self-contained.
