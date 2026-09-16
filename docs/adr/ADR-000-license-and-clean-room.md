# ADR-000: License and clean-room policy

**Status:** Accepted · **Date:** 2026-09-16

## Context
AutoAPPZ is a competing product to a reference project that mixes Apache-2.0 code with an FSL-1.1 region that forbids competing use (`docs/legal/REFERENCE-LICENSE-AUDIT.md`).

## Decision
- AutoAPPZ is licensed **Apache-2.0** with a `NOTICE` file for bundled attributions.
- Clean-room rules R1–R8 from the audit are binding: no code, comments, prompts, fixtures, branding, identifiers, tag vocabularies or schemas are copied from the reference; FSL sources are never opened; the reference clone lives in a git-ignored `_reference/` directory.
- Concepts are studied and documented in `docs/reference/*`; implementation is independent.

## Alternatives
MIT (less patent protection), AGPL (deters adoption/embedding), FSL (contradicts the open, portable positioning).

## Consequences
Contributors sign no CLA beyond DCO sign-off; third-party dependency licenses are audited at release; a CI check greps for the reference product's identifiers.

## Migration impact
None (greenfield).
