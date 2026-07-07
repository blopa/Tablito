import { EventSubscription, requireNativeModule } from 'expo-modules-core';
import { NativeModule } from 'expo-modules-core/types';

import {
  Device,
  PeerSyncEvents,
  PeerSyncOptions,
  SyncAdapter,
  SyncMessage,
  SyncRequest,
  SyncResponse,
} from './ExpoPeerSync.types';

type NativeDeviceFoundEvent = {
  name: string;
  attributes: Record<string, string>;
};

type ExpoPeerSyncModuleEvents = {
  deviceFound(event: NativeDeviceFoundEvent): void;
  deviceLost(event: { name: string }): void;
  messageReceived(event: { message: string; connectionId: string }): void;
  disconnected(event: { connectionId: string }): void;
};

type ExpoPeerSyncNativeModule = NativeModule<ExpoPeerSyncModuleEvents> & {
  startHosting(name: string, txtRecords: Record<string, string>): Promise<void>;
  stopHosting(): Promise<void>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  connect(name: string): Promise<string>;
  disconnect(connectionId: string): Promise<void>;
  sendMessage(connectionId: string, message: string): Promise<void>;
};

const native = requireNativeModule<ExpoPeerSyncNativeModule>('ExpoPeerSync');

const RESPONSE_TIMEOUT_MS = 10_000;

const RESPONSE_TYPES = new Set<SyncMessage['type']>([
  'HELLO_ACK',
  'CHANGES_RESPONSE',
  'ACK',
  'ERROR',
]);

function isResponse(message: SyncMessage): message is SyncResponse {
  return RESPONSE_TYPES.has(message.type);
}

type PendingResponse = {
  expect: SyncResponse['type'];
  resolve: (response: SyncResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class PeerSync {
  private readonly deviceId: string;
  private readonly deviceName: string;
  private readonly appId: string;
  private readonly adapter: SyncAdapter;
  private readonly discoveredDevices = new Map<string, Device>();
  private readonly deviceToConnection = new Map<string, string>();
  private readonly connectionToDevice = new Map<string, string>();
  private readonly pendingResponses = new Map<string, PendingResponse>();
  private readonly listeners: {
    [K in keyof PeerSyncEvents]?: ((payload: PeerSyncEvents[K]) => void)[];
  } = {};
  private readonly subscriptions: EventSubscription[];

  constructor(options: PeerSyncOptions) {
    this.deviceId = options.deviceId;
    this.deviceName = options.deviceName;
    this.appId = options.appId;
    this.adapter = options.adapter;

    this.subscriptions = [
      native.addListener('deviceFound', (event) => this.onDeviceFound(event)),
      native.addListener('deviceLost', (event) => this.onDeviceLost(event)),
      native.addListener('messageReceived', (event) => this.onMessageReceived(event)),
      native.addListener('disconnected', (event) => this.onDisconnected(event)),
    ];
  }

  /** Removes native event subscriptions. The instance must not be used afterwards. */
  destroy() {
    this.subscriptions.forEach((subscription) => subscription.remove());
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('PeerSync instance destroyed'));
    }
    this.pendingResponses.clear();
  }

  async startHosting() {
    await native.startHosting(this.deviceName, {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      appId: this.appId,
    });
  }

  async stopHosting() {
    await native.stopHosting();
  }

  async startDiscovery() {
    await native.startDiscovery();
  }

  async stopDiscovery() {
    await native.stopDiscovery();
  }

  async connect(deviceId: string) {
    if (this.deviceToConnection.has(deviceId)) return;
    const device = this.discoveredDevices.get(deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found`);

    const connectionId = await native.connect(device.name);
    try {
      const ack = await this.request(
        connectionId,
        { type: 'HELLO', deviceId: this.deviceId, deviceName: this.deviceName },
        'HELLO_ACK'
      );
      this.registerPeer(connectionId, ack.deviceId, device.name);
    } catch (error) {
      await native.disconnect(connectionId).catch(() => {});
      throw error;
    }
  }

  async disconnect(deviceId: string) {
    const connectionId = this.deviceToConnection.get(deviceId);
    if (!connectionId) return;
    // Map cleanup and the 'disconnected' event happen in onDisconnected,
    // triggered by the native close notification.
    await native.disconnect(connectionId);
  }

  async sync(targetDeviceId?: string) {
    const deviceIds = targetDeviceId ? [targetDeviceId] : [...this.deviceToConnection.keys()];

    for (const deviceId of deviceIds) {
      this.emit('syncStarted', { deviceId });
      try {
        await this.syncWith(deviceId);
        this.emit('syncFinished', { deviceId });
      } catch (error) {
        this.emit('syncFailed', { deviceId, error });
      }
    }
  }

  on<K extends keyof PeerSyncEvents>(event: K, listener: (payload: PeerSyncEvents[K]) => void) {
    const list = (this.listeners[event] ??= []) as ((payload: PeerSyncEvents[K]) => void)[];
    list.push(listener);
  }

  off<K extends keyof PeerSyncEvents>(event: K, listener: (payload: PeerSyncEvents[K]) => void) {
    const list = this.listeners[event];
    if (!list) return;
    const index = list.indexOf(listener);
    if (index !== -1) list.splice(index, 1);
  }

  private emit<K extends keyof PeerSyncEvents>(event: K, payload: PeerSyncEvents[K]) {
    this.listeners[event]?.forEach((listener) => listener(payload));
  }

  private async syncWith(deviceId: string) {
    const connectionId = this.deviceToConnection.get(deviceId);
    if (!connectionId) throw new Error(`No connection for device ${deviceId}`);

    // Pull the changes we don't have; the response carries the peer's own
    // vector, telling us exactly what to push back.
    const have = await this.adapter.getVersionVector();
    const pulled = await this.request(
      connectionId,
      { type: 'REQUEST_CHANGES', have },
      'CHANGES_RESPONSE'
    );
    await this.adapter.applyChanges(pulled.changes);

    const toPush = await this.adapter.getChanges(pulled.have);
    await this.request(connectionId, { type: 'PUSH_CHANGES', changes: toPush }, 'ACK');
  }

  private request<T extends SyncResponse['type']>(
    connectionId: string,
    message: SyncRequest,
    expect: T
  ): Promise<Extract<SyncResponse, { type: T }>> {
    return new Promise((resolve, reject) => {
      if (this.pendingResponses.has(connectionId)) {
        reject(new Error(`A request is already in flight on connection ${connectionId}`));
        return;
      }
      const timer = setTimeout(() => {
        this.pendingResponses.delete(connectionId);
        reject(new Error(`Timed out waiting for ${expect} from connection ${connectionId}`));
      }, RESPONSE_TIMEOUT_MS);
      this.pendingResponses.set(connectionId, {
        expect,
        // settleResponse only resolves with a response of type `expect`.
        resolve: resolve as (response: SyncResponse) => void,
        reject,
        timer,
      });
      native.sendMessage(connectionId, JSON.stringify(message)).catch((error) => {
        clearTimeout(timer);
        this.pendingResponses.delete(connectionId);
        reject(error);
      });
    });
  }

  private settleResponse(connectionId: string, response: SyncResponse) {
    const pending = this.pendingResponses.get(connectionId);
    if (!pending) {
      console.warn(`expo-peer-sync: unexpected ${response.type} on connection ${connectionId}`);
      return;
    }
    this.pendingResponses.delete(connectionId);
    clearTimeout(pending.timer);
    if (response.type === 'ERROR') {
      pending.reject(new Error(`Peer error: ${response.message}`));
    } else if (response.type !== pending.expect) {
      pending.reject(new Error(`Expected ${pending.expect}, received ${response.type}`));
    } else {
      pending.resolve(response);
    }
  }

  private async handleRequest(request: SyncRequest, connectionId: string) {
    let response: SyncResponse;
    try {
      response = await this.respondTo(request, connectionId);
    } catch (error) {
      response = { type: 'ERROR', message: error instanceof Error ? error.message : String(error) };
    }
    try {
      await native.sendMessage(connectionId, JSON.stringify(response));
    } catch (error) {
      console.warn(`expo-peer-sync: failed to respond on connection ${connectionId}`, error);
    }
  }

  private async respondTo(request: SyncRequest, connectionId: string): Promise<SyncResponse> {
    switch (request.type) {
      case 'HELLO':
        this.registerPeer(connectionId, request.deviceId, request.deviceName);
        return { type: 'HELLO_ACK', deviceId: this.deviceId };
      case 'REQUEST_CHANGES': {
        const [changes, have] = await Promise.all([
          this.adapter.getChanges(request.have),
          this.adapter.getVersionVector(),
        ]);
        return { type: 'CHANGES_RESPONSE', changes, have };
      }
      case 'PUSH_CHANGES':
        await this.adapter.applyChanges(request.changes);
        return { type: 'ACK' };
      default:
        return {
          type: 'ERROR',
          message: `Unsupported message type: ${(request as SyncMessage).type}`,
        };
    }
  }

  private registerPeer(connectionId: string, deviceId: string, name?: string) {
    this.deviceToConnection.set(deviceId, connectionId);
    this.connectionToDevice.set(connectionId, deviceId);
    this.emit('connected', { deviceId, name });
  }

  private onDeviceFound(event: NativeDeviceFoundEvent) {
    const deviceId = event.attributes.deviceId;
    if (!deviceId || deviceId === this.deviceId) return;
    const device: Device = {
      id: deviceId,
      name: event.name,
      attributes: event.attributes,
    };
    this.discoveredDevices.set(deviceId, device);
    this.emit('deviceFound', device);
  }

  private onDeviceLost(event: { name: string }) {
    // mDNS "lost" notifications only carry the service name (the TXT record
    // holding the deviceId is no longer resolvable), so match by name here.
    for (const device of this.discoveredDevices.values()) {
      if (device.name === event.name) {
        this.discoveredDevices.delete(device.id);
        this.emit('deviceLost', device);
        break;
      }
    }
  }

  private onMessageReceived(event: { message: string; connectionId: string }) {
    let message: SyncMessage;
    try {
      message = JSON.parse(event.message);
    } catch {
      console.warn(
        `expo-peer-sync: ignoring malformed message on connection ${event.connectionId}`
      );
      return;
    }
    if (isResponse(message)) {
      this.settleResponse(event.connectionId, message);
    } else {
      this.handleRequest(message, event.connectionId);
    }
  }

  private onDisconnected(event: { connectionId: string }) {
    const pending = this.pendingResponses.get(event.connectionId);
    if (pending) {
      this.pendingResponses.delete(event.connectionId);
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closed'));
    }
    const deviceId = this.connectionToDevice.get(event.connectionId);
    if (deviceId) {
      this.deviceToConnection.delete(deviceId);
      this.connectionToDevice.delete(event.connectionId);
      this.emit('disconnected', { deviceId });
    }
  }
}
