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
export interface MiddlewareProviderOptions {}

/**
 * Common interface for authentication providers that can be plugged into the protocol middleware
 */
export interface MiddlewareProvider extends Startable {
  /**
   * Unique identifier for this authentication provider
   */
  readonly id: string

  /**
   * Human-readable name for this authentication provider
   */
  readonly name: string

  /**
   * Wrap a connection using this provider's method
   */
  wrap(connectionId: string, options?: AbortOptions): Promise<boolean>

  /**
   * Check if a connection is wrapped with this provider
   */
  isWrapped(connectionId: string): boolean
}

/**
 * Components needed by middleware providers
 */
export interface MiddlewareProviderComponents {
  registrar: Registrar
  connectionManager: ConnectionManager
  logger: ComponentLogger
}
