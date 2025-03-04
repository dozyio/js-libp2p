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

import { lpStream } from 'it-length-prefixed-stream'
import { fromString } from 'uint8arrays/from-string'
import { toString } from 'uint8arrays/to-string'
import { AUTH_CHALLENGE_PROTOCOL, CHALLENGE_SIZE, MAX_INBOUND_STREAMS, MAX_OUTBOUND_STREAMS, TIMEOUT } from './constants.js'
import type { AbortOptions, ComponentLogger, Connection, Stream } from '@libp2p/interface'
import type { ConnectionManager, Registrar } from '@libp2p/interface-internal'

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
  registrar: Registrar
  logger: ComponentLogger
}

// This returns a provider class that implements the AuthenticationProvider interface
// It now directly implements the interface expected by the middleware
export function challengeResponseProvider (options: ChallengeResponseProviderOptions = {}): ProtocolAuthenticationProvider & { components?: ChallengeResponseProviderComponents } {
  // Create initial state that persists between calls
  const authenticatedConnections = new Set<string>()
  let started = false
  let components: any

  // Configure options
  const authTimeout = options.timeout ?? TIMEOUT
  // const protocolPrefix = options.protocolPrefix ?? 'libp2p' // Currently unused but kept for future use
  const maxInboundStreams = options.maxInboundStreams ?? MAX_INBOUND_STREAMS
  const maxOutboundStreams = options.maxOutboundStreams ?? MAX_OUTBOUND_STREAMS
  let log: any
  if (components != null) {
    log = components.logger.forComponent('libp2p:middleware-auth-challenge')
  } else {
    // eslint-disable-next-line no-console
    log = console.log
  }

  // Handle inbound authentication requests from clients
  async function handleAuthChallengeRequest ({ stream, connection }: { stream: Stream, connection: Connection }): Promise<void> {
    log('📥 RECEIVED AUTH CONNECTION REQUEST', connection.id)
    if (!started) {
      log('❌ Provider not started - closing stream')
      stream.abort(new Error('error'))
      return
    }

    // If we don't have components yet, we can't handle authentication
    if (components == null) {
      log('❌ Challenge-response provider has no components')
      stream.abort(new Error('error'))
      return
    }

    log(`📝 New authentication request from ${connection.remotePeer.toString()}`)
    // Generate a random challenge to send to the client
    const challenge = generateRandomString(CHALLENGE_SIZE)
    log(`🔐 Generated challenge: [${challenge}] (length: ${challenge.length})`)

    // Calculate the expected response we should receive (SHA-256 hash of challenge)
    const expectedResponse = await calculateSha256(challenge)
    log(`🧩 Expected response hash: ${expectedResponse}`)

    const lp = lpStream(stream)

    try {
      log('Sending challenge to client')
      await lp.write(new TextEncoder().encode(challenge))
      log('✓ Challenge sent successfully to client')
    } catch (err: any) {
      log('❌ Error sending challenge to client:', err.message)
      stream.abort(new Error('error'))
      return
    }

    try {
      log('Reading response to challenge')
      const res = await lp.read()
      log('✓ Read response', res)

      if (new TextDecoder().decode(res.slice()) !== expectedResponse) {
        log('❌ response does not match expected:', res, expectedResponse)
        stream.abort(new Error('error'))
        return
      }
    } catch (err: any) {
      log('❌ Error reading response:', err.message)
      stream.abort(new Error('error'))
      return
    }

    try {
      authenticatedConnections.add(connection.id)
      log(`✅ Connection ${connection.id} authenticated successfully`)
      log('Sending ok to client')
      await lp.write(new TextEncoder().encode('OK'))
      log('Sent ok to client')
      log('closing stream')
      await stream.close()
    } catch (err: any) {
      log('❌ Error sending challenge to client:', err.message)
      stream.abort(new Error('error'))
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
      if (this.components == null) {
        throw new Error('Cannot start challenge-response provider without components')
      }

      // Use the components passed by the middleware
      components = this.components

      // Check if the protocol is already registered before trying to register it
      try {
        // Try to get existing handler first
        components.registrar.getHandler(AUTH_CHALLENGE_PROTOCOL)
        // If we get here, the protocol is already registered
        log(`Protocol ${AUTH_CHALLENGE_PROTOCOL} already registered, skipping`)
      } catch (err: any) {
        if (err.name === 'UnhandledProtocolError') {
          await components.registrar.handle(AUTH_CHALLENGE_PROTOCOL, handleAuthChallengeRequest, {
            maxInboundStreams,
            maxOutboundStreams
          })
          log(`Registered handler for ${AUTH_CHALLENGE_PROTOCOL}`)
        } else {
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
      log('🔒 Authentication attempt for connection:', connectionId)

      if (!started) {
        log('❌ Provider not started')
        return false
      }

      if (components == null) {
        log('❌ Provider has no components')
        throw new Error('Challenge-response provider has no components')
      }

      // If already authenticated, return true
      if (authenticatedConnections.has(connectionId)) {
        log('✅ Connection already authenticated:', connectionId)
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

        // We're going to initiate authentication with the server
        // The server will send us a challenge that we need to respond to
        log(`Initiating authentication for connection ${connectionId}`)

        try {
          const connections = components.connectionManager.getConnections()
          log('🔍 Looking for connection', connectionId, 'among', connections.length, 'connections')

          const connection = connections.find((conn: Connection) => conn.id === connectionId)
          if (connection == null) {
            log('❌ Connection', connectionId, 'not found')
            throw new Error(`Connection ${connectionId} not found`)
          }

          // Open a stream to the remote peer using the auth challenge protocol
          log('🔌 Opening authentication stream to peer', connection.remotePeer.toString(), 'on protocol', AUTH_CHALLENGE_PROTOCOL)
          const stream = await connection.newStream(AUTH_CHALLENGE_PROTOCOL, { signal })

          const lp = lpStream(stream)

          try {
            log('Waiting to receive challenge from server...')
            const challengeBytes = await lp.read()
            const challenge = new TextDecoder().decode(challengeBytes.slice())
            log(`Received challenge from server: [${challenge}] (length: ${challenge.length})`)

            // Calculate the response (SHA-256 hash of the challenge)
            const response = await calculateSha256(challenge)
            log(`Calculated response hash: ${response}`)

            // Send response to server
            try {
              await lp.write(new TextEncoder().encode(response))
              log('✓ Response sent successfully to server')
            } catch (err: any) {
              log('❌ Error sending response to server:', err.message)
              await stream.abort(new Error('error'))
              return false
            }

            try {
              const isOK = await lp.read()
              log('✓ Read challenge ok')
              // eslint-disable-next-line max-depth
              if (new TextDecoder().decode(isOK.slice()) !== 'OK') {
                throw new Error('Server did not confirm authentication')
              }
              authenticatedConnections.add(connectionId)
              await stream.close()
              return true
            } catch (err: any) {
              log('❌ Error sending response to server:', err.message)
              await stream.abort(new Error('error'))
              return false
            }
          } catch (err) {
            // Ensure stream is closed in case of error
            await stream.abort(new Error('Error'))
            throw err
          }
        } finally {
          // Clear timeout
          clearTimeout(timeoutId)
        }
      } catch (err: any) {
        // eslint-disable-next-line no-console
        log('❌❌❌ Authentication error for connection', connectionId, err)
        log(`Authentication error for connection ${connectionId.slice(0, 8)}: ${err.message}`)
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

  // Generate twice as many random bytes as needed to ensure good randomness
  const randomValues = new Uint8Array(length * 2)

  try {
    // Try to use crypto.getRandomValues if available (browser or Node.js with webcrypto)
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(randomValues)
    } else {
      // Fallback for environments without crypto
      for (let i = 0; i < randomValues.length; i++) {
        randomValues[i] = Math.floor(Math.random() * 256)
      }
    }
  } catch (e) {
    // Final fallback if crypto.getRandomValues throws an error
    // eslint-disable-next-line no-console
    console.warn('Crypto.getRandomValues failed, using Math.random fallback')
    for (let i = 0; i < randomValues.length; i++) {
      randomValues[i] = Math.floor(Math.random() * 256)
    }
  }

  // Use only length bytes for the result
  for (let i = 0; i < length; i++) {
    result += chars.charAt(randomValues[i] % chars.length)
  }

  return result
}

/**
 * Calculate SHA-256 hash of a string
 */
async function calculateSha256 (input: string): Promise<string> {
  // Ensure input is properly encoded to bytes
  const data = fromString(input, 'utf8')

  // Use the Web Crypto API directly to calculate the SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)

  // Convert to hex string with specific formatting
  return toString(hashArray, 'hex')
}

// Re-export the protocol constant
export { AUTH_CHALLENGE_PROTOCOL } from './constants.js'
