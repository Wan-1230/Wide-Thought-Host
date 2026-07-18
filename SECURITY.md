# Security Policy

## Reporting a vulnerability in Wide Thought Host (WTH)

Please **do not** open a public GitHub issue for security reports that include
secrets, credentials, or exploit details.

Preferred options (in order):

1. **GitHub private vulnerability reporting** on
   [Wan-1230/Wide-Thought-Host](https://github.com/Wan-1230/Wide-Thought-Host/security)
   (if enabled for the repository)
2. Contact the maintainers via a private channel listed on the repository

Include:

- Affected version / commit
- Reproduction steps (minimal)
- Impact assessment
- Whether the issue is in WTH-specific deltas or inherited from upstream

We aim to acknowledge reports promptly and coordinate disclosure.

## Upstream issues

Wide Thought Host is derived from:

- [xai-org/grok-build](https://github.com/xai-org/grok-build) (Apache-2.0)
- [thedavidweng/gork-build](https://github.com/thedavidweng/gork-build) (Apache-2.0)

Bugs or vulnerabilities that exist in **upstream** code bases should also be
reported to the respective upstream maintainers.

## Scope notes

- **In scope:** WTH client code in this repository, packaging, and configuration
- **Out of scope:** remote model APIs, account billing, or third-party server
  infrastructure — report those to the respective service providers
