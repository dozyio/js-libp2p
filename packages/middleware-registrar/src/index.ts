/**
 * @packageDocumentation
 * A registrar implementation that automatically wraps protocols with middleware
 */

import { MiddlewareRegistry } from './middleware-registry.js'
import type { ComponentLogger } from '@libp2p/interface'
import type { Registrar } from '@libp2p/interface-internal'
import type { MiddlewareProvider, MiddlewareWrapperOptions } from './protocol-middleware-types.js'

/**
 * Components required for the middleware registrar
 */
export interface RegistrarComponents {
  registrar: Registrar
  logger: ComponentLogger
}

/**
 * Options for the middleware registrar
 */
export interface MiddlewareRegistrarOptions {
  /**
   * Default middleware options to apply to all protocols
   */
  defaultOptions?: MiddlewareWrapperOptions

  /**
   * Per-protocol middleware options
   */
  protocolOptions?: Record<string, MiddlewareWrapperOptions>
}

/**
 * Create a new middleware registrar which acts as a drop-in replacement
 * for the standard registrar but automatically wraps all protocol handlers
 * with the specified middleware provider
 */
export function middlewareRegistrar (
  components: RegistrarComponents,
  provider: MiddlewareProvider,
  options: MiddlewareRegistrarOptions = {}
): Registrar {
  // Create the middleware registry with the original registrar
  const registry = new MiddlewareRegistry(
    components.registrar,
    provider,
    components.logger,
    options.defaultOptions
  )

  // Configure protocol-specific options if provided
  if (options.protocolOptions != null) {
    for (const [protocol, opts] of Object.entries(options.protocolOptions)) {
      registry.setProtocolOptions(protocol, opts)
    }
  }

  return registry
}

export { MiddlewareRegistry }
export type { MiddlewareProvider, MiddlewareWrapperOptions } from './protocol-middleware-types.js'
