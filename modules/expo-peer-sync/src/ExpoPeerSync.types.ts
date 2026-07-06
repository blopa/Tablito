export type Change<T = unknown> = {
  changeId: string;
  entity: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  payload: T;
  timestamp: number;
  authorId: string;
  version: number;
};

export interface SyncAdapter {
  getChanges(lastVersion: number): Promise<Change[]>;
  applyChanges(changes: Change[]): Promise<void>;
  getVersion(): Promise<number>;
  setVersion(version: number): Promise<void>;
}

export type Device = {
  id: string;
  name: string;
  /**
   * Resolved address of the peer. Android (NSD) resolves these during
   * discovery; iOS (Bonjour) connects by service name instead, so they may
   * be absent there.
   */
  host?: string;
  port?: number;
  attributes: Record<string, string>;
};

/**
 * The protocol is strictly lock-step request/response: a peer sends one
 * request per connection at a time and waits for the matching response.
 */
export type SyncRequest =
  | { type: 'HELLO'; deviceId: string; deviceName: string }
  | { type: 'REQUEST_METADATA' }
  | { type: 'REQUEST_CHANGES'; sinceVersion: number }
  | { type: 'PUSH_CHANGES'; changes: Change[] };

export type SyncResponse =
  | { type: 'HELLO_ACK'; deviceId: string }
  | { type: 'DATABASE_VERSION'; version: number }
  | { type: 'CHANGES_RESPONSE'; changes: Change[] }
  | { type: 'ACK' }
  | { type: 'ERROR'; message: string };

export type SyncMessage = SyncRequest | SyncResponse;

export type PeerSyncEvents = {
  deviceFound: Device;
  deviceLost: Device;
  connected: { deviceId: string; name?: string };
  disconnected: { deviceId: string };
  syncStarted: { deviceId: string };
  syncFinished: { deviceId: string };
  syncFailed: { deviceId: string; error: unknown };
};
