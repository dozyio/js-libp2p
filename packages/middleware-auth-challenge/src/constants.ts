export const PROTOCOL_PREFIX = 'libp2p'
export const PROTOCOL_NAME = 'auth-challenge'
export const PROTOCOL_VERSION = '1.0.0'

export const AUTH_CHALLENGE_PROTOCOL = `/${PROTOCOL_PREFIX}/${PROTOCOL_NAME}/${PROTOCOL_VERSION}`

export const MAX_INBOUND_STREAMS = 1
export const MAX_OUTBOUND_STREAMS = 1

// Default timeout for challenge response (in ms)
export const TIMEOUT = 10000

// Size of the random challenge in bytes
export const CHALLENGE_SIZE = 16
