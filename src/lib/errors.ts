export class PncliError extends Error {
  status: number;
  url?: string;

  constructor(message: string, status: number = 1, url?: string) {
    super(message);
    this.name = 'PncliError';
    this.status = status;
    this.url = url;
  }
}
