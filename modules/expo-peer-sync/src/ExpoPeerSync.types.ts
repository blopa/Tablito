/**
 * A single mutation to one entity, authored by exactly one device.
 *
 * `version` is the author's own monotonically increasing sequence number
 * (1, 2, 3, ... per device). Combined with `authorId` it identifies the
 * change globally and lets peers express what they already hold as a
 * {@link VersionVector}.
 */
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

/**
 * Highest `version` held per `authorId`. A change is covered by a vector
 * when `change.version <= vector[change.authorId]`; absent authors count
 * as version 0.
 */
export type VersionVector = Record<string, number>;

export interface SyncAdapter {
  /** Every stored change not covered by `have`, own and third-party alike. */
  getChanges(have: VersionVector): Promise<Change[]>;
  /**
   * Persist changes received from a peer. Must be idempotent: simultaneous
   * bidirectional syncs can deliver the same change twice.
   */
  applyChanges(changes: Change[]): Promise<void>;
  /** The vector covering every change currently stored on this device. */
  getVersionVector(): Promise<VersionVector>;
}

export type PeerSyncOptions = {
  deviceId: string;
  deviceName: string;
  appId: string;
  adapter: SyncAdapter;
};

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
  | { type: 'REQUEST_CHANGES'; have: VersionVector }
  | { type: 'PUSH_CHANGES'; changes: Change[] };

export type SyncResponse =
  | { type: 'HELLO_ACK'; deviceId: string }
  /**
   * The changes the requester lacks, plus the responder's own vector so the
   * requester knows exactly what to push back.
   */
  | { type: 'CHANGES_RESPONSE'; changes: Change[]; have: VersionVector }
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
