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
import type { AuthenticationProvider } from './authentication-provider.js'
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

/**
 * Create the protocol middleware with a simplified API for libp2p services
 *
 * This is a utility function that's easier to use with libp2p service components
 */
export function createLibp2pMiddleware (options: {
  provider: AuthenticationProvider
  autoAuthenticate?: boolean
  // Allow passing service names to protect
  protectedServices?: Record<string, any>
  authOptions?: Record<string, MiddlewareWrapperOptions>
}) {
  // Create a set to track service names to protect
  const serviceNames = new Set<string>()

  // Store service names from protected services
  if (options.protectedServices != null) {
    for (const name of Object.keys(options.protectedServices)) {
      serviceNames.add(name)
    }
  }

  // Return a factory function compatible with libp2p services
  return (components: any) => {
    // Create the middleware service
    const middleware = new ProtocolMiddlewareServiceImpl(components, {
      provider: options.provider,
      autoAuthenticate: options.autoAuthenticate
    })

    // Set up automatic authentication of new connections
    // Check if the connection manager has an event emitter 
    if (typeof components.connectionManager.on === 'function') {
      // Use Node.js style event emitter
      components.connectionManager.on('connection:open', (connection: any) => {
        const connectionId = connection.id || (connection.detail && connection.detail.id)
        if (connectionId) {
          // eslint-disable-next-line no-console
          console.log(`New connection opened, initiating mutual authentication: ${connectionId}`)
          
          // First, authenticate the remote peer
          middleware.authenticate(connectionId).then(result => {
            if (result) {
              // eslint-disable-next-line no-console
              console.log(`Connection ${connectionId.slice(0, 8)} authenticated successfully`)
            } else {
              // eslint-disable-next-line no-console
              console.log(`Connection ${connectionId.slice(0, 8)} authentication failed`)
            }
          }).catch(err => {
            // eslint-disable-next-line no-console
            console.error(`Authentication error for ${connectionId.slice(0, 8)}: ${err.message}`)
          })
        }
      })
    }

    // Initialize middleware and protect existing services
    // We delay protection to ensure libp2p has fully initialized all services and handlers
    ;(async () => {
      try {
        // Add services to the middleware's map right away - important!
        for (const name of serviceNames) {
          const service = components[name]
          if (service != null) {
            // eslint-disable-next-line no-console
            console.log(`📋 Registering service ${name} with middleware`)
            middleware.services.set(name, { 
              service,
              authOptions: options.authOptions?.[name] 
            })
          }
        }

        // Start the middleware after registering services
        // eslint-disable-next-line no-console
        console.log('🚀 Starting protocol middleware')
        await middleware.start()
        
        // Add a small delay to ensure all libp2p services have fully initialized
        // This helps avoid race conditions with handler registration
        await new Promise(resolve => setTimeout(resolve, 100))
        
        // Process services in sequence to avoid race conditions
        for (const name of serviceNames) {
          // Get the service that was initialized by libp2p
          const service = components[name]
  
          if (service != null) {
            try {
              // Protect the service with middleware
              // eslint-disable-next-line no-console
              console.log(`🛡️ Protecting service ${name} with authentication`)
              await middleware.protectService(name, service, options.authOptions?.[name])
              // eslint-disable-next-line no-console
              console.log(`✅ Service ${name} protected successfully`)
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error(`❌ Error protecting service ${name}:`, err)
            }
  
            // Add a small delay between service protection to reduce contention
            await new Promise(resolve => setTimeout(resolve, 20))
          } else {
            // eslint-disable-next-line no-console
            console.warn(`⚠️ Service ${name} not found for protection`)
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('❌ Failed to initialize protocol middleware:', err)
      }
    })()

    return middleware
  }
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
