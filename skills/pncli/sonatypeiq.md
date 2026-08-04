# Sonatype IQ Server

Enables: `pncli sonatypeiq applications`, `pncli deps frisk --source sonatypeiq` — list applications and scan dependencies against your IQ Server security policies.

## Required config

| Key | Env var | Description |
|-----|---------|-------------|
| `sonatypeiq.baseUrl` | `PNCLI_SONATYPEIQ_BASE_URL` | IQ Server root, e.g. `https://iq.imagile.dev` |
| `sonatypeiq.userCode` | `PNCLI_SONATYPEIQ_USER_CODE` | User Token code (from User Menu → User Token) |
| `sonatypeiq.passcode` | `PNCLI_SONATYPEIQ_PASSCODE` | User Token passcode (from User Menu → User Token) |

The `userCode` and `passcode` are User Token credentials, not your login password.

## Config file (persistent)

```
pncli config set sonatypeiq.baseUrl https://iq.imagile.dev
pncli config set sonatypeiq.userCode <user-code>
pncli config set sonatypeiq.passcode <passcode>
```

## Env vars (ephemeral / CI)

```
export PNCLI_SONATYPEIQ_BASE_URL=https://iq.imagile.dev
export PNCLI_SONATYPEIQ_USER_CODE=<user-code>
export PNCLI_SONATYPEIQ_PASSCODE=<passcode>
```

## Usage

```
# Discover application IDs
pncli sonatypeiq applications list

# Scan dependencies against IQ policies
pncli deps frisk --source sonatypeiq --application-id <id>
```
