# Kairélys fork status

Kairélys is a temporary, unofficial and independent fork of
[Operon](https://github.com/hasanyilmaz/operon). It is maintained by Optimike Labs and is not
endorsed by Operon's maintainer.

## Why this fork exists

Kairélys keeps Operon's Markdown-first task engine while exposing a small, versioned public API.
That API lets companion bridges and MCP clients use Operon's complete domain mutation paths
instead of editing task Markdown directly.

Kairélys deliberately preserves the existing task data contract, including `operonId`, inline
metadata, file-task properties and table formats. This is a compatibility decision: a vault must
be able to return to official Operon without rewriting its task corpus.

## Temporary-fork policy

The generic public API is proposed upstream independently from Kairélys-specific integration and
branding.

- If Operon accepts and releases a compatible public API, Kairélys enters maintenance-only mode.
- A documented migration path back to official Operon is then published before Kairélys is retired.
- If the API is not accepted, Kairélys remains a minimal fork and tracks supported Operon releases.
- ÉLYSIA conventions, MCP policy and distribution profiles stay outside Operon's upstream code.

## Branding and attribution

Kairélys uses a different project name and Obsidian plugin ID (`kairelys`). The Operon name is used
only to describe ancestry and compatibility. Operon's original copyright and GPL notices remain in
the source history and license.

See [TRADEMARK.md](TRADEMARK.md) for the upstream branding policy that this fork follows.
