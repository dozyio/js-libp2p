/**
 * @packageDocumentation
 *
 * The challenge-response authentication provider implements a challenge-response
 * authentication protocol for the libp2p protocol middleware. It allows verifying that
 * the remote peer controls the private key corresponding to their peer ID.
 *
 * @example
 *
 * ```typescript
 * import { createLibp2p } from 'libp2p'
 * import { createProtocolMiddleware } from '@libp2p/protocol-middleware'
 * import { challengeResponseProvider } from '@libp2p/middleware-auth-challenge'
 * import { ping } from '@libp2p/ping'
 *
 * const node = await createLibp2p({
 *   services: {
 *     ping: ping(),
 *     // Initialize protocol middleware with challenge-response provider
 *     protocolMiddleware: createProtocolMiddleware({
 *       provider: challengeResponseProvider({
 *         timeout: 5000 // 5 second timeout
 *       }),
 *       protectedServices: {
 *         ping: ping()
 *       }
 *     })
 *   }
 * })
 * ```
 */

import { fromString } from 'uint8arrays/from-string'
import { toString } from 'uint8arrays/to-string'
import { AUTH_CHALLENGE_PROTOCOL, CHALLENGE_SIZE, MAX_INBOUND_STREAMS, MAX_OUTBOUND_STREAMS, TIMEOUT } from './constants.js'
import type { AbortOptions } from '@libp2p/interface'

// We only need a minimal interface for connection manager in this module
interface ConnectionManager {
  getConnections(): any[]
}

// Define a minimally compatible logger interface
interface Logger {
  error(...args: any[]): void
  info(...args: any[]): void
  debug(...args: any[]): void
  trace(...args: any[]): void
  enabled: boolean
  // Allow calling the logger directly
  (...args: any[]): void
}

interface ComponentLogger {
  forComponent(name: string): Logger
}

// Provider factory options
export interface ChallengeResponseProviderOptions {
  /**
   * How long to wait for challenge responses (in ms)
   */
  timeout?: number

  /**
   * Protocol prefix to use
   */
  protocolPrefix?: string

  /**
   * Maximum number of inbound streams
   */
  maxInboundStreams?: number

  /**
   * Maximum number of outbound streams
   */
  maxOutboundStreams?: number

  /**
   * If true, automatically try to authenticate connections
   * when they access protected services
   */
  autoAuthenticate?: boolean
}

// Define the authentication provider interface locally to match protocol-middleware
// This avoids circular dependencies
interface ProtocolAuthenticationProvider {
  readonly id: string
  readonly name: string
  start(): Promise<void>
  stop(): Promise<void>
  isStarted(): boolean
  authenticate(connectionId: string, options?: AbortOptions): Promise<boolean>
  isAuthenticated(connectionId: string): boolean
}

/**
 * Create a challenge-response authentication provider for use with the protocol middleware
 */
export interface ChallengeResponseProviderComponents {
  connectionManager: ConnectionManager
  registrar: any
  logger: ComponentLogger
}

// This returns a provider class that implements the AuthenticationProvider interface
// It now directly implements the interface expected by the middleware
export function challengeResponseProvider (options: ChallengeResponseProviderOptions = {}): ProtocolAuthenticationProvider & { components?: any } {
  // Create initial state that persists between calls
  const authenticatedConnections = new Set<string>()
  let started = false
  let components: any

  // Configure options
  const authTimeout = options.timeout ?? TIMEOUT
  // const protocolPrefix = options.protocolPrefix ?? 'libp2p' // Currently unused but kept for future use
  const maxInboundStreams = options.maxInboundStreams ?? MAX_INBOUND_STREAMS
  const maxOutboundStreams = options.maxOutboundStreams ?? MAX_OUTBOUND_STREAMS

  // Handle inbound auth challenge streams
  async function handleAuthChallengeRequest ({ stream, connection }: { stream: any, connection: any }): Promise<void> {
    if (!started) {
      stream.close()
      return
    }

    // If we don't have components yet, we can't handle challenges
    if (components == null) {
      // Using console.warn is intentional here for diagnostic purposes
      // eslint-disable-next-line no-console
      console.warn('Challenge-response provider received a challenge but has no components')
      stream.close()
      return
    }

    const log = components.logger.forComponent('libp2p:middleware-auth-challenge')

    try {
      log(`Received auth challenge request from ${connection.remotePeer.toString()}`)

      // Read the challenge from the stream
      const chunks = []
      // eslint-disable-next-line no-unreachable-loop
      for await (const chunk of stream.source) {
        chunks.push(chunk)
        // Only need one chunk for the challenge - intentionally breaking after first chunk
        break
      }

      if (chunks.length === 0) {
        log.error(`No challenge received from peer ${connection.remotePeer.toString()}`)
        stream.close()
        return
      }

      // Convert the challenge to a string - handle different Uint8Array types
      const challenge = toString(new Uint8Array(chunks[0]))
      log(`Received challenge: ${challenge}`)

      // Calculate the response (SHA-256 hash of the challenge)
      const response = await calculateSha256(challenge)
      log(`Sending response: ${response}`)

      // Send the response back to the remote peer
      await stream.sink([fromString(response, 'hex')])

      // Close the stream
      stream.close()

      log(`Completed authentication with peer ${connection.remotePeer.toString()}`)
    } catch (err: any) {
      log.error(`Error handling auth challenge from ${connection.remotePeer.toString()}: ${err.message}`)
      stream.close()
    }
  }

  // Return a provider that directly implements the protocol-middleware interface
  return {
    // Required properties from AuthenticationProvider interface
    id: 'challenge-response',
    name: 'Challenge Response Authentication',

    // Implementation of Startable interface
    async start (): Promise<void> {
      if (started) return

      // The middleware will pass components to us as a property of this object
      // Check if components are available
      if ((this as any).components == null) {
        throw new Error('Cannot start challenge-response provider without components')
      }

      // Use the components passed by the middleware
      components = (this as any).components

      const log = components.logger.forComponent('libp2p:middleware-auth-challenge')

      // Check if the protocol is already registered before trying to register it
      try {
        // Try to get existing handler first
        components.registrar.getHandler(AUTH_CHALLENGE_PROTOCOL)
        // If we get here, the protocol is already registered
        log(`Protocol ${AUTH_CHALLENGE_PROTOCOL} already registered, skipping`)
      } catch (err: any) {
        // If it's an UnhandledProtocolError, that means we need to register it
        if (err.name === 'UnhandledProtocolError') {
          // Register the protocol handler for responding to challenges
          await components.registrar.handle(AUTH_CHALLENGE_PROTOCOL, handleAuthChallengeRequest, {
            maxInboundStreams,
            maxOutboundStreams
          })
          log(`Registered handler for ${AUTH_CHALLENGE_PROTOCOL}`)
        } else {
          // Unexpected error, rethrow it
          throw err
        }
      }

      log(`Started challenge-response auth provider with protocol ${AUTH_CHALLENGE_PROTOCOL}`)
      started = true
    },

    async stop (): Promise<void> {
      if (!started || components == null) return

      const log = components.logger.forComponent('libp2p:middleware-auth-challenge')

      // Unregister the protocol handler
      try {
        // Make sure the protocol is registered before trying to unregister it
        components.registrar.getHandler(AUTH_CHALLENGE_PROTOCOL)
        // If we get here, the protocol is registered, so we can unregister it
        await components.registrar.unhandle(AUTH_CHALLENGE_PROTOCOL)
        log(`Unregistered handler for ${AUTH_CHALLENGE_PROTOCOL}`)
      } catch (err: any) {
        // If it's an UnhandledProtocolError, the protocol is already unregistered
        if (err.name === 'UnhandledProtocolError') {
          log(`Protocol ${AUTH_CHALLENGE_PROTOCOL} already unregistered, skipping`)
        } else {
          // Unexpected error, log but don't throw (allow cleanup to continue)
          log.error(`Error unregistering protocol ${AUTH_CHALLENGE_PROTOCOL}: ${err.message}`)
        }
      }

      authenticatedConnections.clear()
      started = false

      log('Stopped challenge-response auth provider')
    },

    isStarted (): boolean {
      return started
    },

    // Authentication methods
    async authenticate (connectionId: string, abortOptions?: AbortOptions): Promise<boolean> {
      if (!started) return false

      if (components == null) {
        throw new Error('Challenge-response provider has no components')
      }

      const log = components.logger.forComponent('libp2p:middleware-auth-challenge')

      // If already authenticated, return true
      if (authenticatedConnections.has(connectionId)) {
        return true
      }

      try {
        // Create abort controller for timeout
        const abortController = new AbortController()
        const timeoutId = setTimeout(() => {
          abortController.abort(new Error(`Authentication timed out after ${authTimeout}ms`))
        }, authTimeout)

        // Merge with any user-provided abort controller
        let signal = abortController.signal
        // If user provided a signal, check if it's already aborted
        if (abortOptions?.signal != null) {
          if (abortOptions.signal.aborted || abortController.signal.aborted) {
            // If either signal is aborted, create an aborted signal
            signal = AbortSignal.abort()
          }
        }

        try {
          // Generate a random challenge string
          const challenge = generateRandomString(CHALLENGE_SIZE)
          log(`Generated challenge for connection ${connectionId.slice(0, 8)}: ${challenge}`)

          // Calculate the expected response (SHA-256 hash of the challenge)
          const expectedResponse = await calculateSha256(challenge)
          log(`Expected response for validation: ${expectedResponse}`)

          // Get the connection from the connection manager
          const connection = components.connectionManager.getConnections()
            .find((conn: any) => conn.id === connectionId)
          if (connection == null) {
            throw new Error(`Connection ${connectionId} not found`)
          }

          // Open a stream to the remote peer using the auth challenge protocol
          log(`Opening authentication stream to peer ${connection.remotePeer.toString()}`)
          const stream = await connection.newStream(AUTH_CHALLENGE_PROTOCOL, { signal })

          // Set up cleanup to ensure we always close the stream
          let streamClosed = false
          const closeStream = async (): Promise<void> => {
            if (!streamClosed) {
              try {
                await stream.close()
                streamClosed = true
              } catch (err) {
                // Ignore errors on close
              }
            }
          }

          try {
            // Send the challenge to the remote peer
            log(`Sending challenge to peer ${connection.remotePeer.toString()}`)
            await stream.sink([fromString(challenge)])

            // Read the response from the remote peer
            log(`Waiting for response from peer ${connection.remotePeer.toString()}`)

            // Read the response as a single chunk
            const responseChunks = []
            // eslint-disable-next-line no-unreachable-loop
            for await (const chunk of stream.source) {
              responseChunks.push(chunk)
              // Only need one chunk for the response - intentionally breaking after first chunk
              break
            }

            // Close the stream now that we've received the response
            await closeStream()

            // Process the response if we got one
            if (responseChunks.length === 0) {
              log(`No response received from peer ${connection.remotePeer.toString()}`)
              return false
            }

            // Convert the response to a string - handle different Uint8Array types
            const actualResponse = toString(new Uint8Array(responseChunks[0]), 'hex')
            log(`Received response: ${actualResponse}`)

            // Verify the response against the expected value
            const authenticated = actualResponse === expectedResponse

            // If authentication was successful, add to authenticated connections
            if (authenticated) {
              authenticatedConnections.add(connectionId)
              log(`Connection ${connectionId.slice(0, 8)} authenticated successfully`)
              return true
            } else {
              log(`Connection ${connectionId.slice(0, 8)} authentication failed: Invalid response`)
              return false
            }
          } catch (err) {
            // Ensure stream is closed in case of error
            await closeStream()
            throw err
          }
        } finally {
          // Clear timeout
          clearTimeout(timeoutId)
        }
      } catch (err: any) {
        log.error(`Authentication error for connection ${connectionId.slice(0, 8)}: ${err.message}`)
        return false
      }
    },

    isAuthenticated (connectionId: string): boolean {
      if (!started) return false

      if (components == null) {
        throw new Error('Challenge-response provider has no components')
      }

      return authenticatedConnections.has(connectionId)
    }
  }
}

/**
 * Generate a random string of specified length
 */
function generateRandomString (length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const randomValues = new Uint8Array(length)
  crypto.getRandomValues(randomValues)

  for (let i = 0; i < length; i++) {
    result += chars.charAt(randomValues[i] % chars.length)
  }

  return result
}

/**
 * Calculate SHA-256 hash of a string
 */
async function calculateSha256 (input: string): Promise<string> {
  const data = fromString(input)

  // Use the Web Crypto API directly to calculate the SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)

  return toString(hashArray, 'hex')
}

// Re-export the protocol constant
export { AUTH_CHALLENGE_PROTOCOL } from './constants.js'
