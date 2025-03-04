import type { AbortOptions, Startable } from '@libp2p/interface'
import type { ConnectionManager, Registrar } from '@libp2p/interface-internal'
import type { ComponentLogger } from '@libp2p/logger'

/**
 * @packageDocumentation
 * Authentication provider interfaces for the protocol middleware
 */

/**
 * Base options for authentication providers
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AuthenticationProviderOptions {}

/**
 * Common interface for authentication providers that can be plugged into the protocol middleware
 */
export interface AuthenticationProvider extends Startable {
  /**
   * Unique identifier for this authentication provider
   */
  readonly id: string

  /**
   * Human-readable name for this authentication provider
   */
  readonly name: string

  /**
   * Authenticate a connection using this provider's method
   */
  authenticate(connectionId: string, options?: AbortOptions): Promise<boolean>

  /**
   * Check if a connection is authenticated with this provider
   */
  isAuthenticated(connectionId: string): boolean
}

/**
 * Components needed by authentication providers
 */
export interface AuthenticationProviderComponents {
  registrar: Registrar
  connectionManager: ConnectionManager
  logger: ComponentLogger
}
