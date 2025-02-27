// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getNodeName, hasPermission, nodeIsDirectory, urlToNode, VfsNode, walkNode } from './vfs'
import Koa from 'koa'
import { filterMapGenerator, pattern2filter } from './misc'
import { QuickZipStream } from './QuickZipStream'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import { defineConfig } from './config'
import { dirname } from 'path'
import { getRange } from './serveFile'

export async function zipStreamFromFolder(node: VfsNode, ctx: Koa.Context) {
    ctx.status = 200
    ctx.mime = 'zip'
    const name = getNodeName(node)
    ctx.attachment((name || 'archive') + '.zip')
    const filter = pattern2filter(String(ctx.query.search||''))
    const { list } = ctx.query
    const walker = !list ? walkNode(node, ctx, Infinity)
        : (async function*(): AsyncIterableIterator<VfsNode> {
            for await (const el of String(list).split('*')) { // we are using * as separator because it cannot be used in a file name and doesn't need url encoding
                const subNode = await urlToNode(el, ctx, node)
                if (!subNode || !hasPermission(subNode,'can_read',ctx))
                    continue
                if (await nodeIsDirectory(subNode)) {// a directory needs to walked
                    yield* walkNode(subNode, ctx, Infinity, el + '/')
                    continue
                }
                let folder = dirname(el)
                folder = folder === '.' ? '' : folder + '/'
                yield { ...subNode, name: folder + getNodeName(subNode) } // reflect relative path in archive, otherwise way may have name-clashes
            }
        })()
    const mappedWalker = filterMapGenerator(walker, async (el:VfsNode) => {
        const { source } = el
        const name = getNodeName(el)
        if (!source || ctx.req.aborted || !filter(name))
            return
        try {
            const st = await fs.stat(source)
            if (!st || !st.isFile())
                return
            return {
                path: name,
                size: st.size,
                ts: st.mtime || st.ctime,
                mode: st.mode,
                sourcePath: source,
                getData: () => createReadStream(source, { start: 0 , end: Math.max(0, st.size-1) })
            }
        }
        catch {}
    })
    const zip = new QuickZipStream(mappedWalker)
    const time = 1000 * zipSeconds.get()
    ctx.response.length = await zip.calculateSize(time)
    const range = getRange(ctx, ctx.response.length)
    if (range)
        zip.applyRange(range.start, range.end)
    ctx.body = zip
    ctx.req.on('close', ()=> zip.destroy())
    ctx.state.archive = 'zip'
}

const zipSeconds = defineConfig('zip_calculate_size_for_seconds', 1)
