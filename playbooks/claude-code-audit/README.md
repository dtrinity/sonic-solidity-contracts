# Smart Contract Audit Playbook (AI-Optimized)

Fast, systematic security audit framework for AI agents. Optimized for parallel execution and minimal context usage.

## ⚡ Quick Start (90 mins total)

1. **Setup** (5 mins): Check `reports/` for existing findings first
2. **Parallel Audits** (45 mins): Deploy 4-6 agents using templates in `06-agent-task-templates.md`
3. **Analysis** (30 mins): Cross-module and economic analysis
4. **Report** (10 mins): Consolidate findings

## 📚 Essential Documents

### For AI Agents
- **[AI-AGENT-GUIDE.md](AI-AGENT-GUIDE.md)** - Step-by-step execution guide
- **[06-agent-task-templates.md](06-agent-task-templates.md)** - Copy-paste templates for sub-agents

### Reference
- **[02-vulnerability-catalog.md](02-vulnerability-catalog.md)** - What to look for
- **[04-audit-scope.md](04-audit-scope.md)** - What to audit
- **[design-docs/](design-docs/)** - Module-specific context

## 🎯 Parallel Execution Strategy

```bash
# 1. Check existing findings
ls -la reports/

# 2. Deploy agents (see 06-agent-task-templates.md)
- Module audits: dStable, dStake, dLoop, dPool, Oracle
- Cross-module analysis
- Economic attack modeling

# 3. Consolidate findings
cat audit-workspace/*-findings.md | sort by severity
```

## 🚨 Known Critical Areas

1. **Oracle Manipulation** - Affects ALL modules
2. **Admin Centralization** - No timelocks
3. **Cross-Module Cascades** - Liquidation chains
4. **dStake Withdrawal** - Check if patched

## 📊 Severity Guide
See the canonical table in [01-audit-best-practices.md](01-audit-best-practices.md#severity-matrix).

## 🛠️ Quick Greps

```bash
# High-risk patterns
grep -r "delegatecall\|\.call(" contracts/ | grep -v "success"
grep -r "getAssetPrice" contracts/ | grep -v "staleness"
grep -r "transferFrom" contracts/ | grep -v "allowance"
```

---

**AI Advantage**: Complete audits 50-100x faster than humans through parallel execution. Use templates in `06-agent-task-templates.md` for consistency.