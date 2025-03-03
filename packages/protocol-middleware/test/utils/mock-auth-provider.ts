import type { AuthenticationProvider } from '../../src/authentication-provider.js'
import type { AbortOptions } from '@libp2p/interface'

interface MockAuthProviderOptions {
  // Whether authentication always succeeds (for testing)
  alwaysSuccess?: boolean
  // How long to wait before returning (simulates network delay)
  delay?: number
  // Custom authentication function
  customAuthenticator?(connectionId: string, options?: AbortOptions): Promise<boolean>
  // Provider name and ID
  id?: string
  name?: string
}

/**
 * Creates a mock authentication provider for testing
 */
export function mockAuthProvider (options: MockAuthProviderOptions = {}): AuthenticationProvider {
  // Store authenticated connections
  const authenticatedConnections = new Set<string>()

  // Default options
  const opts = {
    // Whether authentication always succeeds (for testing)
    alwaysSuccess: true,
    // How long to wait before returning (simulates network delay)
    delay: 0,
    // Custom authentication function
    customAuthenticator: null,
    // Provider name and ID
    id: 'mock',
    name: 'Mock Auth Provider',
    ...options
  }

  return {
    /**
     * Provider ID
     */
    get id () { return opts.id },

    /**
     * Provider name
     */
    get name () { return opts.name },

    /**
     * Start the provider
     */
    async start (): Promise<void> {
      // Nothing to do for mock
    },

    /**
     * Stop the provider
     */
    async stop (): Promise<void> {
      // Clear authenticated connections
      authenticatedConnections.clear()
    },

    /**
     * Authenticate a connection
     */
    async authenticate (connectionId: string, options?: AbortOptions): Promise<boolean> {
      // Simulate network delay
      if (opts.delay > 0) {
        await new Promise(resolve => setTimeout(resolve, opts.delay))
      }

      // Use custom authenticator if provided
      if (typeof opts.customAuthenticator === 'function') {
        const result = await opts.customAuthenticator(connectionId, options)

        if (result) {
          authenticatedConnections.add(connectionId)
        }

        return result
      }

      // Default behavior - always success or based on options
      if (opts.alwaysSuccess) {
        authenticatedConnections.add(connectionId)
        return true
      }

      return false
    },

    /**
     * Check if a connection is authenticated
     */
    isAuthenticated (connectionId: string): boolean {
      return authenticatedConnections.has(connectionId)
    }
  }
}
