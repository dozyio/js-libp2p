// Mock type definitions for building the package
// These don't affect runtime behavior, just TypeScript compilation

import type { AbortOptions } from '@libp2p/interface'

export interface Uint8ArrayList {
  at(index: number): number | undefined
  get(index: number): number | undefined
  subarray(): Uint8Array
}

export interface Connection {
  id: string
  remotePeer: {
    toString(): string
  }
  // TypeScript workaround: Since we're adding metadata dynamically, make it any
  metadata: any
  newStream(protocol: string, options?: AbortOptions): Promise<any>
}

export interface Peer {
  id: string
  pubKey?: Uint8Array
  publicKey?: Uint8Array
}

export interface PeerStore {
  get(peerId: string): Promise<Peer>
}

// Helper to use instead of .at() which isn't available on Uint8ArrayList
export function getByteAt (array: any, index: number): number {
  if (typeof array.at === 'function') {
    return array.at(index) ?? 0
  }
  if (typeof array.get === 'function') {
    return array.get(index) ?? 0
  }
  return 0
}

// Helper to ensure we have a Uint8Array
export function ensureUint8Array (data: any): Uint8Array {
  if (data instanceof Uint8Array) {
    return data
  }
  if (typeof data.subarray === 'function') {
    return data.subarray()
  }
  if (Array.isArray(data)) {
    return new Uint8Array(data)
  }
  return new Uint8Array()
}
