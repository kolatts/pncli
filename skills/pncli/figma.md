# Figma

pncli uses the Figma REST API directly; no external CLI is required.

## Configuration

| Key | Environment variable | Purpose |
|---|---|---|
| `figma.baseUrl` | `PNCLI_FIGMA_BASE_URL` | Figma API base URL — always `https://api.figma.com` |
| `figma.token` | `PNCLI_FIGMA_TOKEN` | Personal access token |

Generate a personal access token in Figma under **Account Settings → Personal access tokens**.

```bash
pncli config set figma.baseUrl https://api.figma.com
pncli config set figma.token <your-token>
pncli config test
```

## Finding a Figma file key

The file key is the alphanumeric segment in a Figma URL. Both URL formats are accepted:

```
https://www.figma.com/design/ABCDEFGH1234/My-Design-Name
                              ^^^^^^^^^^^^
https://www.figma.com/file/ABCDEFGH1234/My-Design-Name
                            ^^^^^^^^^^^^
```

You can pass either the raw file key or the full URL to any `figma` command.

## Commands

```bash
# Get current user — useful for verifying credentials
pncli figma me

# Get file metadata and structure summary (component and style counts)
pncli figma file ABCDEFGH1234
pncli figma file "https://www.figma.com/design/ABCDEFGH1234/My-Design"

# Include the full document node tree (can be large)
pncli figma file ABCDEFGH1234 --document

# Get all comments on a file
pncli figma comments ABCDEFGH1234

# Get comments as of a specific point in time
pncli figma comments ABCDEFGH1234 --as-of 2026-08-01T00:00:00Z

# Get version history
pncli figma versions ABCDEFGH1234

# List files in a Figma project (project ID is visible in the project URL)
pncli figma project-files 123456789
```

## Notes

- `figma file` returns a summary by default: name, last-modified, version, thumbnail URL, role, editor type, schema version, and counts of components and styles. Pass `--document` to include the full document node tree (this can be very large for complex designs).
- Passing a Figma image (screenshot or export) rather than a link is **not supported** — pncli works with the Figma REST API only, not image analysis. Use the file key or URL instead.
