// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import glob from 'fast-glob'
import { watchLoad } from './watchLoad'
import _ from 'lodash'
import pathLib, { join } from 'path'
import { API_VERSION, APP_PATH, COMPATIBLE_API_VERSION, PLUGINS_PUB_URI } from './const'
import * as Const from './const'
import Koa from 'koa'
import {
    adjustStaticPathForGlob,
    Callback,
    debounceAsync,
    Dict,
    getOrSet,
    onProcessExit,
    same,
    tryJson,
    wantArray,
    watchDir
} from './misc'
import { defineConfig, getConfig } from './config'
import { DirEntry } from './api.file_list'
import { VfsNode } from './vfs'
import { serveFile } from './serveFile'
import events from './events'
import { readFile } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { getConnections } from './connections'

export const PATH = 'plugins'
export const DISABLING_POSTFIX = '-disabled'

const plugins: Record<string, Plugin> = {}

export function isPluginRunning(id: string) {
    return plugins[id]?.started
}

export function enablePlugin(id: string, state=true) {
    enablePlugins.set( arr =>
        arr.includes(id) === state ? arr
            : state ? [...arr, id]
                : arr.filter((x: string) => x !== id)
    )
}

// nullish values are equivalent to defaultValues
export function setPluginConfig(id: string, changes: Dict) {
    pluginsConfig.set(allConfigs => {
        const fields = getPluginConfigFields(id)
        const oldConfig = allConfigs[id]
        const newConfig = _.pickBy({ ...oldConfig, ...changes },
            (v, k) => v != null && !same(v, fields?.[k]?.defaultValue))
        return { ...allConfigs, [id]: _.isEmpty(newConfig) ? undefined : newConfig }
    })
}

export function getPluginInfo(id: string) {
    return plugins[id]?.getData() ?? availablePlugins[id]
}

export function mapPlugins<T>(cb:(plugin:Readonly<Plugin>, pluginName:string)=> T) {
    return _.map(plugins, (pl,plName) => {
        try { return cb(pl,plName) }
        catch(e) {
            console.log('plugin error', plName, String(e))
        }
    }).filter(x => x !== undefined) as Exclude<T,undefined>[]
}

export function getPluginConfigFields(id: string) {
    return plugins[id]?.getData().config
}

export function pluginsMiddleware(): Koa.Middleware {
    return async (ctx, next) => {
        const after = []
        // run middleware plugins
        for (const id in plugins)
            try {
                const pl = plugins[id]
                const res = await pl.middleware?.(ctx)
                if (res === true)
                    ctx.pluginStopped = true
                if (typeof res === 'function')
                    after.push(res)
            }
            catch(e){
                console.log('error middleware plugin', id, String(e))
                console.debug(e)
            }
        // expose public plugins' files
        const { path } = ctx
        if (!ctx.pluginStopped) {
            if (path.startsWith(PLUGINS_PUB_URI)) {
                const a = path.substring(PLUGINS_PUB_URI.length).split('/')
                if (plugins.hasOwnProperty(a[0])) { // do it only if the plugin is loaded
                    a.splice(1, 0, 'public')
                    await serveFile(PATH + '/' + a.join('/'), 'auto')(ctx, next)
                }
            }
            await next()
        }
        for (const f of after)
            await f()
    }
}

// return false to ask to exclude this entry from results
interface OnDirEntryParams { entry:DirEntry, ctx:Koa.Context, node:VfsNode }
type OnDirEntry = (params:OnDirEntryParams) => void | false

export class Plugin {
    started = new Date()

    constructor(readonly id:string, private readonly data:any, private unwatch:()=>void){
        if (!data) throw 'invalid data'
        // if a previous instance is present, we are going to overwrite it, but first call its unload callback
        const old = plugins[id]
        try { old?.data?.unload?.() } // we don't want all the effects of the Plugin.unload
        catch(e){
            console.debug('error unloading plugin', id, String(e))
        }
        // track this
        const wasStopped = availablePlugins[id]
        if (wasStopped)
            delete availablePlugins[id]
        plugins[id] = this

        this.data = data = { ...data } // clone to make object modifiable. Objects coming from import are not.
        // some validation
        for (const k of ['frontend_css', 'frontend_js']) {
            const v = data[k]
            if (typeof v === 'string')
                data[k] = [v]
            else if (v && !Array.isArray(v)) {
                delete data[k]
                console.warn('invalid', k)
            }
        }
        events.emit(old || wasStopped ? 'pluginStarted' : 'pluginInstalled', this)
    }
    get middleware(): undefined | PluginMiddleware {
        return this.data?.middleware
    }
    get frontend_css(): undefined | string[] {
        return this.data?.frontend_css
    }
    get frontend_js(): undefined | string[] {
        return this.data?.frontend_js
    }
    get onDirEntry(): undefined | OnDirEntry {
        return this.data?.onDirEntry
    }

    getData(): any {
        return { ...this.data }
    }

    async unload() {
        const { id } = this
        console.log('unloading plugin', id)
        try { await this.data?.unload?.() }
        catch(e) {
            console.debug('error unloading plugin', id, String(e))
        }
        delete plugins[id]
        this.unwatch()
        if (availablePlugins[id])
            events.emit('pluginStopped', availablePlugins[id])
        else
            events.emit('pluginUninstalled', id)
    }
}

type PluginMiddleware = (ctx:Koa.Context) => void | Stop | CallMeAfter
type Stop = true
type CallMeAfter = ()=>void

export interface AvailablePlugin {
    id: string
    description?: string
    version?: number
    apiRequired?: number | [number,number]
    repo?: string
    branch?: string
    badApi?: string
}

let availablePlugins: Record<string, AvailablePlugin> = {}

export function getAvailablePlugins() {
    return Object.values(availablePlugins)
}

const rescanAsap = debounceAsync(rescan, 1000)
if (!existsSync(PATH))
    try { mkdirSync(PATH) }
    catch {}
export const pluginsWatcher = watchDir(PATH, rescanAsap)

export const enablePlugins = defineConfig('enable_plugins', ['antibrute'])
enablePlugins.sub(rescanAsap)

export const pluginsConfig = defineConfig('plugins_config', {} as Record<string,any>)

export async function rescan() {
    console.debug('scanning plugins')
    const found = []
    const foundDisabled: typeof availablePlugins = {}
    const MASK = PATH + '/*/plugin.js' // be sure to not use path.join as fast-glob doesn't work with \
    for (const f of await glob([adjustStaticPathForGlob(APP_PATH) + '/' + MASK, MASK])) {
        const id = f.split('/').slice(-2)[0]
        if (id.endsWith(DISABLING_POSTFIX)) continue
        if (!enablePlugins.get().includes(id)) {
            try {
                const source = await readFile(f, 'utf8')
                foundDisabled[id] = parsePluginSource(id, source)
            }
            catch {}
            continue
        }
        found.push(id)
        if (plugins[id]) // already loaded
            continue
        const module = pathLib.resolve(f)
        const { unwatch } = watchLoad(f, async () => {
            try {
                const reloading = plugins[id]
                console.log(reloading ? "reloading plugin" : "loading plugin", id)
                const { init, ...data } = await import(module)
                delete data.default
                deleteModule(require.resolve(module)) // avoid caching at next import
                calculateBadApi(data)
                if (data.badApi)
                    console.log("plugin", id, data.badApi)

                const res = await init?.call(null, {
                    srcDir: __dirname,
                    const: Const,
                    require,
                    getConnections,
                    events,
                    log(...args: any[]) {
                        console.log('plugin', id, ':', ...args)
                    },
                    getConfig: (cfgKey: string) =>
                        pluginsConfig.get()?.[id]?.[cfgKey] ?? data.config?.[cfgKey]?.defaultValue,
                    setConfig: (cfgKey: string, value: any) =>
                        setPluginConfig(id, { [cfgKey]: value }),
                    subscribeConfig(cfgKey: string, cb: Callback<any>) {
                        let last = this.getConfig(cfgKey)
                        cb(last)
                        return pluginsConfig.sub(() => {
                            const now = this.getConfig(cfgKey)
                            if (!same(now, last))
                                cb(last = now)
                        })
                    },
                    getHfsConfig: getConfig,
                })
                Object.assign(data, res)
                new Plugin(id, data, unwatch)
                if (reloading)
                    events.emit('pluginUpdated', getPluginInfo(id))
            } catch (e) {
                console.log("plugin error:", e)
            }
        })
    }
    for (const id in foundDisabled) {
        const p = foundDisabled[id]
        const a = availablePlugins[id]
        if (same(a, p)) continue
        availablePlugins[id] = p
        if (a)
            events.emit('pluginUpdated', p)
        else if (!plugins[id])
            events.emit('pluginInstalled', p)
    }
    for (const id in availablePlugins)
        if (!foundDisabled[id] && !found.includes(id) && !plugins[id]) {
            delete availablePlugins[id]
            events.emit('pluginUninstalled', id)
        }
    for (const id in plugins)
        if (!found.includes(id))
            await plugins[id].unload()
}

function deleteModule(id: string) {
    const { cache } = require
    // build reversed map of dependencies
    const requiredBy: Record<string,string[]> = { '.':['.'] } // don't touch main entry
    for (const k in cache)
        if (k !== id)
            for (const child of wantArray(cache[k]?.children))
                getOrSet(requiredBy, child.id, ()=> [] as string[]).push(k)
    const deleted: string[] = []
    recur(id)

    function recur(id: string) {
        let mod = cache[id]
        if (!mod) return
        delete cache[id]
        deleted.push(id)
        for (const child of mod.children)
            if (! _.difference(requiredBy[child.id], deleted).length)
                recur(child.id)
    }
}

onProcessExit(() =>
    Promise.allSettled(mapPlugins(pl => pl.unload())))

export function parsePluginSource(id: string, source: string) {
    const pl: AvailablePlugin = { id }
    pl.description = tryJson(/exports.description *= *(".*")/.exec(source)?.[1])
    pl.repo = /exports.repo *= *"(.*)"/.exec(source)?.[1]
    pl.version = Number(/exports.version *= *(\d*\.?\d+)/.exec(source)?.[1]) ?? undefined
    pl.apiRequired = tryJson(/exports.apiRequired *= *([ \d.,[\]]+)/.exec(source)?.[1]) ?? undefined
    if (Array.isArray(pl.apiRequired) && (pl.apiRequired.length !== 2 || !pl.apiRequired.every(_.isFinite))) // validate [from,to] form
        pl.apiRequired = undefined
    calculateBadApi(pl)
    return pl
}

function calculateBadApi(data: AvailablePlugin) {
    const r = data.apiRequired
    const [min, max] = Array.isArray(r) ? r : [r, r] // normalize data type
    data.badApi = min! > API_VERSION ? "may not work correctly as it is designed for a newer version of HFS - check for updates"
        : max! < COMPATIBLE_API_VERSION ? "may not work correctly as it is designed for an older version of HFS - check for updates"
            : undefined
}
