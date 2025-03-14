// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import * as http from 'http'
import { defineConfig } from './config'
import { app } from './index'
import * as https from 'https'
import { watchLoad } from './watchLoad'
import { networkInterfaces } from 'os';
import { newConnection } from './connections'
import open from 'open'
import { debounceAsync, onlyTruthy, wait } from './misc'
import { ADMIN_URI, DEV } from './const'
import findProcess from 'find-process'
import { anyAccountCanLoginAdmin } from './perm'

interface ServerExtra { name: string, error?: string, busy?: Promise<string> }
let httpSrv: http.Server & ServerExtra
let httpsSrv: http.Server & ServerExtra

const openBrowserAtStart = defineConfig('open_browser_at_start', !DEV)

export const portCfg = defineConfig<number>('port', 80)
portCfg.sub(async port => {
    while (!app)
        await wait(100)
    stopServer(httpSrv).then()
    httpSrv = Object.assign(http.createServer(app.callback()), { name: 'http' })
    port = await startServer(httpSrv, { port })
    if (!port) return
    httpSrv.on('connection', newConnection)
    printUrls(port, 'http')
    if (openBrowserAtStart.get())
        open('http://localhost' + (port === 80 ? '' : ':' + port) + ADMIN_URI, { wait: true}).catch(e => {
            console.debug(String(e))
            console.warn("cannot launch browser on this machine >PLEASE< open your browser and reach one of these (you may need a different address)",
                ...Object.values(getUrls()).flat().map(x => '\n - ' + x + ADMIN_URI))
            if (! anyAccountCanLoginAdmin())
                console.log(`HINT: you can enter command: create-admin YOUR_PASSWORD`)
        })
})

const considerHttps = debounceAsync(async () => {
    stopServer(httpsSrv).then()
    let port = httpsPortCfg.get()
    try {
        while (!app)
            await wait(100)
        httpsSrv = Object.assign(
            https.createServer(port < 0 ? {} : { key: httpsOptions.private_key, cert: httpsOptions.cert }, app.callback()),
            { name: 'https', error: undefined }
        )
        if (port >= 0) {
            const namesForOutput: any = { cert: 'certificate', private_key: 'private key' }
            const missing = httpsNeeds.find(x => !x.get())?.key()
            if (missing)
                return httpsSrv.error = "missing " + namesForOutput[missing]
            const cantRead = httpsNeeds.find(x => !httpsOptions[x.key() as HttpsKeys])?.key()
            if (cantRead)
                return httpsSrv.error = "cannot read " + namesForOutput[cantRead]
        }
    }
    catch(e) {
        httpsSrv.error = "bad private key or certificate"
        console.log("failed to create https server: check your private key and certificate", String(e))
        return
    }
    port = await startServer(httpsSrv, { port })
    if (!port) return
    httpsSrv.on('connection', newConnection)
    printUrls(port, 'https')
})


const cert = defineConfig<string>('cert')
const privateKey = defineConfig<string>('private_key')
const httpsNeeds = [cert, privateKey]
const httpsOptions = { cert: '', private_key: '' }
type HttpsKeys = keyof typeof httpsOptions
for (const cfg of httpsNeeds) {
    let unwatch: ReturnType<typeof watchLoad>['unwatch']
    cfg.sub(async v => {
        unwatch?.()
        const k = cfg.key() as HttpsKeys
        httpsOptions[k] = v
        if (!v || v.includes('\n'))
            return considerHttps()
        // v is a path
        httpsOptions[k] = ''
        unwatch = watchLoad(v, data => {
            httpsOptions[k] = data
            considerHttps()
        }).unwatch
        await considerHttps()
    })
}

export const httpsPortCfg = defineConfig('https_port', -1)
httpsPortCfg.sub(considerHttps)

interface StartServer { port: number, host?:string }
function startServer(srv: typeof httpSrv, { port, host }: StartServer) {
    return new Promise<number>(async resolve => {
        try {
            if (port < 0 || !host && !await testIpV4()) // !host means ipV4+6, and if v4 port alone is busy we won't be notified of the failure, so we'll first test it on its own
                return resolve(0)
            port = await listen(host)
            if (port)
                console.log(srv.name, "serving on", host||"any network", ':', port)
            resolve(port)
        }
        catch(e) {
            srv.error = String(e)
            console.error(srv.name, "couldn't listen on port", port, srv.error)
            resolve(0)
        }
    })

    async function testIpV4() {
        const res = await listen('0.0.0.0')
        await new Promise(res => srv.close(res))
        return res > 0
    }

    function listen(host?: string) {
        return new Promise<number>(async (resolve, reject) => {
            srv.listen({ port, host }, () => {
                const ad = srv.address()
                if (!ad)
                    return reject('no address')
                if (typeof ad === 'string') {
                    srv.close()
                    return reject('type of socket not supported')
                }
                resolve(ad.port)
            }).on('error', async e => {
                srv.error = String(e)
                srv.busy = undefined
                const { code } = e as any
                if (code === 'EADDRINUSE') {
                    srv.busy = findProcess('port', port).then(res => res?.[0]?.name || '', () => '')
                    srv.error = `port ${port} busy: ${await srv.busy || "unknown process"}`
                }
                console.error(srv.name, srv.error)
                const k = (srv === httpSrv? portCfg : httpsPortCfg).key()
                console.log(` >> try specifying a different port, enter this command: config ${k} 8011`)
                resolve(0)
            })
        })
    }
}

function stopServer(srv: http.Server) {
    return new Promise(resolve => {
        if (!srv?.listening)
            return resolve(null)
        const ad = srv.address()
        if (ad && typeof ad !== 'string')
            console.log("stopped port", ad.port)
        srv.close(err => {
            if (err && (err as any).code !== 'ERR_SERVER_NOT_RUNNING')
                console.debug("failed to stop server", String(err))
            resolve(err)
        })
    })
}

export function getStatus() {
    return {
        httpSrv,
        httpsSrv,
    }
}

const ignore = /^(lo|.*loopback.*|virtualbox.*|.*\(wsl\).*|llw\d|awdl\d|utun\d|anpi\d)$/i // avoid giving too much information

export function getUrls() {
    return Object.fromEntries(onlyTruthy([httpSrv, httpsSrv].map(srv => {
        if (!srv?.listening)
            return false
        const port = (srv?.address() as any)?.port
        const appendPort = port === (srv.name === 'https' ? 443 : 80) ? '' : ':' + port
        const urls = onlyTruthy(Object.entries(networkInterfaces()).map(([name, nets]) =>
                nets && !ignore.test(name) && nets.map(net => {
                    if (net.internal) return
                    let { address } = net
                    if (address.includes(':'))
                        address = '[' + address + ']'
                    return srv.name + '://' + address + appendPort
                })
        ).flat())
        return urls.length && [srv.name, urls]
    })))
}

function printUrls(port: number, proto: string) {
    if (!port) return
    for (const [name, nets] of Object.entries(networkInterfaces())) {
        if (!nets) continue
        const filteredNets = nets.filter(n => !n.internal)
        if (!filteredNets.length || ignore.test(name)) continue
        console.log('network', name)
        for (const net of nets) {
            if (net.internal) continue
            const appendPort = port === (proto==='https' ? 443 : 80) ? '' : ':' + port
            let { address } = net
            if (address.includes(':'))
                address = '['+address+']'
            console.log('-', proto + '://' + address + appendPort)
        }
    }
}
