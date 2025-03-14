// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { EventEmitter } from 'events'
import { basename } from 'path'
import _ from 'lodash'
import Koa from 'koa'
import { Connection } from './connections'
import assert from 'assert'
export * from './util-http'
export * from './util-generators'
export * from './util-files'
import debounceAsync from './debounceAsync'
export { debounceAsync }

export type Callback<IN=void, OUT=void> = (x:IN) => OUT
export type Dict<T = any> = Record<string, T>

export function enforceFinal(sub:string, s:string) {
    return s.endsWith(sub) ? s : s+sub
}

export function prefix(pre:string, v:string|number, post:string='') {
    return v ? pre+v+post : ''
}

export function setHidden<T, ADD>(dest: T, src: ADD) {
    return Object.defineProperties(dest, objSameKeys(src as any, value => ({
        enumerable: false,
        writable: true,
        value,
    }))) as T & ADD
}

export function objSameKeys<S extends object,VR=any>(src: S, newValue:(value:Truthy<S[keyof S]>, key:keyof S)=>any) {
    return Object.fromEntries(Object.entries(src).map(([k,v]) => [k, newValue(v,k as keyof S)])) as { [K in keyof S]:VR }
}

export function wait(ms: number) {
    return new Promise(res=> setTimeout(res,ms))
}

export function wantArray<T>(x?: void | T | T[]) {
    return x == null ? [] : Array.isArray(x) ? x : [x]
}

export function getOrSet<T>(o: Record<string,T>, k:string, creator:()=>T): T {
    return k in o ? o[k]
        : (o[k] = creator())
}

export function randomId(len = 10) {
    // 10 chars is 51+bits, the max we can give. 8 is 41+bits
    if (len > 10) throw Error('bad length');
    return Math.random()
        .toString(36)
        .substring(2, 2+len)
        .replace(/l/g, 'L'); // avoid confusion reading l1
}

type ProcessExitHandler = (signal:string) => any
const cbs = new Set<ProcessExitHandler>()
export function onProcessExit(cb: ProcessExitHandler) {
    cbs.add(cb)
    return () => cbs.delete(cb)
}
onFirstEvent(process, ['exit', 'SIGQUIT', 'SIGTERM', 'SIGINT', 'SIGHUP'], signal =>
    Promise.allSettled(Array.from(cbs).map(cb => cb(signal))).then(() =>
        process.exit(0)))

export function onFirstEvent(emitter:EventEmitter, events: string[], cb: (...args:any[])=> void) {
    let already = false
    for (const e of events)
        emitter.on(e, (...args) => {
            if (already) return
            already = true
            cb(...args)
        })
}

export function pattern2filter(pattern: string){
    const re = new RegExp(_.escapeRegExp(pattern), 'i')
    return (s?:string) =>
        !s || !pattern || re.test(basename(s))
}

type Truthy<T> = T extends false | '' | 0 | null | undefined ? never : T

export function truthy<T>(value: T): value is Truthy<T> {
    return Boolean(value)
}

export function onlyTruthy<T>(arr: T[]) {
    return arr.filter(truthy)
}

type PendingPromise<T> = Promise<T> & { resolve: (value: T) => void, reject: (reason?: any) => void }
export function pendingPromise<T>() {
    let takeOut
    const ret = new Promise<T>((resolve, reject) =>
        takeOut = { resolve, reject })
    return Object.assign(ret, takeOut) as PendingPromise<T>
}

// install multiple handlers and returns a handy 'uninstall' function which requires no parameter. Pass a map {event:handler}
export function onOff(em: EventEmitter, events: { [eventName:string]: (...args: any[]) => void }) {
    events = { ...events } // avoid later modifications, as we need this later for uninstallation
    for (const [k,cb] of Object.entries(events))
        for (const e of k.split(' '))
            em.on(e, cb)
    return () => {
        for (const [k,cb] of Object.entries(events))
            for (const e of k.split(' '))
                em.off(e, cb)
    }
}

export function objRenameKey(o: Dict | undefined, from: string, to: string) {
    if (!o || !o.hasOwnProperty(from) || from === to) return
    o[to] = o[from]
    delete o[from]
    return true
}

export function typedKeys<T extends {}>(o: T) {
    return Object.keys(o) as (keyof T)[]
}

export function with_<T,RT>(par:T, cb: (par:T) => RT) {
    return cb(par)
}

export function isLocalHost(c: Connection | Koa.Context) {
    const ip = c.socket.remoteAddress // don't use Context.ip as it is subject to proxied ips, and that's no use for localhost detection
    return ip && (ip === '::1' || ip.endsWith('127.0.0.1'))
}

export function same(a: any, b: any) {
    try {
        assert.deepStrictEqual(a, b)
        return true
    }
    catch { return false }
}

export function tryJson(s?: string) {
    try { return s && JSON.parse(s) }
    catch {}
}
