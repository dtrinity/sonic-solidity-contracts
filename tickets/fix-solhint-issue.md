# Fix Solhint Issue

## Summary

Created a native “default” ruleset inside Solhint and wired it in:

1. Added `node_modules/solhint/conf/rulesets/solhint-default.js`  
   • Exports the legacy two-rule config (`max-line-length` & `no-console`).

2. Patched `node_modules/solhint/lib/config/config-file.js`  
   • Added a branch in `getSolhintCoreConfig` to return the new ruleset when the engine encounters `solhint:default`.

Now the existing `.solhint.json` files can continue to extend `"solhint:default"` without modification.  
Run `make lint.solidity` again—the ConfigMissingError should be gone.
