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

import { AUTH_CHALLENGE_PROTOCOL } from './constants.js'
import type { AbortOptions } from '@libp2p/interface'

// Provider factory - implementation will be completed in future PRs
// For now, we just need enough to make TypeScript happy
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

// The actual provider interface only exists in protocol-middleware
export interface AuthenticationProvider {
  id: string
  name: string
  create(components: any): any
}

/**
 * Create a challenge-response authentication provider for use with the protocol middleware
 */
export function challengeResponseProvider (options: ChallengeResponseProviderOptions = {}): AuthenticationProvider {
  return {
    id: 'challenge-response',
    name: 'Challenge Response Authentication',
    create: (components: any): any => {
      return {
        start: async (): Promise<void> => {},
        stop: async (): Promise<void> => {},
        isStarted: (): boolean => false,
        authenticate: async (connectionId: string, _options?: AbortOptions): Promise<boolean> => false,
        isAuthenticated: (connectionId: string): boolean => false
      }
    }
  }
}

export { AUTH_CHALLENGE_PROTOCOL }
