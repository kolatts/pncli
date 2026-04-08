// Ambient type declaration for the optional Windows-only native module.
// Only loaded dynamically on win32 when SSPI auth is needed.
declare module 'node-expose-sspi' {
  export class Client {
    fetch(url: string | URL | Request, init?: RequestInit): Promise<Response>;
  }
}
