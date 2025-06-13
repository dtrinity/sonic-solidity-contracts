# RECURRING - DO NOT DELETE

Please audit the smart contracts in the provided directory. Think like a professional smart contract auditor. Embody OpenZeppelin's best practices and recommendations. Consider code vulnerabilities, economic attack vectors, counterparty risk, and edge cases.

Helpful resources:
- `reports/mythril_summary.md`
- `reports/slither-summary.md`

Before you start:
1. Create a scope tree that lists all the contracts in scope, and check them off as you go. 
   1. If we haven't started on it yet, mark it with ⏳
   2. If there is an issue, mark it with an ❌
   3. If nothing was discovered ✅
   4. If additional consideration is needed ❓
2. Double check the scope tree against what's out of scope and what other files are in the directories.
3. Create placeholders for each product and contract in scope which will be filled out as you go.
4. Don't be afraid to modify the audit format based on findings if needed.

When you audit a contract, please do the following:
1. Seek to gain a full understanding of what the contract's purpose is.
   1. Sometimes there are markdown files which describe the design of the contract ecosystem, reading it will give you a high level overview and is a good place to start.
2. Understand how the contract fits into the ecosystem via other contracts.
3. Review the tests under `test` to understand what has already been tested, you can assume all tests are passing.
4. Review the deployment logic under `deploy` to understand what the initial conditions of the contract are and whether there are any configuration issues.
   1. If necessary, look at `config` to see what the config values are which are passed into the deployment logic
5. Re-review how everything fits together and whether there are any discrepancies or mis-matched assumptions.

When you finish with all contracts in scope:
1. Generate the summary table
2. Review the scope tree, check it against the real directory structure to make sure we didn't miss anything

Please iteratively generate an audit report. Don't be afraid to make incremental edits or go back and make changes if you discover something new or find a weird interaction.

The audit report format should be:

```
# Scope
- A tree of files in scope, with emojis to indicate their health/status
## <Each product gets its own section>
- Describe the threat model for the product
- Describe how the different contracts interact with each other
### <Each contract of the product gets its own section>
- Provide an overview of the contract
#### <For finding has its own section>
- Provide a description of the issue with the affected code snippet
- Use STRIDE for threat modeling.
- Consult the SWC Registry for common issues.
- Provide steps to reproduce or pull off the attack if relevant.
- Recommend remediation approaches based on best practices.
# Summary table of issues
- A table that lists all the issues, their severity, and the estimated complexity of fix
```