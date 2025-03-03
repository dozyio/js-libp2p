import type { ProtocolMiddlewareService } from './protocol-middleware-service.js'
import type { IncomingStreamData, Connection } from '@libp2p/interface'
import type { StreamHandler } from '@libp2p/interface-internal'

/**
 * Options for the middleware wrapper
 */
export interface MiddlewareWrapperOptions {
  /**
   * Whether to attempt authentication on unauthenticated connections
   */
  autoAuthenticate?: boolean

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

    // Check if connection is authenticated
    const authenticated = authService.isAuthenticated(connection.id)

    // If not authenticated but autoAuthenticate is enabled, try to authenticate
    if (!authenticated && options.autoAuthenticate === true) {
      // Start authentication process but don't wait for it
      // This creates a Promise chain but doesn't block the current function
      void authService.authenticate(connection.id)
        .then(async isAuthenticated => {
          if (!isAuthenticated) {
            const err = new Error('Connection not authenticated')
            stream.abort(err)
            return
          }

          // Check additional authorization if provided
          if (options.authorize != null) {
            return options.authorize(connection)
              .then(authorized => {
                if (!authorized) {
                  const err = new Error('Connection not authorized')
                  stream.abort(err)
                  return false
                }
                return true
              })
              .catch(err => {
                const error = new Error(`Authorization error: ${err.message}`)
                stream.abort(error)
                return false
              })
          }

          return true
        })
        .then(shouldContinue => {
          // If authenticated and authorized, proceed with the original handler
          if (shouldContinue === true) {
            handler(data)
          }
        })
        .catch(() => {
          // If any errors occur in the Promise chain, abort the stream
          stream.abort(new Error('Authentication process failed'))
        })
      return
    }

    // If not authenticated and autoAuthenticate is false, reject immediately
    if (!authenticated) {
      const err = new Error('Connection not authenticated')
      stream.abort(err)
      return
    }

    // If already authenticated, check additional authorization if provided
    if (options.authorize != null) {
      // Start authorization process but don't wait for it
      void options.authorize(connection)
        .then(authorized => {
          if (!authorized) {
            const err = new Error('Connection not authorized')
            stream.abort(err)
            return
          }
          // If authorized, proceed with the original handler
          handler(data)
        })
        .catch(err => {
          const error = new Error(`Authorization error: ${err.message}`)
          stream.abort(error)
        })
      return
    }

    // If already authenticated and no authorization needed, proceed directly
    handler(data)
  }
}
