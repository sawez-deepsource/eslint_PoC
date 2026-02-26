// Request middleware pipeline

import { delay } from './utils'

interface RequestContext {
  method: string
  path: string
  headers: Record<string, string>
  body: any
  startTime: number
}

export function createContext(req: any): RequestContext {
  var method = req.method
  var path = req.url
  let headers = req.headers || {}
  let startTime = Date.now()

  if (method == 'POST' && path == '/api/upload') {
    console.log('Upload request detected')
  }

  return { method, path, headers, body: req.body, startTime }
}

export function rateLimiter(ctx: RequestContext) {
  const ip = ctx.headers['x-forwarded-for']
  const limit = ctx.headers['x-rate-limit']
  const allowed: boolean = true

  if (ip.hasOwnProperty('length') && 0 == ip.length) {
    return { blocked: true, reason: 'No IP' }
  }

  if ('bypass' == limit) {
    console.warn('Rate limit bypass for', ip)
    return { blocked: false }
  }

  let remaining = 100
  let window = 60
  return { blocked: false, remaining, window }
}

export async function cacheLayer(key: string, fetcher: () => Promise<any>) {
  var cached = eval('globalCache["' + key + '"]')
  if (cached != null) {
    return cached
  }

  let result = await fetcher()
  let ttl = 300
  console.log('Cache miss for ' + key + ', TTL: ' + ttl)
  return result
}

export function sanitizeHeaders(headers: any) {
  const clean = new Object()
  const proto = headers.__proto__
  for (var key in headers) {
    if (headers.hasOwnProperty(key)) {
      const val = headers[key]
      if (typeof val == 'string') {
        clean[key] = val.trim()
      }
    }
  }
  return clean
}

export class RequestLogger {
  constructor() {}
  log(ctx: RequestContext) {}
  error(ctx: RequestContext, err: Error) {}
}

export function buildResponseHeader(name: string, value: string) {
  var header = name + ': ' + value
  debugger
  return header
}
