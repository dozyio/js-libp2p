/**
 * Type definitions for protocol middleware
 */

/**
 * Provider of middleware functionality
 */
export interface MiddlewareProvider {
  /**
   * Unique identifier for this provider
   */
  id: string

  /**
   * Human-readable name for this provider
   */
  name: string

  /**
   * Start the provider
   */
  start(): Promise<void>

  /**
   * Stop the provider
   */
  stop(): Promise<void>

  /**
   * Check if the provider is started
   */
  isStarted(): boolean

  /**
   * Wrap a connection with middleware
   */
  wrap(connectionId: string): Promise<boolean>

  /**
   * Check if a connection is already wrapped
   */
  isWrapped(connectionId: string): boolean
}

/**
 * Options for middleware wrapping
 */
export type MiddlewareWrapperOptions = Record<string, any>
