/**
 * Provider of middleware functionality
 */
export interface Middleware {
  // protocol string
  protocol: string

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
   * Decorate a connection with middleware
   */
  decorate(connectionId: string): Promise<boolean>

  /**
   * Check if a connection is already decorated
   */
  isDecorated(connectionId: string): boolean
}

/**
 * Options for middleware decorator
 */
export type MiddlewareDecoratorOptions = Record<string, any>
