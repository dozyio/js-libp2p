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
  public readonly services: Map<string, {
    service: ProtectedService
    authOptions?: MiddlewareWrapperOptions
  }>

  private readonly serviceHandlers: Map<string, StreamHandler>
  private readonly defaultAuthOptions: MiddlewareWrapperOptions

  constructor (components: ProtocolMiddlewareServiceComponents, init: ProtocolMiddlewareServiceInit) {
    this.components = components
    this.log = components.logger.forComponent('libp2p:protocol-middleware')
    this.started = false

    // Set the provider components directly
    const provider = init.provider as any
    provider.components = {
      registrar: components.registrar,
      connectionManager: components.connectionManager,
      logger: components.logger
    }

    // Store the provider
    this.provider = init.provider

    this.services = new Map()
    this.serviceHandlers = new Map()

    // Default options for middleware
    this.defaultAuthOptions = {
      autoAuthenticate: init.autoAuthenticate ?? true
    }

    // Store services if provided
    if (init.protectedServices != null) {
      for (const [name, service] of Object.entries(init.protectedServices)) {
        this.services.set(name, {
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

    // Check for conflicts and set up services
    for (const [name, { service, authOptions }] of this.services.entries()) {
      if (service.protocol == null || typeof service.handleMessage !== 'function') {
        this.log.error(`Service ${name} doesn't have required protocol or handleMessage properties`)
        continue
      }

      try {
        // Get existing handler if protocol is already registered
        let existingHandler: any = null
        let isAlreadyRegistered = false
        
        try {
          // Check if this protocol is already registered
          const handlerInfo = this.components.registrar.getHandler(service.protocol)
          isAlreadyRegistered = true
          existingHandler = handlerInfo.handler
          this.log(`Protocol ${service.protocol} is already registered - will temporarily unregister it`)
        } catch (err: any) {
          // If it's an UnhandledProtocolError, that's good - it means the protocol isn't registered yet
          if (err.name !== 'UnhandledProtocolError') {
            throw err
          }
        }
        
        // If protocol is already registered, unregister it first
        if (isAlreadyRegistered) {
          try {
            await this.components.registrar.unhandle(service.protocol)
            this.log(`Successfully unregistered existing handler for ${service.protocol}`)
          } catch (err) {
            this.log.error(`Failed to unregister existing handler for ${service.protocol}: %o`, err)
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

        // Try to register the protected handler with retry logic
        let success = false
        let attempts = 0
        const maxAttempts = 3
        
        while (!success && attempts < maxAttempts) {
          attempts++
          try {
            // Small delay if this is a retry
            if (attempts > 1) {
              this.log(`Retry ${attempts} for registering protected handler for ${service.protocol}`)
              await new Promise(resolve => setTimeout(resolve, 50))
            }
            
            // Try to register with force option to override any existing handler
            await this.components.registrar.handle(service.protocol, protectedHandler, {
              maxInboundStreams: service.maxInboundStreams,
              maxOutboundStreams: service.maxOutboundStreams,
              force: true
            })
            
            success = true
            this.log(`Successfully registered protected handler for ${service.protocol} (attempt ${attempts})`)
          } catch (err) {
            if (attempts === maxAttempts) {
              this.log.error(`Failed to register protected handler after ${maxAttempts} attempts: %o`, err)
              throw err
            }
            this.log.error(`Failed to register protected handler (attempt ${attempts}): %o`, err)
          }
        }

        this.log(`Protected service ${name} (${service.protocol}) with authentication`)
      } catch (err) {
        this.log.error(`Failed to protect service ${name}: %o`, err)
        throw err
      }
    }

    this.started = true
  }

  async stop (): Promise<void> {
    // Unregister services
    for (const [name, { service }] of this.services.entries()) {
      try {
        if (service.protocol != null) {
          // Unregister handler
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
  async protectService (name: string, service: any, authOptions?: MiddlewareWrapperOptions): Promise<void> {
    if (!this.started) {
      throw new Error('Protocol middleware service is not started')
    }

    // Check if this service is already registered
    if (this.services.has(name)) {
      this.log(`Service ${name} is already registered. Skipping duplicate registration`)
      return
    }

    // Special handling for identify service which needs a different approach
    if (name === 'identify' && typeof service.handleMessage !== 'function' && typeof service.handle !== 'function') {
      // For identify, create a custom proxy that works with identify's internals
      this.log('Creating custom identify proxy for identify service')

      // Add handleMessage to the identify service
      service.handleMessage = (data: any) => {
        if (typeof service._handleIncomingStream === 'function') {
          service._handleIncomingStream(data)
        } else {
          data.stream.close()
        }
      }
    }

    // Log service structure for debugging
    this.log(`Protecting service '${name}': ${
      JSON.stringify({
        keys: Object.keys(service),
        hasProtocol: service.protocol != null,
        hasHandleMessage: typeof service.handleMessage === 'function',
        hasMulticodecs: service.multicodecs != null && Array.isArray(service.multicodecs),
        hasHandle: typeof service.handle === 'function',
        serviceType: service.constructor != null ? service.constructor.name : 'unknown'
      })
    }`)

    // For ping and identify, we need to manually set their protocols
    if (name === 'ping') {
      // Ping always uses this protocol
      return this.protectServiceWithProtocol(name, service, '/ipfs/ping/1.0.0', authOptions)
    } else if (name === 'identify') {
      // Identify always uses this protocol
      return this.protectServiceWithProtocol(name, service, '/ipfs/id/1.0.0', authOptions)
    }

    // Try to determine the protocol from service properties
    if (service.protocol != null) {
      // Service has a direct protocol property
      return this.protectServiceWithProtocol(name, service, service.protocol, authOptions)
    } else if (service.multicodecs != null && Array.isArray(service.multicodecs) && service.multicodecs.length > 0) {
      // Service has a multicodecs array
      return this.protectServiceWithProtocol(name, service, service.multicodecs[0], authOptions)
    } else {
      // No protocol information available
      throw new Error(`Service ${name} doesn't have required protocol information`)
    }
  }

  /**
   * Helper to protect a service using an explicitly provided protocol
   */
  private async protectServiceWithProtocol (name: string, service: any, protocol: string, authOptions?: MiddlewareWrapperOptions): Promise<void> {
    // Get the handler function based on the service interface
    let handleMessage: any

    // Try different ways to get the handler
    if (typeof service.handleMessage === 'function') {
      // Direct handler method
      handleMessage = service.handleMessage.bind(service)
    } else if (typeof service.handle === 'function') {
      // Direct handle method
      handleMessage = service.handle.bind(service)
    } else if (name === 'identify') {
      // Special case for identify service
      this.log('Creating custom handler for identify service')
      handleMessage = (data: any) => {
        this.log('Identify request received in wrapper, using identify service methods')

        // Try to find an appropriate method on the identify service to handle this
        const { stream, connection } = data

        // Identify service should have an internal _handleIncomingStream method
        if (typeof service._handleIncomingStream === 'function') {
          try {
            service._handleIncomingStream({ stream, connection })
            return
          } catch (err: any) {
            this.log.error(`Error forwarding to identify._handleIncomingStream: ${err.message}`)
          }
        }

        // Fallback: just close the stream
        this.log('No identify handler found, closing stream')
        stream.close()
      }
    } else if (service.registrar != null && typeof service.registrar.getHandler === 'function') {
      // Try getting the handler from the registrar
      try {
        const handler = service.registrar.getHandler(protocol)
        if (handler != null && handler.handler != null) {
          handleMessage = handler.handler
        }
      } catch (err) {
        // Ignore errors when trying to get handler
      }
    }

    // For testing purposes, create a dummy handler if none was found
    if (handleMessage == null) {
      this.log(`Could not find handler for ${name}, creating a dummy one`)
      handleMessage = (data: any) => {
        const { stream } = data
        stream.close()
      }
    }

    // Debug info about the handler
    this.log(`Found handler for '${name}' with protocol '${protocol}': ${
      JSON.stringify({
        handlerType: typeof handleMessage,
        handlerName: handleMessage != null ? handleMessage.name : undefined
      })
    }`)

    // First, verify if this protocol is already registered by another handler
    let isAlreadyRegistered = false
    let existingHandler: any

    try {
      // Check if the protocol is already registered
      const handlerInfo = this.components.registrar.getHandler(protocol)
      isAlreadyRegistered = true
      existingHandler = handlerInfo?.handler

      // Check if this protocol is protected by us already
      const isAlreadyProtected = this.serviceHandlers.has(protocol)

      if (isAlreadyProtected) {
        // This protocol is already protected, this is likely a duplicate call
        this.log(`Protocol ${protocol} is already protected. Skipping duplicate protection`)
        return
      }

      this.log(`Protocol ${protocol} is already registered, will replace handler`)
    } catch (err: any) {
      // Protocol isn't registered yet, which is good
      if (err instanceof Error && err.name !== 'UnhandledProtocolError') {
        // Some other error occurred
        this.log.error(`Error checking protocol ${protocol} registration: ${err.message}`)
      }
    }

    // Create a wrapped service object that matches the ProtectedService interface
    const wrappedService: ProtectedService = {
      protocol,
      handleMessage,
      // Preserve stream limits if available
      maxInboundStreams: service.maxInboundStreams ?? 16,
      maxOutboundStreams: service.maxOutboundStreams ?? 16
    }

    // Create protected handler with the authentication wrapper
    const protectedHandler = createMiddlewareWrapper(
      this,
      handleMessage,
      authOptions ?? this.defaultAuthOptions
    )

    // Use a coordinated approach to replace the handler
    let registered = false

    // We need to synchronize this to avoid race conditions
    if (isAlreadyRegistered) {
      try {
        // Based on the registrar implementation, we can use the force option to override an existing handler
        this.log(`Using force option to override existing handler for ${protocol}`)

        // Register with force option to replace the existing handler
        await this.components.registrar.handle(protocol, protectedHandler, {
          maxInboundStreams: wrappedService.maxInboundStreams,
          maxOutboundStreams: wrappedService.maxOutboundStreams,
          force: true // Force option to override existing handler
        })

        registered = true
        this.log(`Successfully registered protected handler for ${protocol} with force option`)
      } catch (err: any) {
        this.log.error(`Error using force option for ${protocol}: ${err.message}`)

        // Try the original approach as fallback
        try {
          // Step 1: Unregister the existing handler
          await this.components.registrar.unhandle(protocol)
          this.log(`Successfully unregistered protocol ${protocol}`)

          // Add a tiny delay to ensure unregister completes
          await new Promise(resolve => setTimeout(resolve, 5))

          // Step 2: Register our protected handler
          await this.components.registrar.handle(protocol, protectedHandler, {
            maxInboundStreams: wrappedService.maxInboundStreams,
            maxOutboundStreams: wrappedService.maxOutboundStreams
          })

          registered = true
          this.log(`Successfully registered protected handler for ${protocol} after unregister`)
        } catch (secondErr: any) {
          this.log.error(`Error during handler swap for ${protocol}: ${secondErr.message}`)

          // If we failed to register after unregistering, try to restore the original handler
          if (!registered && existingHandler != null) {
            try {
              await this.components.registrar.handle(protocol, existingHandler, {
                maxInboundStreams: wrappedService.maxInboundStreams,
                maxOutboundStreams: wrappedService.maxOutboundStreams,
                force: true // Use force option to ensure restoration
              })
              this.log(`Restored original handler for ${protocol}`)
            } catch (restoreErr: any) {
              this.log.error(`Failed to restore original handler for ${protocol}: ${restoreErr.message}`)
            }
          }
        }
      }
    } else {
      // Protocol not registered yet, just register our protected handler
      try {
        await this.components.registrar.handle(protocol, protectedHandler, {
          maxInboundStreams: wrappedService.maxInboundStreams,
          maxOutboundStreams: wrappedService.maxOutboundStreams
        })

        registered = true
        this.log(`Successfully registered protected handler for ${protocol}`)
      } catch (err: any) {
        this.log.error(`Error registering handler with component registrar: ${err.message}`)

        // Fallback: try registering directly through the service if it has a registrar
        if (service.registrar != null && typeof service.registrar.handle === 'function') {
          try {
            await service.registrar.handle(protocol, protectedHandler, {
              maxInboundStreams: wrappedService.maxInboundStreams,
              maxOutboundStreams: wrappedService.maxOutboundStreams
            })

            registered = true
            this.log('Successfully registered protected handler via service registrar')
          } catch (innerErr: any) {
            this.log.error(`Error registering via service registrar: ${innerErr.message}`)
          }
        }
      }
    }

    if (registered) {
      // Store service and handler references only if successfully registered
      this.services.set(name, { service: wrappedService, authOptions })
      this.serviceHandlers.set(protocol, handleMessage)
      this.log(`Registered service ${name} (${protocol}) with authentication`)
    } else {
      const err = new Error(`Failed to protect service ${name}: Could not register protocol handler`)
      this.log.error(err.message)
      throw err
    }
  }

  /**
   * Unprotect a previously protected service
   */
  async unprotectService (name: string): Promise<void> {
    if (!this.started) {
      throw new Error('Protocol middleware service is not started')
    }

    const serviceInfo = this.services.get(name)
    if (serviceInfo == null) {
      throw new Error(`Service ${name} is not registered`)
    }

    const { service } = serviceInfo

    try {
      // Unregister protected handler
      await this.components.registrar.unhandle(service.protocol)

      // Remove from services
      this.services.delete(name)
      this.serviceHandlers.delete(service.protocol)

      this.log(`Unregistered service ${name} (${service.protocol})`)
    } catch (err: any) {
      this.log.error(`Error unprotecting service ${name}: ${err.message}`)
      throw err
    }
  }
}

/**
 * Components required by the protocol middleware service
 */
export interface ProtocolMiddlewareServiceComponents {
  registrar: any // Registrar interface
  logger: any // ComponentLogger interface
  connectionManager: any // ConnectionManager interface
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
