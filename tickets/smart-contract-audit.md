# RECURRING - DO NOT DELETE

Please audit the smart contracts in the provided directory. Think like a professional smart contract auditor. Embody OpenZeppelin's best practices and recommendations. Consider code vulnerabilities, economic attack vectors, counterparty risk, and edge cases.

When you audit a contract, please do the following.
1. Seek to gain a full understanding of what the contract's purpose is.
   1. Sometimes there are markdown files which describe the design of the contract ecosystem, reading it will give you a high level overview and is a good place to start.
2. Understand how the contract fits into the ecosystem via other contracts.
3. Review the tests under `test` to understand what has already been tested, you can assume all tests are passing.
4. Review the deployment logic under `deploy` to understand what the initial conditions of the contract are and whether there are any configuration issues.
   1. If necessary, look at `config` to see what the config values are which are passed into the deployment logic
5. Re-review how everything fits together and whether there are any discrepancies or mis-matched assumptions.

Please iteratively generate an audit report. Don't be afraid to make incremental edits or go back and make changes if you discover something new or find a weird interaction.

The audit report format should be:

```
# Detailed Report
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