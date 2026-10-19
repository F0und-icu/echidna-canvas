import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { canonical } from '../contracts/runtime.ts';
import {
  mcpConnectionSchema,
  type McpRef,
  type McpConnection,
  type SaveMcp,
} from '../contracts/mcp.ts';
import { RuntimeRequestRejected } from './runtime-port.ts';

export interface ResolvedMcp {
  connection: McpConnection;
  headers: Record<string, string>;
}
export class McpStore {
  private db: DatabaseSync;
  private credentialsDirectory: string;
  constructor(database: string, credentialsDirectory: string) {
    this.credentialsDirectory = credentialsDirectory;
    mkdirSync(credentialsDirectory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(database);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS mcp_revisions(id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(id,revision))',
    );
  }
  close() {
    this.db.close();
  }
  list() {
    return {
      connections: this.db
        .prepare(
          'SELECT body FROM mcp_revisions AS r WHERE revision=(SELECT MAX(revision) FROM mcp_revisions WHERE id=r.id) ORDER BY rowid',
        )
        .all()
        .map((row) => mcpConnectionSchema.parse(JSON.parse(row.body as string))),
    };
  }
  get(ref: McpRef) {
    const row = this.db
      .prepare('SELECT body FROM mcp_revisions WHERE id=? AND revision=?')
      .get(ref.id, ref.revision);
    if (!row) throw new RuntimeRequestRejected('MCP 接入版本不存在，请刷新后重新选择。');
    return mcpConnectionSchema.parse(JSON.parse(row.body as string));
  }
  private secretPath(ref: McpRef) {
    return join(this.credentialsDirectory, ref.id + '-' + ref.revision);
  }
  save(input: SaveMcp) {
    const id = input.id ?? randomUUID();
    const latest = this.db
      .prepare('SELECT revision,body FROM mcp_revisions WHERE id=? ORDER BY revision DESC LIMIT 1')
      .get(id);
    if (input.id && (!latest || latest.revision !== input.baseRevision))
      throw new RuntimeRequestRejected('MCP 配置已变更，请刷新后核对。');
    const previous = latest
      ? mcpConnectionSchema.parse(JSON.parse(latest.body as string))
      : undefined;
    const needsSecret = input.auth.method === 'bearer' || input.auth.method === 'header';
    if (!needsSecret && input.secret)
      throw new RuntimeRequestRejected('此认证方式不接收静态密钥。');
    let secret = input.secret;
    if (
      needsSecret &&
      !secret &&
      previous?.hasSecret &&
      previous.url === input.url &&
      canonical(previous.auth) === canonical(input.auth)
    )
      secret = readFileSync(this.secretPath(previous), 'utf8');
    if (needsSecret && !secret) throw new RuntimeRequestRejected('请填写此 MCP 接入的认证密钥。');
    const connection = mcpConnectionSchema.parse({
      id,
      revision: (previous?.revision ?? 0) + 1,
      name: input.name,
      kind: input.kind,
      url: input.url,
      auth: input.auth,
      hasSecret: needsSecret,
    });
    if (secret) writeFileSync(this.secretPath(connection), secret, { mode: 0o600, flag: 'wx' });
    try {
      this.db
        .prepare('INSERT INTO mcp_revisions VALUES(?,?,?)')
        .run(id, connection.revision, JSON.stringify(connection));
    } catch (cause) {
      if (secret) {
        try {
          unlinkSync(this.secretPath(connection));
        } catch (cleanup) {
          throw new AggregateError([cause, cleanup], 'MCP 配置保存失败，新增凭据文件清理也失败。');
        }
      }
      throw cause;
    }
    return connection;
  }
  resolve(refs: McpRef[]): ResolvedMcp[] {
    return refs.map((ref) => {
      const connection = this.get(ref),
        headers: Record<string, string> = {};
      if (connection.auth.method === 'bearer')
        headers.Authorization = 'Bearer ' + readFileSync(this.secretPath(ref), 'utf8');
      if (connection.auth.method === 'header')
        headers[connection.auth.headerName] = readFileSync(this.secretPath(ref), 'utf8');
      return { connection, headers };
    });
  }
}
