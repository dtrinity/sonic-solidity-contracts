# dTRINITY Security Audit Playbook Index

## 🎯 Purpose
This playbook enables AI agents to conduct comprehensive security audits on the dTRINITY protocol by providing structured methodologies, vulnerability catalogs, and protocol-specific guidance.

## 📁 Directory Structure

```
playbooks/claude-code-audit/
├── README.md                    # Main playbook overview and workflow
├── AI-AGENT-GUIDE.md           # Step-by-step execution guide for AI agents
├── index.md                    # This file - playbook navigation
│
├── 01-audit-best-practices.md  # Industry best practices and methodologies
├── 02-vulnerability-catalog.md # Comprehensive vulnerability reference
├── 03-audit-tools-guide.md     # Tool configuration and usage
├── 04-audit-scope.md          # Contract scope definitions
├── 05-protocol-overview.md     # Condensed protocol documentation
│
└── design-docs/
    ├── dstake-design.md       # dStake system design and security
    ├── dstable-design.md      # dStable stablecoin design
    └── dloop-design.md        # dLoop leveraged farming design
```

## 🚀 Quick Start for AI Agents

1. **First Time**: Read `AI-AGENT-GUIDE.md` for specific execution instructions
2. **Understand Scope**: Review `04-audit-scope.md` to know what to audit
3. **Learn Protocol**: Study `05-protocol-overview.md` and design docs
4. **Execute Audit**: Follow the workflow in `README.md`
5. **Reference Vulnerabilities**: Use `02-vulnerability-catalog.md` as checklist

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