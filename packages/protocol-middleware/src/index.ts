/**
 * @packageDocumentation
 *
 * The protocol middleware service provides a flexible authentication layer for libp2p that runs
 * after connection encryption and multiplexing are set up. It allows protecting designated
 * services from unauthenticated access.
 *
 * @example
 *
 * ```typescript
 * import { createLibp2p } from 'libp2p'
 * import { createProtocolMiddleware } from '@libp2p/protocol-middleware'
 * import { challengeResponseProvider } from '@libp2p/middleware-auth-challenge'
 * import { ping } from '@libp2p/ping'
 * import { identify } from '@libp2p/identify'
 *
 * const node = await createLibp2p({
 *   services: {
 *     // Initialize protocol middleware with services to protect
 *     protocolMiddleware: createProtocolMiddleware({
 *       // Select authentication provider
 *       provider: challengeResponseProvider({
 *         timeout: 5000 // 5 second timeout
 *       }),
 *       // Automatically protect these services
 *       protectedServices: {
 *         ping: ping(),
 *         identify: identify()
 *       }
 *     })
 *   }
 * })
 *
 * // Get a connection to authenticate
 * const connection = await node.dial('multiaddress')
 *
 * // Authenticate the connection
 * const authenticated = await node.services.protocolMiddleware.authenticate(connection.id)
 *
 * if (authenticated) {
 *   console.log('Authentication successful!')
 * } else {
 *   console.log('Authentication failed!')
 * }
 *
 * // Can also protect services dynamically
 * await node.services.protocolMiddleware.protectService('anotherService', anotherService)
 * ```
 */

import { ProtocolMiddlewareService as ProtocolMiddlewareServiceImpl } from './protocol-middleware-service.js'
import type { MiddlewareWrapperOptions } from './middleware-wrapper.js'
import type { ProtectedService, ProtocolMiddlewareServiceInit, ProtocolMiddlewareServiceComponents } from './protocol-middleware-service.js'
import type { AbortOptions, ComponentLogger, PeerId, PeerStore } from '@libp2p/interface'
import type { ConnectionManager, Registrar } from '@libp2p/interface-internal'

/**
 * Interface for the protocol middleware service
 */
export interface ProtocolMiddlewareService {
  /**
   * Authenticate a connection using the configured authentication provider
   */
  authenticate(connectionId: string, options?: AbortOptions): Promise<boolean>

  /**
   * Check if a connection is authenticated
   */
  isAuthenticated(connectionId: string): boolean

  /**
   * Register a service to be protected with authentication
   */
  protectService(name: string, service: ProtectedService, authOptions?: MiddlewareWrapperOptions): Promise<void>

  /**
   * Unprotect a previously protected service
   */
  unprotectService(name: string): Promise<void>
}

/**
 * Components needed for the protocol middleware
 */
export interface FullProtocolMiddlewareComponents extends ProtocolMiddlewareServiceComponents {
  registrar: Registrar
  connectionManager: ConnectionManager
  peerId: {
    toPeerId(): Promise<PeerId>
  }
  peerStore: PeerStore
  crypto: Crypto
  logger: ComponentLogger
}

/**
 * Create a new protocol middleware service
 */
export function createProtocolMiddleware (init: ProtocolMiddlewareServiceInit): (components: FullProtocolMiddlewareComponents) => ProtocolMiddlewareService {
  return (components) => new ProtocolMiddlewareServiceImpl(components, init)
}

// Export functions
export { createMiddlewareWrapper } from './middleware-wrapper.js'

// Export types
export type {
  ProtectedService,
  ProtocolMiddlewareServiceInit,
  MiddlewareWrapperOptions
}

// Export authentication provider interface for use by providers
export type { AuthenticationProvider, AuthenticationProviderOptions } from './authentication-provider.js'
