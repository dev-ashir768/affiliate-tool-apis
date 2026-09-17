declare module "imapflow" {
  export class ImapFlow {
    constructor(opts: Record<string, unknown>);
    connect(): Promise<void>;
    mailboxOpen(name: string): Promise<unknown>;
    search(query: Record<string, unknown>): Promise<number[]>;
    fetchOne(
      uid: number,
      opts: Record<string, unknown>
    ): Promise<{
      envelope?: { subject?: string; from?: Array<{ address?: string }> };
      internalDate?: string | Date;
    } | null>;
    logout(): Promise<void>;
  }
}
