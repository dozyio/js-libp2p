import { serviceCapabilities, transportSymbol } from '@libp2p/interface'
import { peerIdFromString } from '@libp2p/peer-id'
import { WebRTCDirect } from '@multiformats/multiaddr-matcher'
import { raceSignal } from 'race-signal'
import { genUfrag } from '../util.js'
import { WebRTCDirectListener } from './listener.js'
import { connect } from './utils/connect.js'
import { createDialerRTCPeerConnection } from './utils/get-rtcpeerconnection.js'
import type { DataChannelOptions, TransportCertificate } from '../index.js'
import type { WebRTCDialEvents } from '../private-to-private/transport.js'
import type { CreateListenerOptions, Transport, Listener, ComponentLogger, Logger, Connection, CounterGroup, Metrics, PeerId, DialTransportOptions, PrivateKey, Upgrader } from '@libp2p/interface'
import type { TransportManager } from '@libp2p/interface-internal'
import type { Multiaddr } from '@multiformats/multiaddr'

/**
 * The peer for this transport
 */
export interface WebRTCDirectTransportComponents {
  peerId: PeerId
  privateKey: PrivateKey
  metrics?: Metrics
  logger: ComponentLogger
  transportManager: TransportManager
  upgrader: Upgrader
}

export interface WebRTCMetrics {
  dialerEvents: CounterGroup
}

export interface WebRTCTransportDirectInit {
  rtcConfiguration?: RTCConfiguration | (() => RTCConfiguration | Promise<RTCConfiguration>)
  dataChannel?: DataChannelOptions
  certificates?: TransportCertificate[]

  /**
   * @deprecated this setting is ignored and will be removed in a future release
   */
  useLibjuice?: boolean
}

export class WebRTCDirectTransport implements Transport {
  private readonly log: Logger
  private readonly metrics?: WebRTCMetrics
  private readonly components: WebRTCDirectTransportComponents
  private readonly init: WebRTCTransportDirectInit

  constructor (components: WebRTCDirectTransportComponents, init: WebRTCTransportDirectInit = {}) {
    this.log = components.logger.forComponent('libp2p:webrtc-direct')
    this.components = components
    this.init = init

    if (components.metrics != null) {
      this.metrics = {
        dialerEvents: components.metrics.registerCounterGroup('libp2p_webrtc-direct_dialer_events_total', {
          label: 'event',
          help: 'Total count of WebRTC-direct dial events by type'
        })
      }
    }
  }

  readonly [transportSymbol] = true

  readonly [Symbol.toStringTag] = '@libp2p/webrtc-direct'

  readonly [serviceCapabilities]: string[] = [
    '@libp2p/transport'
  ]

  /**
   * Dial a given multiaddr
   */
  async dial (ma: Multiaddr, options: DialTransportOptions<WebRTCDialEvents>): Promise<Connection> {
    const rawConn = await this._connect(ma, options)
    this.log('dialing address: %a', ma)
    return rawConn
  }

  /**
   * Create transport listeners no supported by browsers
   */
  createListener (options: CreateListenerOptions): Listener {
    return new WebRTCDirectListener(this.components, {
      ...this.init,
      ...options
    })
  }

  /**
   * Filter check for all Multiaddrs that this transport can listen on
   */
  listenFilter (multiaddrs: Multiaddr[]): Multiaddr[] {
    return multiaddrs.filter(WebRTCDirect.exactMatch)
  }

  /**
   * Filter check for all Multiaddrs that this transport can dial
   */
  dialFilter (multiaddrs: Multiaddr[]): Multiaddr[] {
    return this.listenFilter(multiaddrs)
  }

  /**
   * Connect to a peer using a multiaddr
   */
  async _connect (ma: Multiaddr, options: DialTransportOptions<WebRTCDialEvents>): Promise<Connection> {
    // do not create RTCPeerConnection if the signal has already been aborted
    options.signal.throwIfAborted()

    let theirPeerId: PeerId | undefined
    const remotePeerString = ma.getPeerId()
    if (remotePeerString != null) {
      theirPeerId = peerIdFromString(remotePeerString)
    }

    const ufrag = genUfrag()

    // https://github.com/libp2p/specs/blob/master/webrtc/webrtc-direct.md#browser-to-public-server
    const peerConnection = await createDialerRTCPeerConnection('client', ufrag, typeof this.init.rtcConfiguration === 'function' ? await this.init.rtcConfiguration() : this.init.rtcConfiguration ?? {})

    try {
      return await raceSignal(connect(peerConnection, ufrag, {
        role: 'client',
        log: this.log,
        logger: this.components.logger,
        metrics: this.components.metrics,
        events: this.metrics?.dialerEvents,
        signal: options.signal,
        remoteAddr: ma,
        dataChannel: this.init.dataChannel,
        upgrader: options.upgrader,
        peerId: this.components.peerId,
        remotePeerId: theirPeerId,
        privateKey: this.components.privateKey
      }), options.signal)
    } catch (err) {
      peerConnection.close()
      throw err
    }
  }
}
