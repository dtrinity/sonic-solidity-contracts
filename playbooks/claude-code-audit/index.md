# Audit Playbook Index (AI-Optimized)

## 🎯 Purpose
Fast, parallel security audits by AI agents. Complete in 90 minutes instead of days.

## 📁 Core Files

### For Execution
- **[README.md](README.md)** - Quick start & strategy (start here)
- **[AI-AGENT-GUIDE.md](AI-AGENT-GUIDE.md)** - Step-by-step process
- **[06-agent-task-templates.md](06-agent-task-templates.md)** - Copy-paste agent prompts

### For Reference
- **[02-vulnerability-catalog.md](02-vulnerability-catalog.md)** - What to find
- **[04-audit-scope-condensed.md](04-audit-scope-condensed.md)** - What to audit (LLM-optimized)
- **[design-docs/](design-docs/)** - Module context

### Optional Deep Dives
- **[01-audit-best-practices.md](01-audit-best-practices.md)** - Human auditor methods
- **[03-audit-tools-guide.md](03-audit-tools-guide.md)** - Tool details
- **[05-protocol-overview.md](05-protocol-overview.md)** - Full protocol docs

## ⚡ 90-Minute Workflow

1. **Setup (5 min)**: Check `reports/` for existing findings
2. **Deploy Agents (45 min)**: Use templates from `06-agent-task-templates.md`
3. **Analysis (30 min)**: Cross-module & economic
4. **Report (10 min)**: Consolidate findings

## 🔑 Key Documents by Purpose

### For Understanding What to Audit
- `04-audit-scope.md` - Defines in-scope vs out-of-scope contracts
- `design-docs/*` - Explains what each system should do

### For Learning How to Audit
- `01-audit-best-practices.md` - Methodologies from top firms
- `AI-AGENT-GUIDE.md` - AI-specific execution steps

### For Knowing What to Look For
- `02-vulnerability-catalog.md` - Comprehensive vulnerability list
- `05-protocol-overview.md` - Protocol-specific risks

### For Using Tools
- `03-audit-tools-guide.md` - Tool setup and usage
- Command references in `README.md`

## 🎓 Learning Path

### Beginner AI Auditor
1. `AI-AGENT-GUIDE.md` - Learn the process
2. `02-vulnerability-catalog.md` - Understand vulnerabilities
3. `04-audit-scope.md` - Know the boundaries

### Intermediate AI Auditor
1. `01-audit-best-practices.md` - Advanced methodologies
2. `05-protocol-overview.md` - Protocol economics
3. Design docs - Deep system understanding

### Advanced AI Auditor
1. `03-audit-tools-guide.md` - Tool mastery
2. Cross-reference all docs for complex attacks
3. Focus on economic and composability risks

## 🚨 Critical Information

### Known Issues
- **dStake Withdrawal Bug**: Missing allowance check in `DStakeToken._withdraw` (see `design-docs/dstake-design.md`)

### High-Risk Areas
1. Oracle dependencies across all modules
2. dLoop leverage calculations and liquidations
3. Cross-protocol integrations (Curve, Odos, dLend)
4. Upgradeable contract patterns
5. AMO operations in dStable

### Audit Priorities
1. **Critical**: Direct fund loss vulnerabilities
2. **High**: Economic attacks and oracle manipulation
3. **Medium**: DoS and griefing vectors
4. **Low**: Gas optimizations and best practices

## 📝 Reporting

### Finding Template Location
See `AI-AGENT-GUIDE.md` for the standard finding template

### Severity Matrix
Referenced in `README.md` - use consistently across all findings

### Report Structure
Follow the template at the end of `README.md`

## 🔄 Updates and Maintenance

This playbook should be updated when:
- New vulnerability types are discovered
- Protocol design changes
- Tool capabilities improve
- Audit methodologies evolve

## 💬 Support

For questions about:
- **Methodology**: See `01-audit-best-practices.md`
- **Specific Vulnerabilities**: See `02-vulnerability-catalog.md`
- **Tool Issues**: See `03-audit-tools-guide.md`
- **Protocol Design**: See relevant design doc

---

**Remember**: The goal is to help future AI agents conduct thorough, systematic security audits that protect user funds and ensure protocol safety. Use this playbook as a comprehensive framework while maintaining critical thinking about novel attack vectors.