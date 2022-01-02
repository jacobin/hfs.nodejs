import Koa from 'koa'
import mount from 'koa-mount'
import bodyParser from 'koa-bodyparser'
import { apiMiddleware } from './apis'
import { serveFrontend } from './serveFrontend'
import { API_URI, DEV, FRONTEND_URI } from './const'
import { serveFile } from './serveFile'
import { vfs } from './vfs'
import { isDirectory } from './misc'
import proxy from 'koa-better-http-proxy'
import compress from 'koa-compress'
// @ts-ignore
import accesslog from 'koa-accesslog'
import { Server } from 'http'
import { subscribe } from './config'
import session from 'koa-session'
import { zipStreamFromFolder } from './zip'
import { frontEndApis } from './frontEndApis'
import { createWriteStream } from 'fs'
import { Writable } from 'stream'

const BUILD_TIMESTAMP = ""

console.log('started', new Date().toLocaleString())
const app = new Koa()
app.keys = ['hfs-keys-test']
app.use(session({
    key: 'hfs_$id',
    signed: true,
    rolling: true,
    maxAge: 30*60_000,
}, app))

let logMw: Koa.Middleware
let logStream: Writable
subscribe('log', path => {
    console.debug('log file: '+(path || 'disabled'))
    logStream?.end()
    logStream = path && createWriteStream(path, { flags:'a' })
    logMw = accesslog(logStream)
}, 'access.log')
app.use((ctx, next) => logMw?.(ctx,next)) // wrapping in a function will make it use current value

// serve apis
app.use(mount(API_URI, new Koa()
    .use(bodyParser())
    .use(apiMiddleware(frontEndApis))
    .use(compress({
        threshold: 2048,
        gzip: { flush: require('zlib').constants.Z_SYNC_FLUSH },
        deflate: { flush: require('zlib').constants.Z_SYNC_FLUSH },
        br: false // disable brotli
    }))
))

// serve shared files and front-end files
const serveFrontendPrefixed = mount(FRONTEND_URI.slice(0,-1), serveFrontend)
app.use(async (ctx, next) => {
    const { path } = ctx
    if (ctx.body)
        return await next()
    if (path.startsWith(FRONTEND_URI))
        return await serveFrontendPrefixed(ctx,next)
    const decoded = decodeURI(path)
    const node = await vfs.urlToNode(decoded, ctx)
    if (!node)
        return await next()
    const { source } = node
    if (!source || await isDirectory(source)) {
        const { get } = ctx.query
        if (get === 'zip')
            return await zipStreamFromFolder(node, ctx)
        if (!path.endsWith('/')) // this folder was requested without the trailing /
            return ctx.redirect(path + '/')
        if (node.default) {
            const def = await vfs.urlToNode(decoded + node.default, ctx)
            if (def)
                return serveFile(def)(ctx, next)
        }
        ctx.set({ server:'HFS '+BUILD_TIMESTAMP })
        return await serveFrontend(ctx, next)
    }
    if (source)
        return source.includes('//') ? mount(path,proxy(source,{}))(ctx,next)
            : serveFile(node)(ctx,next)
    await next()
})

app.on('error', err => {
    if (DEV && err.code === 'ENOENT' && err.path.endsWith('sockjs-node')) return // spam out
    if (err.code === 'ECONNRESET') return // someone interrupted, don't care
    console.error('server error', err)
})

let srv: Server
subscribe('port', async (port: number) => {
    await new Promise(resolve => {
        if (!srv)
            return resolve(null)
        srv.close(err => {
            if (err)
                console.debug('failed to stop server', err)
            resolve(err)
        })
    })
    await new Promise(resolve => {
        srv = app.listen(port, () => {
            console.log('running on port', port, DEV)
            resolve(null)
        }).on('error', e => {
            const { code } = e as any
            if (code === 'EADDRINUSE')
                console.error(`couldn't listen on busy port ${port}`)
        })
    })
}, 80)
