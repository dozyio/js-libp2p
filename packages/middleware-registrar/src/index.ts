/**
 * @packageDocumentation
 * A registrar implementation that automatically wraps protocols with middleware
 */

import { MiddlewareRegistrar } from './middleware-registry.js'
import type { Middleware, MiddlewareWrapperOptions } from './protocol-middleware-types.js'
import type { ComponentLogger } from '@libp2p/interface'
import type { Registrar } from '@libp2p/interface-internal'

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
  middleware: Middleware,
  options: MiddlewareRegistrarOptions = {}
): Registrar {
  // Create the middleware registry with the original registrar
  const registry = new MiddlewareRegistrar(
    components.registrar,
    middleware,
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

export { MiddlewareRegistrar }
export type { Middleware, MiddlewareWrapperOptions } from './protocol-middleware-types.js'
