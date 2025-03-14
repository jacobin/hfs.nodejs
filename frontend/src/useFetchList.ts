// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { useEffect, useRef } from 'react'
import { apiEvents } from './api'
import { DirEntry, DirList, usePath } from './BrowseFiles'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'

export default function useFetchList() {
    const snap = useSnapState()
    const desiredPath = usePath()
    const search = snap.remoteSearch || undefined
    const lastPath = useRef('')

    useEffect(()=>{
        const previous = lastPath.current
        lastPath.current = desiredPath
        if (previous !== desiredPath) {
            state.showFilter = false
            state.stopSearch?.()
        }
        state.stoppedSearch = false
        if (previous !== desiredPath && search) {
            state.remoteSearch = ''
            return
        }

        const API = 'file_list'
        const baseParams = { path:desiredPath, search, sse:true, omit:'c' }
        state.list = []
        state.filteredList = undefined
        state.selected = {}
        state.loading = true
        state.error = undefined
        // buffering entries is necessary against burst of events that will hang the browser
        const buffer: DirList = []
        const flush = () => {
            const chunk = buffer.splice(0, Infinity)
            if (chunk.length)
                state.list = sort([...state.list, ...chunk.map(precalculate)])
        }
        const timer = setInterval(flush, 1000)
        const src = apiEvents(API, baseParams, (type, data) => {
            switch (type) {
                case 'error':
                    state.stopSearch?.()
                    state.error = JSON.stringify(data)
                    return
                case 'closed':
                    flush()
                    state.stopSearch?.()
                    state.loading = false
                    return
                case 'msg':
                    data.forEach((data: any) => {
                        if (data.add)
                            return buffer.push(data.add)
                        const { error } = data
                        if (error === 405) { // "method not allowed" happens when we try to directly access an unauthorized file, and we get a login prompt, and then file_list the file (because we didn't know it was file or folder)
                            state.messageOnly = "Your download should now start"
                            window.location.reload() // reload will start the download, because now we got authenticated
                            return
                        }
                        if (error) {
                            state.stopSearch?.()
                            state.error = (ERRORS as any)[error] || String(error)
                            state.loginRequired = error === 401
                            return
                        }
                    })
                    if (src?.readyState === src?.CLOSED)
                        return state.stopSearch?.()
            }
        })
        state.stopSearch = ()=>{
            state.stopSearch = undefined
            buffer.length = 0
            state.loading = false
            clearInterval(timer)
            src.close()
        }
    }, [desiredPath, search, snap.username, snap.listReloader])
}

const ERRORS = {
    404: "Not found"
}

export function reloadList() {
    state.listReloader = Date.now()
}

const { compare:localCompare } = new Intl.Collator(navigator.language)

function sort(list: DirList) {
    const { sortBy, foldersFirst } = state
    // optimization: precalculate string comparisons
    const bySize = sortBy === 'size'
    const byExt = sortBy === 'extension'
    const byTime = sortBy === 'time'
    const invert = state.invertOrder ? -1 : 1
    return list.sort((a,b) =>
        foldersFirst && -compare(a.isFolder, b.isFolder)
        || invert*(bySize ? compare(a.s||0, b.s||0)
            : byExt ? localCompare(a.ext, b.ext)
                : byTime ? compare(a.t, b.t)
                    : 0
        )
        || invert*localCompare(a.n, b.n) // fallback to name/path
    )
}

function precalculate(rec:DirEntry) {
    const i = rec.n.lastIndexOf('.') + 1
    rec.ext = i ? rec.n.substring(i) : ''
    rec.isFolder = rec.n.endsWith('/')
    const t = rec.m || rec.c
    if (t)
        rec.t = new Date(t)
    return rec
}

// generic comparison
function compare(a:any, b:any) {
    return a < b ? -1 : a > b ? 1 : 0
}

// update list on sorting criteria
const sortAgain = _.debounce(()=> state.list = sort(state.list), 100)
subscribeKey(state, 'sortBy', sortAgain)
subscribeKey(state, 'invertOrder', sortAgain)
subscribeKey(state, 'foldersFirst', sortAgain)

subscribeKey(state, 'patternFilter', v => {
    if (!v)
        return state.filteredList = undefined
    const filter = new RegExp(_.escapeRegExp(v),'i')
    const newList = []
    for (const entry of state.list)
        if (filter.test(entry.n))
            newList.push(entry)
    state.filteredList = newList
})
