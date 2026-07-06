import { PeerSyncOptions } from './ExpoPeerSync.types';

// Local-network discovery and TCP sockets do not exist in browsers.
export class PeerSync {
  constructor(_options: PeerSyncOptions) {
    throw new Error('expo-peer-sync is not available on web');
  }
}
