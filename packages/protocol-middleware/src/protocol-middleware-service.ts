/* eslint-disable complexity */
/* eslint-disable max-depth */
import { pipe } from 'it-pipe'
import { createMiddlewareWrapper } from './middleware-wrapper.js'
import type { MiddlewareProvider } from './authentication-provider.js'
import type { MiddlewareWrapperOptions } from './middleware-wrapper.js'
import type { AbortOptions, ComponentLogger, Logger, Startable, StreamHandlerRecord, StreamHandler } from '@libp2p/interface'
import type { ConnectionManager, Registrar } from '@libp2p/interface-internal'

/**
 * Interface for services that can be protected by authentication
 */
export interface WrappedService {
  protocol: string
  handleMessage?: StreamHandler
  handleProtocol?: StreamHandler
  handle?: StreamHandler
  maxInboundStreams?: number
  maxOutboundStreams?: number
  runOnLimitedConnection?: boolean
  // Additional properties that might be present on service objects
  multicodecs?: string[]
  [Symbol.toStringTag]?: string
  getProtocols?(): string[]
}

/**
 * Protocol middleware service implementation
 */
export class ProtocolMiddlewareService implements Startable {
  private readonly components: ProtocolMiddlewareServiceComponents
  private readonly provider: MiddlewareProvider
  private readonly log: Logger
  private started: boolean
  public readonly services: Map<string, {
    service: WrappedService
    authOptions?: MiddlewareWrapperOptions
  }>

  private readonly serviceHandlers: Map<string, StreamHandler>
  private readonly defaultAuthOptions: MiddlewareWrapperOptions

  /**
   * Helper function for registering a protocol handler with retry logic
   */
  private async registerProtectedHandler (
    protocol: string,
    handler: StreamHandler,
    options: {
      maxInboundStreams?: number
      maxOutboundStreams?: number
      isAlreadyRegistered?: boolean
    } = {}
  ): Promise<boolean> {
    // Setup retry logic
    let success = false
    let attempts = 0
    const maxAttempts = 3

    // Try multiple times with force option first
    while (!success && attempts < maxAttempts) {
      attempts++

      try {
        // Add small delay between retries
        if (attempts > 1) {
          this.log(`Retry ${attempts} for registering protected handler for ${protocol}`)
          await new Promise(resolve => setTimeout(resolve, 50))
        }

        // Try registering with force option to override any existing handlers
        await this.components.registrar.handle(protocol, handler, {
          maxInboundStreams: options.maxInboundStreams,
          maxOutboundStreams: options.maxOutboundStreams,
          force: true
        })

        success = true
        this.log(`Successfully registered protected handler for ${protocol} (attempt ${attempts})`)
      } catch (err) {
        this.log.error(`Failed to register protected handler (attempt ${attempts}): %o`, err)

        // For already registered protocols, try unregistering first as fallback
        if (options.isAlreadyRegistered === true && attempts === maxAttempts - 1) {
          try {
            // Try unregistering and then registering without force
            await this.components.registrar.unhandle(protocol)
            this.log(`Unregistered protocol ${protocol}, trying to register without force`)

            // Small delay to ensure unregister completes
            await new Promise(resolve => setTimeout(resolve, 10))

            await this.components.registrar.handle(protocol, handler, {
              maxInboundStreams: options.maxInboundStreams,
              maxOutboundStreams: options.maxOutboundStreams
            })

            success = true
            this.log(`Successfully registered handler for ${protocol} after unregistering`)
            break
          } catch (unregErr) {
            this.log.error('Error during unregister-register sequence: %o', unregErr)
          }
        }

        if (attempts === maxAttempts) {
          // We've tried everything, just give up
          return false
        }
      }
    }

    return success
  }

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
    this.defaultAuthOptions = {}

    // Store services if provided
    if (init.services != null) {
      for (const [name, service] of Object.entries(init.services)) {
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
      try {
        // Special case for identify service
        if (name === 'identify' || (service[Symbol.toStringTag]?.includes('identify') === true)) {
          this.log(`Service ${name} detected as identify service - will be handled specially`)

          // For identify, we check handleProtocol method
          if (typeof service.handleProtocol === 'function') {
            // For identify service, we need to actively protect it
            try {
              // Use a standard protocol name for identify
              const identifyProtocol = '/ipfs/id/1.0.0'

              // Create protected service object with the right properties
              const protectedService = {
                protocol: identifyProtocol,
                handleProtocol: service.handleProtocol.bind(service),
                maxInboundStreams: service.maxInboundStreams ?? 16,
                maxOutboundStreams: service.maxOutboundStreams ?? 16,
                runOnLimitedConnection: service.runOnLimitedConnection ?? false
              }

              // Get existing handler if it exists
              let existingHandler
              try {
                const handlerRecord = this.components.registrar.getHandler(identifyProtocol)
                if (handlerRecord != null) {
                  existingHandler = handlerRecord.handler
                  this.log('Found existing identify handler, will replace it with protected version')

                  // Unregister the existing handler
                  await this.components.registrar.unhandle(identifyProtocol)
                  this.log('Unregistered existing identify handler')
                }
              } catch (err) {
                // Ignore errors - just means handler doesn't exist yet
              }

              // Create protected handler
              const protectedHandler = createMiddlewareWrapper(
                this,
                protectedService.handleProtocol,
                authOptions ?? this.defaultAuthOptions
              )

              // Register the protected handler with force option to avoid duplicate registration errors
              try {
                await this.components.registrar.handle(identifyProtocol, protectedHandler, {
                  maxInboundStreams: protectedService.maxInboundStreams,
                  maxOutboundStreams: protectedService.maxOutboundStreams,
                  force: true // Force option to override existing handlers
                })
              } catch (handlerErr) {
                const errMsg = handlerErr instanceof Error ? handlerErr.message : String(handlerErr)
                this.log.error(`Error registering identify handler: ${errMsg}, will try alternative approach`)

                // Try unregistering again and then reregister
                try {
                  await this.components.registrar.unhandle(identifyProtocol)
                  this.log('Unregistered identify handler again due to error')

                  // Small delay to ensure unregister completes
                  await new Promise(resolve => setTimeout(resolve, 50))

                  await this.components.registrar.handle(identifyProtocol, protectedHandler, {
                    maxInboundStreams: protectedService.maxInboundStreams,
                    maxOutboundStreams: protectedService.maxOutboundStreams
                  })

                  this.log('Successfully registered identify handler after second attempt')
                } catch (err2) {
                  const errMsg2 = err2 instanceof Error ? err2.message : String(err2)
                  this.log.error(`Failed second attempt to register identify handler: ${errMsg2}`)
                  throw err2
                }
              }

              this.log(`Successfully protected identify service (${identifyProtocol})`)

              // Store the service and original handler
              this.serviceHandlers.set(identifyProtocol, protectedService.handleProtocol)

              // Skip the normal protection flow for this service
              continue
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err)
              this.log.error(`Failed to protect identify service: ${errMsg}`)
              throw err
            }
          } else {
            this.log.error(`start Service ${name} doesn't have required handleProtocol method`)
            throw new Error(`start Service ${name} doesn't have required handleProtocol method`)
          }
        } else if (name === 'echo' || (service[Symbol.toStringTag]?.includes('echo') === true)) {
        // Special case for echo service
          this.log(`Service ${name} detected as echo service - will be handled specially`)

          // For echo service, we check for protocol and start method
          if (typeof service.protocol === 'string') {
            this.log(`Echo service has protocol property: ${service.protocol}`)

            try {
              // Create a protected handler for the echo protocol
              const echoProtocol = service.protocol

              // Create a simple handler that mirrors echo's functionality
              const echoHandler = (data: any): void => {
                void pipe(data.stream, data.stream)
                  .catch((err: any) => {
                    this.log.error('error piping stream in echo handler', err)
                  })
              }

              // Store the handler for reference
              this.serviceHandlers.set(echoProtocol, echoHandler)

              // Create protected wrapper
              const protectedHandler = createMiddlewareWrapper(
                this,
                echoHandler,
                authOptions ?? this.defaultAuthOptions
              )

              // Try to unregister any existing handler first
              try {
                await this.components.registrar.unhandle(echoProtocol)
                this.log(`Unregistered existing echo handler for ${echoProtocol}`)
              } catch (err) {
                // Ignore errors - might not be registered yet
              }

              // Register the protected handler
              await this.components.registrar.handle(echoProtocol, protectedHandler, {
                maxInboundStreams: service.maxInboundStreams ?? 16,
                maxOutboundStreams: service.maxOutboundStreams ?? 16
              })

              this.log(`Successfully protected echo service (${echoProtocol})`)
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err)
              this.log.error(`Failed to protect echo service: ${errMsg}`)
              throw err
            }

            // Skip further validation for this service
            continue
          } else {
            this.log.error(`start Service ${name} doesn't have required protocol property`)
            throw new Error(`start Service ${name} doesn't have required protocol property`)
          }
        }

        // For other services, check if they have the required properties
        const hasProtocol = service.protocol != null ||
                          (service.multicodecs != null && Array.isArray(service.multicodecs)) ||
                          (service[Symbol.toStringTag]?.includes('identify') === true)

        // For all other services, check if service has any method that could be a handler
        const hasHandler = typeof service.handleMessage === 'function' ||
                          typeof service.handleProtocol === 'function' ||
                          typeof service.handle === 'function'

        if (!hasProtocol || !hasHandler) {
          this.log.error(`start Service ${name} doesn't have required protocol or handler method`)
          throw new Error(`start Service ${name} doesn't have required protocol or handler method`)
          // continue
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        this.log.error(`Error analyzing service ${name}: ${errMsg}`)
        throw err
      }

      let handler: StreamHandlerRecord | undefined

      try {
        // Get existing handler if protocol is already registered
        let isAlreadyRegistered = false
        try {
          handler = this.components.registrar.getHandler(service.protocol)
          isAlreadyRegistered = true
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

        if (handler != null) {
          this.log('Found existing handler')
          this.serviceHandlers.set(service.protocol, handler.handler)

          // Create protected handler
          const protectedHandler = createMiddlewareWrapper(
            this,
            handler.handler,
            authOptions ?? this.defaultAuthOptions
          )

          // Try to register the protected handler with retry logic
          await this.registerProtectedHandler(service.protocol, protectedHandler, {
            maxInboundStreams: service.maxInboundStreams,
            maxOutboundStreams: service.maxOutboundStreams
          })
        } else {
          this.log('No existing handler found')
          // Find the appropriate handler method
          let originalHandler
          if (typeof service.handleMessage === 'function') {
            originalHandler = service.handleMessage.bind(service)
          } else if (typeof service.handleProtocol === 'function') {
            originalHandler = service.handleProtocol.bind(service)
          } else if (typeof service.handle === 'function') {
            originalHandler = service.handle.bind(service)
          } else {
            throw new Error(`Service ${name} doesn't have a valid handler method`)
          }

          this.serviceHandlers.set(service.protocol, originalHandler)

          // Create protected handler
          const protectedHandler = createMiddlewareWrapper(
            this,
            originalHandler,
            authOptions ?? this.defaultAuthOptions
          )

          // Try to register the protected handler with retry logic
          await this.registerProtectedHandler(service.protocol, protectedHandler, {
            maxInboundStreams: service.maxInboundStreams,
            maxOutboundStreams: service.maxOutboundStreams
          })
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
          // Special handling for echo service
          if (name === 'echo' || (service[Symbol.toStringTag]?.includes('echo') === true)) {
            try {
              await this.components.registrar.unhandle(service.protocol)
              this.log(`Unprotected service ${name} (${service.protocol})`)

              // Re-register the original echo handler if needed - the echo service will
              // handle this itself when it starts again, so we don't need to do it
            } catch (err) {
              this.log.error('Failed to unprotect echo service: %o', err)
            }
          } else {
            // Standard unregistration for other services
            await this.components.registrar.unhandle(service.protocol)
            this.log(`Unprotected service ${name} (${service.protocol})`)
          }
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
   * Wrap a connection using the configured middleware provider
   */
  async wrap (connectionId: string, options?: AbortOptions): Promise<boolean> {
    if (!this.started) {
      throw new Error('Protocol middleware service is not started')
    }

    return this.provider.wrap(connectionId, options)
  }

  /**
   * Check if a connection is authenticated
   */
  isWrapped (connectionId: string): boolean {
    if (!this.started) {
      return false
    }

    return this.provider.isWrapped(connectionId)
  }

  /**
   * Register a service to be protected with authentication
   */
  async protectService (name: string, service: any, authOptions?: MiddlewareWrapperOptions): Promise<void> {
    this.log('protectService', name, service, authOptions)
    if (!this.started) {
      throw new Error('Protocol middleware service is not started')
    }

    // Check if this service is already registered
    if (this.services.has(name)) {
      this.log(`Service ${name} is already registered. Skipping duplicate registration`)
      return
    }

    // Log service structure for debugging
    this.log(`Protecting service '${name}': ${
      JSON.stringify({
        keys: Object.keys(service),
        hasProtocol: service.protocol != null,
        hasHandleMessage: typeof service.handleMessage === 'function',
        hasMulticodecs: service.multicodecs != null && Array.isArray(service.multicodecs),
        hasHandle: typeof service.handle === 'function',
        hasHandleProtocol: typeof service.handleProtocol === 'function',
        hasToStringTag: service[Symbol.toStringTag] != null,
        toStringTag: service[Symbol.toStringTag],
        serviceType: service.constructor != null ? service.constructor.name : 'unknown'
      })
    }`)

    // Try to determine the protocol from service properties
    if (service.protocol != null) {
      // Service has a direct protocol property
      return this.protectServiceWithProtocol(name, service, service.protocol, authOptions)
    } else if (service.multicodecs != null && Array.isArray(service.multicodecs) && service.multicodecs.length > 0) {
      // Service has a multicodecs array
      return this.protectServiceWithProtocol(name, service, service.multicodecs[0], authOptions)
    } else if (name === 'identify' || (service[Symbol.toStringTag]?.includes('identify'))) {
      // Special case for identify service which uses different protocol conventions

      // Try different ways to determine the identify protocol
      if (service.protocol != null && typeof service.protocol === 'string') {
        // If service has a direct protocol property, use it
        this.log(`Found direct protocol for identify: ${service.protocol}`)
        return this.protectServiceWithProtocol(name, service, service.protocol, authOptions)
      }

      // Try to get protocols from the service
      try {
        // Try to access multicodecs if available
        if (service.multicodecs != null && Array.isArray(service.multicodecs) && service.multicodecs.length > 0) {
          const protocol = service.multicodecs[0]
          this.log(`Using protocol from multicodecs: ${protocol}`)
          return this.protectServiceWithProtocol(name, service, protocol, authOptions)
        }

        // Try to get protocols from a method if available
        if (typeof service.getProtocols === 'function') {
          const protocols = service.getProtocols()
          if (Array.isArray(protocols) && protocols.length > 0) {
            const identifyProtocol = protocols.find(p => p.includes('/id/')) || protocols[0]
            this.log(`Using protocol from getProtocols: ${identifyProtocol}`)
            return this.protectServiceWithProtocol(name, service, identifyProtocol, authOptions)
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        this.log.error(`Error trying to determine identify protocol: ${errMsg}`)
      }

      // Fall back to standard protocol name for identify
      this.log('Using default identify protocol: /ipfs/id/1.0.0')

      // For identify we need to get the protocol handler directly from the service
      if (typeof service.handleProtocol === 'function') {
        this.log('Using handleProtocol from identify service')
        const identifyProtocol = '/ipfs/id/1.0.0'
        return this.protectServiceWithProtocol(name, {
          protocol: identifyProtocol,
          handleProtocol: service.handleProtocol.bind(service)
        }, identifyProtocol, authOptions)
      }

      return this.protectServiceWithProtocol(name, service, '/ipfs/id/1.0.0', authOptions)
    } else {
      // No protocol information available
      throw new Error(`protectService Service ${name} doesn't have required protocol information`)
    }
  }

  /**
   * Helper to protect a service using an explicitly provided protocol
   */
  private async protectServiceWithProtocol (
    name: string,
    service: any,
    protocol: string,
    authOptions?: MiddlewareWrapperOptions
  ): Promise<void> {
    let handleMessage: any

    // Determine the appropriate handler method
    if (typeof service.handleMessage === 'function') {
      handleMessage = service.handleMessage.bind(service)
    } else if (typeof service.handleProtocol === 'function') {
      handleMessage = service.handleProtocol.bind(service)
    } else if (typeof service.handle === 'function') {
      handleMessage = service.handle.bind(service)
    } else if (service.registrar?.getHandler != null) {
      try {
        const handler = service.registrar.getHandler(protocol)
        handleMessage = handler?.handler
      } catch {
        // Ignore errors when trying to get the handler
      }
    } else if (name === 'identify' || (service[Symbol.toStringTag]?.includes('identify') === true)) {
      // Special case: For identify service, prioritize handleProtocol since we know it exists
      if (typeof service.handleProtocol === 'function') {
        this.log(`Using direct handleProtocol for ${name} service`)
        handleMessage = service.handleProtocol.bind(service)
      } else {
        // Fallback: try to get from registrar if handleProtocol isn't available
        try {
          const handler = this.components.registrar.getHandler(protocol)
          handleMessage = handler?.handler
          this.log(`Got handler for ${name} from registrar: ${handleMessage != null ? 'success' : 'not found'}`)
        } catch (err) {
          this.log.error(`Error getting handler for ${name} from registrar: ${err instanceof Error ? err.message : 'unknown error'}`)

          // Last resort fallback
          this.log(`Using empty fallback handler for ${name}`)
          handleMessage = (data: any) => {
            this.log(`Fallback handler for ${name} called`)
            data.stream.close()
          }
        }
      }
    }

    if (handleMessage == null) {
      this.log.error(`Could not find handler for ${name} with protocol ${protocol}`)
      throw new Error(`Could not find handler for ${name}`)
    }

    // Log debug information about the handler
    this.log(
    `Handler for '${name}' with protocol '${protocol}': ${JSON.stringify({
      handlerType: typeof handleMessage,
      handlerName: handleMessage?.name
    })}`
    )

    // Check if the protocol is already registered and if it's already protected
    let isAlreadyRegistered = false
    try {
      this.components.registrar.getHandler(protocol)
      isAlreadyRegistered = true
      if (this.serviceHandlers.has(protocol)) {
        this.log(`Protocol ${protocol} is already protected; skipping duplicate protection`)
        return
      }
      this.log(`Protocol ${protocol} is registered, replacing handler`)
    } catch (err: any) {
      if (err instanceof Error && err.name !== 'UnhandledProtocolError') {
        this.log.error(`Error checking protocol ${protocol}: ${err.message}`)
      }
    }

    // Create a wrapped service using provided stream limits (or defaults)
    const wrappedService: WrappedService = {
      protocol,
      handleMessage,
      maxInboundStreams: service.maxInboundStreams ?? 16,
      maxOutboundStreams: service.maxOutboundStreams ?? 16
    }

    // Wrap the handler with authentication middleware
    const protectedHandler = createMiddlewareWrapper(
      this,
      handleMessage,
      authOptions ?? this.defaultAuthOptions
    )

    // Attempt to register the protected handler
    let registered = await this.registerProtectedHandler(protocol, protectedHandler, {
      maxInboundStreams: wrappedService.maxInboundStreams,
      maxOutboundStreams: wrappedService.maxOutboundStreams,
      isAlreadyRegistered
    })

    // Fallback: try registering via the service registrar if needed
    if (!registered && service.registrar?.handle != null) {
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

    if (!registered) {
      const err = new Error(`Failed to protect service ${name}: Could not register protocol handler`)
      this.log.error(err.message)
      throw err
    }

    // Save the wrapped service and handler references
    this.services.set(name, { service: wrappedService, authOptions })
    this.serviceHandlers.set(protocol, handleMessage)
    this.log(`Registered service ${name} (${protocol}) with authentication`)
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
  registrar: Registrar
  logger: ComponentLogger
  connectionManager: ConnectionManager
}

/**
 * Initialization options for the protocol middleware service
 */
export interface ProtocolMiddlewareServiceInit {
  /**
   * Authentication provider to use
   */
  provider: MiddlewareProvider

  /**
   * Services to automatically protect with middleware
   */
  services?: Record<string, WrappedService>

  /**
   * Per-service authentication options
   */
  authOptions?: Record<string, MiddlewareWrapperOptions>
}
