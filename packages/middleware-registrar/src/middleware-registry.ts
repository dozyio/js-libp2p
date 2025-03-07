import type { Middleware, MiddlewareDecoratorOptions } from './protocol-middleware-types.js'
import type { ComponentLogger, Logger, Startable, StreamHandler, StreamHandlerRecord, StreamHandlerOptions, Topology, IncomingStreamData } from '@libp2p/interface'
import type { Registrar } from '@libp2p/interface-internal'

/**
 * A Registrar implementation that decorates protocol handlers with middleware,
 * and adds them to standard registrar.
 */
export class MiddlewareRegistrar implements Registrar, Startable {
  private readonly registrar: Registrar
  private readonly middleware: Middleware
  private readonly log: Logger
  private readonly decoratedHandlers: Map<string, StreamHandler>
  private readonly handlerOptions: Map<string, MiddlewareDecoratorOptions>
  private readonly defaultOptions: MiddlewareDecoratorOptions
  private started: boolean

  constructor (registrar: Registrar, middleware: Middleware, logger: ComponentLogger, defaultOptions: MiddlewareDecoratorOptions = {}) {
    this.registrar = registrar
    this.middleware = middleware
    this.log = logger.forComponent('libp2p:middleware-registrar')
    this.decoratedHandlers = new Map()
    this.handlerOptions = new Map()
    this.defaultOptions = defaultOptions
    this.started = false
  }

  readonly [Symbol.toStringTag] = '@libp2p/middleware-registrar'

  /**
   * Set middleware options for a specific protocol
   */
  setProtocolOptions (protocol: string, options: MiddlewareDecoratorOptions): void {
    this.handlerOptions.set(protocol, options)
  }

  /**
   * Start the registry and its provider
   */
  async start (): Promise<void> {
    if (this.started) {
      return
    }

    await this.middleware.start()
    this.started = true
    this.log('Middleware registry started')
  }

  /**
   * Stop the registry and its provider
   */
  async stop (): Promise<void> {
    if (!this.started) {
      return
    }

    await this.middleware.stop()
    this.started = false
    this.log('Middleware registry stopped')
  }

  /**
   * Check if registry is started
   */
  isStarted (): boolean {
    return this.started
  }

  /**
   * Get all registered protocols
   */
  getProtocols (): string[] {
    return this.registrar.getProtocols()
  }

  /**
   * Get a handler for a specific protocol
   */
  getHandler (protocol: string): StreamHandlerRecord {
    return this.registrar.getHandler(protocol)
  }

  /**
   * Register a handler with middleware decorating
   */
  async handle (protocol: string, handler: StreamHandler, options?: StreamHandlerOptions): Promise<void> {
    if (protocol === this.middleware.protocol) {
      this.log(`Skipping decorating ${protocol}, registering with standard registrar`)
      await this.registrar.handle(protocol, handler, options)
      return
    }

    this.log(`Registering handler for ${protocol} with middleware decorator`)

    // Store the original handler
    this.decoratedHandlers.set(protocol, handler)

    // Create a decorated handler that checks the connection's status
    const decoratedHandler: StreamHandler = (data: IncomingStreamData): void => {
      void this.decorateAndHandleStream(protocol, handler, data)
    }

    // Register the decorated handler with the original registrar
    await this.registrar.handle(protocol, decoratedHandler, options)

    this.log(`Successfully registered decorated handler for ${protocol}`)
  }

  /**
   * Apply middleware and handle the stream
   */
  private async decorateAndHandleStream (protocol: string, handler: StreamHandler, data: IncomingStreamData): Promise<void> {
    try {
      // Check if the connection has middleware already applied
      // Use type assertion to handle the id property which might be missing in some Connection implementations
      const connectionId = (data.connection as any).id

      if (!this.middleware.isDecorated(connectionId)) {
        this.log(`Applying middleware to connection ${connectionId}`)

        try {
          // Apply middleware to the connection
          const applied = await this.middleware.decorate(connectionId)

          if (!applied) {
            this.log.error(`Failed to apply middleware to connection ${(data.connection as any).id}, rejecting stream`)
            data.stream.abort(new Error('Middleware failed'))
            return
          }
        } catch (err) {
          this.log.error(`Error applying middleware to connection ${(data.connection as any).id}: ${err}`)
          data.stream.abort(new Error('Middleware failed'))
          return
        }
      }

      // Connection is decorated, call the original handler
      handler(data)
    } catch (err) {
      this.log.error(`Error in decorated handler for ${protocol}: ${err}`)
      data.stream.abort(err instanceof Error ? err : new Error(String(err)))
    }
  }

  /**
   * Unregister a handler
   */
  async unhandle (protocol: string): Promise<void> {
    // Clean up our handler tracking
    this.decoratedHandlers.delete(protocol)
    this.handlerOptions.delete(protocol)

    // Unregister from the original registrar
    await this.registrar.unhandle(protocol)
  }

  /**
   * Register a topology for a protocol
   */
  async register (protocol: string, topology: Topology): Promise<string> {
    return this.registrar.register(protocol, topology)
  }

  /**
   * Unregister a topology
   */
  unregister (id: string): void {
    this.registrar.unregister(id)
  }

  /**
   * Get registrar topologies
   */
  getTopologies (protocol: string): Topology[] {
    return this.registrar.getTopologies(protocol)
  }
}
