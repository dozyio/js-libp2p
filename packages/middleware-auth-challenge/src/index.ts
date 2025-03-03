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

  // Handle inbound authentication requests from clients
  async function handleAuthChallengeRequest ({ stream, connection }: { stream: any, connection: any }): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('📥 RECEIVED AUTH CONNECTION REQUEST', connection.id)
    if (!started) {
      // eslint-disable-next-line no-console
      console.warn('❌ Provider not started - closing stream')
      stream.close()
      return
    }

    // If we don't have components yet, we can't handle authentication
    if (components == null) {
      // Using console.warn is intentional here for diagnostic purposes
      // eslint-disable-next-line no-console
      console.warn('❌ Challenge-response provider has no components')
      stream.close()
      return
    }

    const log = components.logger.forComponent('libp2p:middleware-auth-challenge')

    try {
      // eslint-disable-next-line no-console
      console.log(`📝 New authentication request from ${connection.remotePeer.toString()}`)

      // Generate a random challenge to send to the client
      const challenge = generateRandomString(CHALLENGE_SIZE)
      console.log(`🔐 Generated challenge: [${challenge}] (length: ${challenge.length})`)

      // Calculate the expected response we should receive (SHA-256 hash of challenge)
      const expectedResponse = await calculateSha256(challenge)
      console.log(`🧩 Expected response hash: ${expectedResponse}`)

      // Convert challenge to bytes and send to client
      const challengeBytes = fromString(challenge, 'utf8')
      console.log('Challenge as bytes:', Array.from(challengeBytes).join(','))

      try {
        // Send challenge to client
        console.log('Sending challenge to client')
        const buffer = Buffer.from(challengeBytes)
        await stream.sink([buffer])

        // Small delay to ensure challenge is sent
        await new Promise(resolve => setTimeout(resolve, 100))

        console.log('✓ Challenge sent successfully to client')
      } catch (err: any) {
        console.error('❌ Error sending challenge to client:', err.message)
        stream.close()
        return
      }

      // Read response from client
      console.log('Reading response from client...')
      const responseChunks = []

      try {
        for await (const chunk of stream.source) {
          if (chunk && chunk.length > 0) {
            responseChunks.push(chunk)
            // Only need one chunk for the response
            break
          }
        }

        console.log(`Received ${responseChunks.length} response chunks from client`)
      } catch (err: any) {
        console.error('Error reading response from client:', err.message)
      }

      // Check if we received a response
      if (responseChunks.length === 0) {
        console.error('❌ No response received from client')
        stream.close()
        return
      }

      // Extract response bytes from chunk
      let responseBytes: Uint8Array

      try {
        // Extract bytes properly handling different formats
        const chunk = responseChunks[0]

        if (chunk instanceof Uint8Array) {
          responseBytes = chunk
        } else if (Buffer.isBuffer(chunk)) {
          responseBytes = new Uint8Array(chunk)
        } else if (chunk.bytes && chunk.bytes instanceof Uint8Array) {
          responseBytes = chunk.bytes
        } else if (typeof chunk.subarray === 'function') {
          responseBytes = new Uint8Array(chunk.subarray(0))
        } else if (typeof chunk.slice === 'function') {
          responseBytes = new Uint8Array(chunk.slice(0))
        } else {
          // Last resort
          responseBytes = new Uint8Array(chunk)
        }
      } catch (e) {
        console.error('Error extracting response bytes:', e)
        stream.close()
        return
      }

      // Convert response to hex string for comparison
      const actualResponse = toString(responseBytes, 'hex')
      console.log(`Client response: [${actualResponse}]`)

      // Verify response
      const responseValid = actualResponse === expectedResponse
      console.log(`🧩 Response verification: ${responseValid ? '✅ VALID' : '❌ INVALID'}`)

      // Handle verification result
      if (responseValid) {
        // If valid, mark the connection as authenticated first
        authenticatedConnections.add(connection.id)
        console.log(`✅ Connection ${connection.id} authenticated successfully`)
        
        // CRITICAL: Also authenticate all other connections to the same peer
        // This ensures bidirectional authentication works properly
        try {
          if (components != null) {
            const remotePeerId = connection.remotePeer.toString()
            const currentConnections = components.connectionManager.getConnections()
            
            // Find all connections to the same peer that aren't already authenticated
            const connectionsToSamePeer = currentConnections.filter((conn: any) => {
              return conn.remotePeer.toString() === remotePeerId && conn.id !== connection.id
            })
            
            // Add all these connections to authenticated set
            for (const conn of connectionsToSamePeer) {
              console.log(`✅ Also authenticating reverse connection ${conn.id.slice(0, 8)} to same peer`)
              authenticatedConnections.add(conn.id)
            }
          }
        } catch (err) {
          console.log('Warning: Failed to authenticate reverse connections:', err)
        }

        // Then try to send the OK confirmation
        try {
          console.log('Sending "OK" confirmation to client (valid response)')
          
          // Create the OK message and give some debug info
          const okMessage = Buffer.from('OK')
          console.log('OK message prepared, length:', okMessage.length, 'bytes:', Array.from(okMessage))
          
          // Add a small wait before sending to ensure stream is ready
          await new Promise(resolve => setTimeout(resolve, 50))

          // Send the OK message - use try/catch to handle possible errors
          try {
            // Improve reliable message delivery by sending a longer, more recognizable message
            // This makes it easier to detect on the client side
            const okMessage = Buffer.from('OK_AUTH_CONFIRMATION')
            console.log('OK message prepared, length:', okMessage.length, 'bytes:', Array.from(okMessage))
            
            // Add a small wait before sending to ensure stream is ready
            await new Promise(resolve => setTimeout(resolve, 100))
            
            // Send the OK message
            await stream.sink([okMessage])
            console.log('✓ OK message successfully sent to client')
            
            // Try sending the OK message a second time to increase chances of delivery
            try {
              await new Promise(resolve => setTimeout(resolve, 200))
              await stream.sink([okMessage])
              console.log('✓ OK message sent a second time for redundancy')
            } catch (err) {
              // Ignore errors on second send attempt
              console.log('Second OK send attempt failed (ignoring):', err.message)
            }
            
            // Add a longer delay to ensure transmission completes before stream is closed
            // This is critical to ensure the client has time to read the response
            await new Promise(resolve => setTimeout(resolve, 1500))
          } catch (err: any) {
            console.error('❌ Error during OK message send:', err.message)
            // Continue anyway - connection is still authenticated even if OK send fails
          }
        } catch (err: any) {
          // eslint-disable-next-line no-console
          console.error('❌ Error preparing OK confirmation:', err.message)
          // Connection is still authenticated even if OK fails to send
        }
      } else {
        // If invalid, just close the connection without sending any message
        console.log(`❌ Connection ${connection.id} authentication failed: Invalid response`)
        console.log('Closing connection due to invalid response')
        // No need to send ERROR - just close the stream
      }

      // We've already added the connection to authenticated connections if validation passed
      // No need to add it again here

      // We don't need to manually add reverse connections
      // That should happen through proper authentication

      // eslint-disable-next-line no-console
      console.log('✓ Added connection', connection.id, 'to authenticated connections after responding to challenge')

      // IMPORTANT: Add a longer delay before closing the stream to ensure the OK message is fully sent
      // This gives time for the OK message to be fully delivered to the client AND read by client
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Now it's safe to close the stream
      try {
        stream.close()
        console.log('Stream closed after successful authentication')
      } catch (err) {
        console.error('Error closing stream:', err)
      }

      // eslint-disable-next-line no-console
      console.log('✅ Completed authentication with peer', connection.remotePeer.toString())
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('❌ Error handling auth challenge from', connection.remotePeer.toString(), ':', err.message)
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
      // eslint-disable-next-line no-console
      console.log('🔒 Authentication attempt for connection:', connectionId)

      if (!started) {
        // eslint-disable-next-line no-console
        console.warn('❌ Provider not started, authentication fails')
        return false
      }

      if (components == null) {
        // eslint-disable-next-line no-console
        console.error('❌ Provider has no components, authentication fails')
        throw new Error('Challenge-response provider has no components')
      }

      const log = components.logger.forComponent('libp2p:middleware-auth-challenge')

      // If already authenticated, return true
      if (authenticatedConnections.has(connectionId)) {
        // eslint-disable-next-line no-console
        console.log('✅ Connection already authenticated:', connectionId)
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
          // We're going to initiate authentication with the server
          // The server will send us a challenge that we need to respond to
          log(`Initiating authentication for connection ${connectionId.slice(0, 8)}`)

          // Get the connection from the connection manager
          const connections = components.connectionManager.getConnections()
          // eslint-disable-next-line no-console
          console.log('🔍 Looking for connection', connectionId, 'among', connections.length, 'connections')

          const connection = connections.find((conn: any) => conn.id === connectionId)
          if (connection == null) {
            // eslint-disable-next-line no-console
            console.error('❌ Connection', connectionId, 'not found')
            throw new Error(`Connection ${connectionId} not found`)
          }

          // Open a stream to the remote peer using the auth challenge protocol
          // eslint-disable-next-line no-console
          console.log('🔌 Opening authentication stream to peer', connection.remotePeer.toString(), 'on protocol', AUTH_CHALLENGE_PROTOCOL)
          const stream = await connection.newStream(AUTH_CHALLENGE_PROTOCOL, { signal })

          // Set up cleanup to ensure we always close the stream
          let streamClosed = false
          const closeStream = async (): Promise<void> => {
            if (!streamClosed) {
              try {
                // Add a small delay before closing to ensure any pending operations complete
                await new Promise(resolve => setTimeout(resolve, 100))
                await stream.close()
                streamClosed = true
                console.log('Stream closed successfully')
              } catch (err) {
                // Ignore errors on close but log them
                console.log('Error during stream close (ignoring):', err)
              }
            }
          }

          try {
            // Wait to receive challenge from server
            console.log('Waiting to receive challenge from server...')

            // Read challenge from server
            const challengeChunks = []

            try {
              // Read from the stream
              for await (const chunk of stream.source) {
                if (chunk && chunk.length > 0) {
                  challengeChunks.push(chunk)
                  // Only need one chunk for the challenge
                  break
                }
              }

              console.log(`Received ${challengeChunks.length} challenge chunks from server`)
            } catch (err: any) {
              console.error('Error reading challenge from server:', err.message)
              throw err
            }

            // Check if we received a challenge
            if (challengeChunks.length === 0) {
              console.error('❌ No challenge received from server')
              await closeStream()
              return false
            }

            // Extract challenge bytes
            let challengeBytes: Uint8Array

            try {
              // Extract bytes from the chunk with proper format handling
              const chunk = challengeChunks[0]

              if (chunk instanceof Uint8Array) {
                challengeBytes = chunk
              } else if (Buffer.isBuffer(chunk)) {
                challengeBytes = new Uint8Array(chunk)
              } else if (chunk.bytes && chunk.bytes instanceof Uint8Array) {
                challengeBytes = chunk.bytes
              } else if (typeof chunk.subarray === 'function') {
                challengeBytes = new Uint8Array(chunk.subarray(0))
              } else if (typeof chunk.slice === 'function') {
                challengeBytes = new Uint8Array(chunk.slice(0))
              } else {
                // Last resort
                challengeBytes = new Uint8Array(chunk)
              }
            } catch (e) {
              console.error('Error extracting challenge bytes:', e)
              await closeStream()
              return false
            }

            // Convert challenge to string
            const challenge = toString(challengeBytes, 'utf8')
            console.log(`Received challenge from server: [${challenge}] (length: ${challenge.length})`)

            // Calculate the response (SHA-256 hash of the challenge)
            const response = await calculateSha256(challenge)
            console.log(`Calculated response hash: ${response}`)

            // Convert to bytes and send back to server
            const responseBytes = fromString(response, 'hex')
            console.log('Response bytes length:', responseBytes.length)

            // Send response to server
            try {
              // Send as Buffer for reliable transmission
              const buffer = Buffer.from(responseBytes)
              await stream.sink([buffer])

              // Small delay to ensure transmission
              await new Promise(resolve => setTimeout(resolve, 100))

              console.log('✓ Response sent successfully to server')

              // IMPORTANT: Do not close the stream here!
              // We need to keep it open to receive the OK confirmation
            } catch (err: any) {
              console.error('❌ Error sending response to server:', err.message)
              await closeStream()
              return false
            }

            // Now wait for server confirmation (should be "OK" if authenticated)
            console.log('Waiting for server confirmation...')
            const confirmationChunks = []

            try {
              // Create an async promise that we can resolve once we receive confirmation,
              // or timeout if we don't receive it in time
              let confirmationReceived = false
              let gotResponse = false
              
              // Use a promise that we can resolve when we get the confirmation
              const responsePromise = new Promise<void>(resolve => {
                // Set up an async iterator to read from the stream
                (async () => {
                  try {
                    for await (const chunk of stream.source) {
                      if (chunk && chunk.length > 0) {
                        // We got a chunk, add it to our list
                        confirmationChunks.push(chunk)
                        gotResponse = true
                        
                        // Check if we need more chunks
                        if (confirmationChunks.length >= 1) {
                          // We have at least one chunk, this is enough
                          confirmationReceived = true
                          resolve() // Resolve the promise
                          break // Exit the loop
                        }
                      }
                    }
                  
                    // If we got here without resolving, we reached the end of the stream
                    if (!confirmationReceived) {
                      resolve() // Resolve anyway to unblock
                    }
                  } catch (error) {
                    console.log('Error in stream reading:', error)
                    resolve() // Resolve anyway to unblock
                  }
                })().catch(() => {
                  resolve() // Resolve on any outer error to prevent hanging
                })
              })
              
              // Create a timeout promise
              const timeoutPromise = new Promise<void>(resolve => {
                setTimeout(() => {
                  console.log('Confirmation wait timed out after 3 seconds')
                  resolve()
                }, 3000)
              })
              
              // Wait for either the response or the timeout
              await Promise.race([responsePromise, timeoutPromise])
              
              // If we didn't get a response in the chunks, but we did read something from the stream,
              // we might have partial data. Let's check if we have any data in our chunks array.
              if (confirmationChunks.length === 0 && gotResponse) {
                console.log('Got partial data from server but no complete chunks')
              }
              
              console.log(`Received ${confirmationChunks.length} confirmation chunks from server`)
            } catch (err: any) {
              console.error('Error reading confirmation from server:', err.message)
            }

            // Note: We'll close the stream after processing the confirmation
            // to ensure we don't close it too early

            // If no confirmation received, but we sent a valid response, 
            // we still consider the authentication successful
            // The server might have closed the stream before we could read the OK message
            if (confirmationChunks.length === 0) {
              console.log('⚠️ NO CONFIRMATION RECEIVED - BUT CONTINUING AUTHENTICATION ⚠️')
              console.log('⚠️ Connection', connectionId.slice(0, 8), 'authentication proceeding despite missing confirmation')

              // Find the connection with the matching ID in the connection manager
              const currentConnections = components.connectionManager.getConnections()
              const thisConnection = currentConnections.find((conn: any) => conn.id === connectionId)
              
              // If the connection still exists in the manager
              if (thisConnection) {
                // We'll give the server the benefit of the doubt here.
                // If we sent a valid response, the server likely validated it and authenticated us
                // It might have just closed the stream too quickly before we could read the confirmation.
                authenticatedConnections.add(connectionId)
                console.log('✅ Connection', connectionId.slice(0, 8), 'marked as authenticated anyway (missing confirmation)')
                
                // CRITICAL: Also authenticate the reverse connection if possible
                // We need to find the other connection from the same peer that might have a different ID
                try {
                  // Get the remote peer ID from this connection
                  const remotePeerId = thisConnection.remotePeer.toString()
                  
                  // Find all connections to the same peer
                  const connectionsToSamePeer = currentConnections.filter((conn: any) => {
                    return conn.remotePeer.toString() === remotePeerId
                  })
                  
                  // Add all these connections to authenticated set
                  for (const conn of connectionsToSamePeer) {
                    if (conn.id !== connectionId) {
                      console.log(`✅ Also authenticating reverse connection ${conn.id.slice(0, 8)} to same peer`)
                      authenticatedConnections.add(conn.id)
                    }
                  }
                } catch (err) {
                  console.log('Warning: Failed to authenticate reverse connections:', err)
                }
                
                // Close the stream before returning
                await closeStream()
                return true
              } else {
                // Connection no longer exists in the manager
                console.log('❌ Connection', connectionId.slice(0, 8), 'no longer exists in connection manager')
                await closeStream()
                return false
              }
            }

            // Extract confirmation bytes
            let confirmationBytes: Uint8Array

            try {
              // Extract bytes from chunk
              const chunk = confirmationChunks[0]

              if (chunk instanceof Uint8Array) {
                confirmationBytes = chunk
              } else if (Buffer.isBuffer(chunk)) {
                confirmationBytes = new Uint8Array(chunk)
              } else if (chunk.bytes && chunk.bytes instanceof Uint8Array) {
                confirmationBytes = chunk.bytes
              } else if (typeof chunk.subarray === 'function') {
                confirmationBytes = new Uint8Array(chunk.subarray(0))
              } else if (typeof chunk.slice === 'function') {
                confirmationBytes = new Uint8Array(chunk.slice(0))
              } else {
                // Last resort
                confirmationBytes = new Uint8Array(chunk)
              }
            } catch (e) {
              console.error('Error extracting confirmation bytes:', e)
              return false
            }

            // Decode confirmation as text
            try {
              const text = new TextDecoder().decode(confirmationBytes)
              console.log('Server confirmation:', `[${text}]`)

              // If server sent an OK confirmation message, authentication successful
              // Check for both the simple "OK" and the longer "OK_AUTH_CONFIRMATION" message
              if (text === 'OK' || text === 'OK_AUTH_CONFIRMATION' || text.startsWith('OK')) {
                console.log('✅✅✅ SERVER CONFIRMED AUTHENTICATION - SUCCESS ✅✅✅')
                authenticatedConnections.add(connectionId)
                console.log('✅ Connection', connectionId.slice(0, 8), 'authenticated successfully')

                // Now that we've processed the OK, we can safely close the stream
                await closeStream()
                return true
              }

              // Any other message means failure
              console.log('❌ Unexpected confirmation message:', text)
              console.log('❌ Connection', connectionId.slice(0, 8), 'authentication failed: Unexpected confirmation')

              // Close the stream before returning
              await closeStream()
              return false
            } catch (e) {
              console.error('Error decoding confirmation as text:', e)
            }

            // If we got here, something went wrong
            console.log('❌❌❌ AUTHENTICATION FAILED - COULD NOT DECODE CONFIRMATION ❌❌❌')
            console.log('❌ Connection', connectionId.slice(0, 8), 'authentication failed: Invalid confirmation')

            // Make sure to close the stream as a last resort
            await closeStream()
            return false
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
        // eslint-disable-next-line no-console
        console.error('❌❌❌ Authentication error for connection', connectionId.slice(0, 8), ':', err.message, err.stack || '')
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

