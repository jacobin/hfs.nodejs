// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import compress from 'koa-compress'
import Koa from 'koa'
import session from 'koa-session'
import { ADMIN_URI, BUILD_TIMESTAMP, DEV, FORBIDDEN, SESSION_DURATION } from './const'
import Application from 'koa'
import { FRONTEND_URI } from './const'
import { cantReadStatusCode, hasPermission, nodeIsDirectory, urlToNode } from './vfs'
import { dirTraversal } from './misc'
import { zipStreamFromFolder } from './zip'
import { serveFileNode } from './serveFile'
import { serveGuiFiles } from './serveGuiFiles'
import mount from 'koa-mount'
import { Readable } from 'stream'
import { applyBlock } from './block'
import { getAccount, getCurrentUsername } from './perm'
import { socket2connection, updateConnection, normalizeIp } from './connections'
import basicAuth from 'basic-auth'
import { SRPClientSession, SRPParameters, SRPRoutines } from 'tssrp6a'
import { srpStep1 } from './api.auth'

export const gzipper = compress({
    threshold: 2048,
    gzip: { flush: require('zlib').constants.Z_SYNC_FLUSH },
    deflate: { flush: require('zlib').constants.Z_SYNC_FLUSH },
    br: false, // disable brotli
    filter(type) {
        return /text|javascript|style/i.test(type)
    },
})

export const headRequests: Koa.Middleware = async (ctx, next) => {
    const head = ctx.method === 'HEAD'
    if (head)
        ctx.method = 'GET' // let other middlewares work, so we can collect the size at the end
    await next()
    if (!head || ctx.body === undefined) return
    const { length, status } = ctx.response
    if (ctx.body)
        ctx.body = Readable.from('') // empty the body for this is a HEAD request. Using Readable avoids koa from trying to set length to 0
    ctx.status = status
    if (length)
        ctx.response.length = length
}

export const sessions = (app: Application) => session({
    key: 'hfs_$id',
    signed: true,
    rolling: true,
    maxAge: SESSION_DURATION,
}, app)

const serveFrontendFiles = serveGuiFiles(process.env.FRONTEND_PROXY, FRONTEND_URI)
const serveFrontendPrefixed = mount(FRONTEND_URI.slice(0,-1), serveFrontendFiles)
const serveAdminPrefixed = mount(ADMIN_URI.slice(0,-1), serveGuiFiles(process.env.ADMIN_PROXY, ADMIN_URI))

export const serveGuiAndSharedFiles: Koa.Middleware = async (ctx, next) => {
    const { path } = ctx
    if (ctx.body)
        return next()
    if (path.startsWith(FRONTEND_URI))
        return serveFrontendPrefixed(ctx,next)
    if (path+'/' === ADMIN_URI)
        return ctx.redirect(ADMIN_URI)
    if (path.startsWith(ADMIN_URI))
        return serveAdminPrefixed(ctx,next)
    const node = await urlToNode(path, ctx)
    if (!node)
        return ctx.status = 404
    const canRead = hasPermission(node, 'can_read', ctx)
    const isFolder = await nodeIsDirectory(node)
    if (isFolder && !path.endsWith('/'))
        return ctx.redirect(path + '/')
    if (canRead && !isFolder)
        return node.source ? serveFileNode(node)(ctx,next)
            : next()
    if (!canRead) {
        ctx.status = cantReadStatusCode(node)
        if (ctx.status === FORBIDDEN)
            return
        const browserDetected = ctx.get('Upgrade-Insecure-Requests') || ctx.get('Sec-Fetch-Mode') // ugh, heuristics
        if (!browserDetected) // we don't want to trigger basic authentication on browsers, it's meant for download managers only
            ctx.set('WWW-Authenticate', 'Basic') // we support basic authentication
        ctx.state.serveApp = true
        return serveFrontendFiles(ctx, next)
    }
    ctx.set({ server:'HFS '+BUILD_TIMESTAMP })
    const { get } = ctx.query
    if (get === 'zip')
        return await zipStreamFromFolder(node, ctx)
    if (node.default) {
        const def = await urlToNode(path + node.default, ctx)
        return !def ? next()
            : hasPermission(def, 'can_read', ctx) ? serveFileNode(def)(ctx, next)
            : ctx.status = cantReadStatusCode(def)
    }
    return serveFrontendFiles(ctx, next)
}

let proxyDetected = false
export const someSecurity: Koa.Middleware = async (ctx, next) => {
    ctx.request.ip = normalizeIp(ctx.ip)
    try {
        let proxy = ctx.get('X-Forwarded-For')
        // we have some dev-proxies to ignore
        if (DEV && proxy && [process.env.FRONTEND_PROXY, process.env.ADMIN_PROXY].includes(ctx.get('X-Forwarded-port')))
            proxy = ''
        if (dirTraversal(decodeURI(ctx.path)))
            return ctx.status = 418
        if (applyBlock(ctx.socket, ctx.ip))
            return
        proxyDetected ||= proxy > ''
        ctx.state.proxiedFor = proxy
    }
    catch {
        return ctx.status = 418
    }
    return next()
}

// this is only about http proxies
export function getProxyDetected() {
    return proxyDetected
}
export const prepareState: Koa.Middleware = async (ctx, next) => {
    // calculate these once and for all
    ctx.state.account = await getHttpAccount(ctx) ?? getAccount(getCurrentUsername(ctx))
    const conn = ctx.state.connection = socket2connection(ctx.socket)
    await next()
    if (conn)
        updateConnection(conn, { ctx })
}

async function getHttpAccount(ctx: Koa.Context) {
    const credentials = basicAuth(ctx.req)
    const account = getAccount(credentials?.name||'')
    if (account && await srpCheck(account.username, credentials!.pass))
        return account
}

async function srpCheck(username: string, password: string) {
    username = username.toLocaleLowerCase()
    const account = getAccount(username)
    if (!account?.srp || !password) return false
    const { step1, salt, pubKey } = await srpStep1(account)
    const client = new SRPClientSession(new SRPRoutines(new SRPParameters()))
    const clientRes1 = await client.step1(username, password)
    const clientRes2 = await clientRes1.step2(BigInt(salt), BigInt(pubKey))
    return await step1.step2(clientRes2.A, clientRes2.M1).then(() => true, () => false)
}
