import type { ProtocolMiddlewareService } from './protocol-middleware-service.js'
import type { IncomingStreamData, Connection, StreamHandler, Startable, AbortOptions, ComponentLogger } from '@libp2p/interface'
import type { ConnectionManager, Registrar } from '@libp2p/interface-internal'

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

/**
 * Options for the middleware wrapper
 */
export interface MiddlewareWrapperOptions {
  /**
   * Custom function to check additional authorization requirements beyond authentication
   */
  authorize?(connection: Connection): Promise<boolean>
}

/**
 * Creates a middleware wrapper that enforces authentication for protocol handlers
 */
export function createMiddlewareWrapper (
  authService: ProtocolMiddlewareService,
  handler: StreamHandler,
  options: MiddlewareWrapperOptions = {}
): StreamHandler {
  return (data: IncomingStreamData): void => {
    const { connection, stream } = data
    void (async () => {
      if (!authService.isWrapped(connection.id)) {
        try {
          const isWrapped = await authService.wrap(connection.id)
          if (!isWrapped) {
            throw new Error('Connection not authenticated')
          }
          if (options.authorize != null) {
            const authorized = await options.authorize(connection)
            if (!authorized) {
              throw new Error('Connection not authorized')
            }
          }
          // Proceed with the original handler if authentication and authorization pass
          handler(data)
        } catch (err: any) {
          const errorMessage = (typeof err.message === 'string' && err.message.length > 0)
            ? err.message
            : 'Authentication process failed'
          stream.abort(new Error(errorMessage))
        }
      } else if (options.authorize != null) {
        // Handle the case where the connection is already authenticated but authorization is needed
        try {
          const authorized = await options.authorize(connection)
          if (!authorized) {
            throw new Error('Connection not authorized')
          }
          handler(data)
        } catch (err: any) {
          const errorMessage = (typeof err.message === 'string' && err.message.length > 0)
            ? err.message
            : 'Authorization process failed'
          stream.abort(new Error(`Authorization error: ${errorMessage}`))
        }
      } else {
        // Already authenticated and no authorization required
        handler(data)
      }
    })()
  }
}
