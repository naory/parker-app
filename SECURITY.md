# Security Policy

## Supported Versions

Security fixes are applied to the actively maintained branch.

| Version | Supported |
| ------- | --------- |
| `main`  | Yes       |
| Older branches/tags | No |

## Reporting a Vulnerability

Please do **not** open public GitHub issues for security vulnerabilities.

Use one of these private channels:

1. **GitHub Security Advisories (preferred)**  
   Open a private report here:  
   https://github.com/naory/parker-app/security/advisories/new

2. **Security alias email (fallback if advisory flow is unavailable)**  
   security@parker.app

Do not send reports to personal maintainer email addresses; use the channels above so reports are tracked and triaged reliably.

Include as much detail as possible:

- Affected component(s) and file paths
- Reproduction steps or proof of concept
- Impact assessment (confidentiality, integrity, availability)
- Suggested mitigation (if known)

## Disclosure Process

- We acknowledge receipt within **3 business days**
- We provide an initial triage decision within **7 business days**
- We aim to ship a fix (or mitigation) within **30 days** for high/critical findings
- We coordinate public disclosure timing with the reporter

## Scope Notes

In scope:

- API authentication and authorization bypasses
- Payment verification bypasses (x402 / webhook paths)
- Sensitive data exposure (PII, secrets, wallet/session data)
- Smart contract and blockchain integration vulnerabilities
- Gate/driver app flows that can be abused to avoid payment or session closure

Out of scope (unless chained with a real impact):

- Purely theoretical issues with no practical exploit path
- Missing best-practice headers with no exploitability
- DoS findings that require unrealistic resources

## Safe Harbor

We support good-faith security research and will not pursue legal action for:

- Testing against your own accounts/data
- Avoiding privacy violations and service disruption
- Promptly reporting findings and giving us reasonable time to remediate
