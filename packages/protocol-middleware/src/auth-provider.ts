import type { AbortOptions, Startable } from '@libp2p/interface'
import type { ConnectionManager, Registrar } from '@libp2p/interface-internal'
import type { ComponentLogger } from '@libp2p/logger'

/**
 * Base options for authentication providers
 */
export interface AuthProviderOptions {
  /**
   * If true, automatically try to authenticate connections when they access protected services
   */
  autoAuthenticate?: boolean
}

/**
 * Common interface for authentication providers
 */
export interface AuthProvider extends Startable {
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
export interface AuthProviderComponents {
  registrar: Registrar
  connectionManager: ConnectionManager
  logger: ComponentLogger
}
