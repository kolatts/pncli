# JWT

Enables: `pncli jwt decode <token>` — decode a JWT token and output the header, payload, and signature as JSON (similar to jwt.io).

## No configuration required

The JWT decode command is self-contained and does not require any configuration or external services. It decodes the base64url-encoded header and payload locally.

## Usage

```
pncli jwt decode <token>
```

Returns structured JSON with the decoded header, payload, and raw signature (shown here as `<signature>` so secret scanners don't flag the docs; the real command returns the token's base64url signature segment):

```json
{
  "status": "ok",
  "service": "jwt",
  "command": "decode",
  "data": {
    "header": {
      "alg": "HS256",
      "typ": "JWT"
    },
    "payload": {
      "sub": "1234567890",
      "name": "John Doe",
      "iat": 1516239022
    },
    "signature": "<signature>"
  }
}
```

## Notes

- Works with any JWT token, regardless of signing algorithm
- Does not verify the signature — only decodes and displays it
- Throws an error if the token is malformed or the header/payload are not valid JSON
