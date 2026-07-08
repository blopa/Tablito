import * as Device from 'expo-device';
import { Platform } from 'react-native';

import {
  Change,
  Device as PeerDevice,
  PeerSync,
  VersionVector,
} from '../../modules/expo-peer-sync';

type ItemPayload = { text: string; authorName: string };

export type Item = {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: number;
};

export type PeerSyncSnapshot = {
  deviceId: string;
  deviceName: string;
  items: Item[];
  peers: PeerDevice[];
  status: string;
  syncing: boolean;
};

// A fresh identity per app launch keeps the demo stateless: every record
// lives only in memory, so a relaunch is a brand-new "user".
const deviceId = Math.random().toString(36).slice(2, 10);
const deviceName = `${Device.deviceName ?? Platform.OS}-${deviceId.slice(0, 4)}`;
const SEARCH_STATUS_TIMEOUT_MS = 5000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

class PeerSyncStore {
  private readonly changes = new Map<string, Change<ItemPayload>>();
  private readonly peers = new Map<string, PeerDevice>();
  private readonly listeners = new Set<() => void>();
  private readonly peerSync: PeerSync;
  private localVersion = 0;
  private status = 'Starting…';
  private syncing = false;
  private started = false;
  private searching = false;
  private searchStatusTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: PeerSyncSnapshot;

  constructor() {
    this.snapshot = this.buildSnapshot();
    this.peerSync = new PeerSync({
      deviceId,
      deviceName,
      appId: 'tablito',
      adapter: {
        getChanges: async (have: VersionVector) =>
          [...this.changes.values()].filter(
            (change) => change.version > (have[change.authorId] ?? 0)
          ),
        applyChanges: async (incoming: Change[]) =>
          this.addChanges(incoming as Change<ItemPayload>[]),
        getVersionVector: async () => {
          const vector: VersionVector = {};
          for (const change of this.changes.values()) {
            vector[change.authorId] = Math.max(vector[change.authorId] ?? 0, change.version);
          }
          return vector;
        },
      },
    });

    this.peerSync.on('deviceFound', (peer) => {
      this.peers.set(peer.id, peer);
      this.searching = false;
      this.clearSearchStatusTimer();
      this.setStatus(`Found ${this.peers.size} nearby device${this.peers.size === 1 ? '' : 's'}`);
    });
    this.peerSync.on('deviceLost', (peer) => {
      this.peers.delete(peer.id);
      if (this.searching) {
        this.notify();
        return;
      }
      this.setStatus(
        this.peers.size === 0
          ? `Visible as "${deviceName}"`
          : `Found ${this.peers.size} nearby device${this.peers.size === 1 ? '' : 's'}`
      );
    });
    this.peerSync.on('syncStarted', () => this.setStatus('Syncing…', true));
    this.peerSync.on('syncFinished', () => this.setStatus('Synced', false));
    this.peerSync.on('syncFailed', ({ error }) =>
      this.setStatus(`Sync failed: ${errorMessage(error)}`, false)
    );
  }

  async start() {
    if (this.started) return;
    this.started = true;
    try {
      this.beginSearchStatus();
      await this.peerSync.startHosting();
      await this.peerSync.startDiscovery();
      this.scheduleEmptySearchStatus();
    } catch (error) {
      this.started = false;
      this.searching = false;
      this.clearSearchStatusTimer();
      this.setStatus(`Failed to start: ${errorMessage(error)}`);
    }
  }

  addItem(text: string) {
    const version = ++this.localVersion;
    this.addChanges([
      {
        changeId: `${deviceId}:${version}`,
        entity: 'item',
        entityId: `${deviceId}:${version}`,
        operation: 'create',
        payload: { text, authorName: deviceName },
        timestamp: Date.now(),
        authorId: deviceId,
        version,
      },
    ]);
  }

  async refresh() {
    if (!this.started) {
      await this.start();
      return;
    }
    this.peers.clear();
    this.beginSearchStatus();
    try {
      await this.peerSync.rescan();
      this.scheduleEmptySearchStatus();
    } catch (error) {
      this.searching = false;
      this.clearSearchStatusTimer();
      this.setStatus(`Search failed: ${errorMessage(error)}`, false);
    }
  }

  async syncWith(peerId: string) {
    this.setStatus('Connecting…', true);
    try {
      await this.peerSync.connect(peerId);
    } catch (error) {
      this.setStatus(`Connection failed: ${errorMessage(error)}`, false);
      return;
    }
    // Outcome is reported through the syncFinished/syncFailed events.
    await this.peerSync.sync(peerId);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private addChanges(incoming: Change<ItemPayload>[]) {
    for (const change of incoming) {
      this.changes.set(change.changeId, change);
    }
    this.notify();
  }

  private setStatus(status: string, syncing = this.syncing) {
    this.status = status;
    this.syncing = syncing;
    this.notify();
  }

  private beginSearchStatus() {
    this.searching = true;
    this.clearSearchStatusTimer();
    this.setStatus('Searching…', false);
  }

  private scheduleEmptySearchStatus() {
    this.clearSearchStatusTimer();
    this.searchStatusTimer = setTimeout(() => {
      this.searchStatusTimer = null;
      this.searching = false;
      if (this.peers.size === 0) {
        this.setStatus(`No devices found yet. Visible as "${deviceName}"`, false);
      }
    }, SEARCH_STATUS_TIMEOUT_MS);
  }

  private clearSearchStatusTimer() {
    if (this.searchStatusTimer) {
      clearTimeout(this.searchStatusTimer);
      this.searchStatusTimer = null;
    }
  }

  private buildSnapshot(): PeerSyncSnapshot {
    const items = [...this.changes.values()]
      .filter((change) => change.operation === 'create')
      .map((change) => ({
        id: change.entityId,
        text: change.payload.text,
        authorId: change.authorId,
        authorName: change.payload.authorName,
        createdAt: change.timestamp,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return {
      deviceId,
      deviceName,
      items,
      peers: [...this.peers.values()],
      status: this.status,
      syncing: this.syncing,
    };
  }

  private notify() {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((listener) => listener());
  }
}

let store: PeerSyncStore | null = null;

export function getPeerSyncStore(): PeerSyncStore {
  return (store ??= new PeerSyncStore());
}
