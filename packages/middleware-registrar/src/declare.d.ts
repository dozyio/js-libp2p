// Type declarations for packages that might not have proper types

declare module '@libp2p/ping' {
  export type PingService = Record<string, any>
  export function ping (): any
}

declare module '@libp2p/identify' {
  export type Identify = Record<string, any>
  export function identify (): any
}

declare module '@libp2p/echo' {
  export type Echo = Record<string, any>
  export function echo (): any
}

