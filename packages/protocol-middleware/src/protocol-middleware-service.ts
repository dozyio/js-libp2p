import { createMiddlewareWrapper } from './middleware-wrapper.js'
import type { AuthenticationProvider } from './authentication-provider.js'
import type { MiddlewareWrapperOptions } from './middleware-wrapper.js'
import type { AbortOptions, Logger, Startable } from '@libp2p/interface'
import type { StreamHandler } from '@libp2p/interface-internal'

/**
 * Interface for services that can be protected by authentication
 */
export interface ProtectedService {
  protocol: string
  handleMessage: StreamHandler
  maxInboundStreams?: number
  maxOutboundStreams?: number
}

/**
 * Protocol middleware service implementation
 */
export class ProtocolMiddlewareService implements Startable {
  private readonly components: ProtocolMiddlewareServiceComponents
  private readonly provider: AuthenticationProvider
  private readonly log: Logger
  private started: boolean
  private readonly protectedServices: Map<string, {
    service: ProtectedService
    authOptions?: MiddlewareWrapperOptions
  }>

  private readonly serviceHandlers: Map<string, StreamHandler>
  private readonly defaultAuthOptions: MiddlewareWrapperOptions

  constructor (components: ProtocolMiddlewareServiceComponents, init: ProtocolMiddlewareServiceInit) {
    this.components = components
    this.log = components.logger.forComponent('libp2p:protocol-middleware')
    this.started = false
    this.provider = init.provider
    this.protectedServices = new Map()
    this.serviceHandlers = new Map()

    // Default options for middleware
    this.defaultAuthOptions = {
      autoAuthenticate: init.autoAuthenticate ?? true
    }

    // Store protected services if provided
    if (init.protectedServices != null) {
      for (const [name, service] of Object.entries(init.protectedServices)) {
        this.protectedServices.set(name, {
          service,
          authOptions: init.authOptions?.[name] ?? this.defaultAuthOptions
        })
      }
    }
  }

  readonly [Symbol.toStringTag] = '@libp2p/protocol-middleware'

  async start (): Promise<void> {
    // Start the authentication provider
    await this.provider.start()

    // Check for conflicts and set up protected services
    for (const [name, { service, authOptions }] of this.protectedServices.entries()) {
      if (service.protocol == null || typeof service.handleMessage !== 'function') {
        this.log.error(`Service ${name} doesn't have required protocol or handleMessage properties`)
        continue
      }

      try {
        // Check if protocol is already registered directly
        try {
          this.components.registrar.getHandler(service.protocol)

          // If we get here, the protocol is already registered
          throw new Error(
            `Protocol ${service.protocol} is already registered directly with libp2p. ` +
            'A service cannot be both protected and unprotected at the same time. ' +
            'Either remove it from the protectedServices list or don\'t register it directly.'
          )
        } catch (err: any) {
          // If it's an UnhandledProtocolError, that's good - it means the protocol isn't registered yet
          if (err.name !== 'UnhandledProtocolError') {
            throw err
          }
        }

        // Store original handler
        const originalHandler = service.handleMessage.bind(service)
        this.serviceHandlers.set(service.protocol, originalHandler)

        // Create protected handler
        const protectedHandler = createMiddlewareWrapper(
          this,
          originalHandler,
          authOptions ?? this.defaultAuthOptions
        )

        // Register the protected handler
        await this.components.registrar.handle(service.protocol, protectedHandler, {
          maxInboundStreams: service.maxInboundStreams,
          maxOutboundStreams: service.maxOutboundStreams
        })

        this.log(`Protected service ${name} (${service.protocol}) with authentication`)
      } catch (err) {
        this.log.error(`Failed to protect service ${name}: %o`, err)
        throw err
      }
    }

    this.started = true
  }

  async stop (): Promise<void> {
    // Unregister protected services
    for (const [name, { service }] of this.protectedServices.entries()) {
      try {
        if (service.protocol != null) {
          // Unregister protected handler
          await this.components.registrar.unhandle(service.protocol)

          this.log(`Unprotected service ${name} (${service.protocol})`)
        }
      } catch (err) {
        this.log.error(`Failed to unprotect service ${name}: %o`, err)
      }
    }

    // Stop the authentication provider
    await this.provider.stop()

    this.started = false
  }

  isStarted (): boolean {
    return this.started
  }

  /**
   * Authenticate a connection using the configured authentication provider
   */
  async authenticate (connectionId: string, options?: AbortOptions): Promise<boolean> {
    if (!this.started) {
      throw new Error('Protocol middleware service is not started')
    }

    return this.provider.authenticate(connectionId, options)
  }

  /**
   * Check if a connection is authenticated
   */
  isAuthenticated (connectionId: string): boolean {
    if (!this.started) {
      return false
    }

    return this.provider.isAuthenticated(connectionId)
  }

  /**
   * Register a service to be protected with authentication
   */
  async protectService (name: string, service: ProtectedService, authOptions?: MiddlewareWrapperOptions): Promise<void> {
    if (!this.started) {
      throw new Error('Protocol middleware service is not started')
    }

    if (service.protocol == null || typeof service.handleMessage !== 'function') {
      throw new Error(`Service ${name} doesn't have required protocol or handleMessage properties`)
    }

    // Check if protocol is already registered directly
    try {
      this.components.registrar.getHandler(service.protocol)

      // If we get here, the protocol is already registered
      throw new Error(
        `Protocol ${service.protocol} is already registered directly with libp2p. ` +
        'A service cannot be both protected and unprotected at the same time. ' +
        'Either remove it from the protectedServices list or don\'t register it directly.'
      )
    } catch (err: any) {
      // If it's an UnhandledProtocolError, that's good - it means the protocol isn't registered yet
      if (err.name !== 'UnhandledProtocolError') {
        throw err
      }
    }

    // Store the service
    this.protectedServices.set(name, { service, authOptions })

    // Store original handler
    const originalHandler = service.handleMessage.bind(service)
    this.serviceHandlers.set(service.protocol, originalHandler)

    // Create protected handler
    const protectedHandler = createMiddlewareWrapper(
      this,
      originalHandler,
      authOptions ?? this.defaultAuthOptions
    )

    // Register the protected handler
    await this.components.registrar.handle(service.protocol, protectedHandler, {
      maxInboundStreams: service.maxInboundStreams,
      maxOutboundStreams: service.maxOutboundStreams
    })

    this.log(`Protected service ${name} (${service.protocol}) with authentication`)
  }

  /**
   * Unprotect a previously protected service
   */
  async unprotectService (name: string): Promise<void> {
    if (!this.started) {
      throw new Error('Protocol middleware service is not started')
    }

    const serviceInfo = this.protectedServices.get(name)
    if (serviceInfo == null) {
      throw new Error(`Service ${name} is not protected`)
    }

    const { service } = serviceInfo

    // Unregister protected handler
    await this.components.registrar.unhandle(service.protocol)

    // Remove from protected services
    this.protectedServices.delete(name)
    this.serviceHandlers.delete(service.protocol)

    this.log(`Unprotected service ${name} (${service.protocol})`)
  }
}

/**
 * Components required by the protocol middleware service
 */
export interface ProtocolMiddlewareServiceComponents {
  registrar: any // Registrar interface
  logger: any // ComponentLogger interface
}

/**
 * Initialization options for the protocol middleware service
 */
export interface ProtocolMiddlewareServiceInit {
  /**
   * Authentication provider to use
   */
  provider: AuthenticationProvider

  /**
   * If true, automatically try to authenticate connections when they access protected services
   */
  autoAuthenticate?: boolean

  /**
   * Services to automatically protect with authentication
   */
  protectedServices?: Record<string, ProtectedService>

  /**
   * Per-service authentication options
   */
  authOptions?: Record<string, MiddlewareWrapperOptions>
}
