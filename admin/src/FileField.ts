import { FieldProps, StringField } from '@hfs/mui-grid-form'
import { createElement as h } from 'react'
import { InputAdornment } from '@mui/material'
import { Eject } from '@mui/icons-material'
import { IconBtn, useBreakpoint } from './misc'
import { newDialog } from '@hfs/shared'
import FilePicker from './FilePicker'
import { apiCall } from './api'

export default function FileField({ value, onChange, files=true, folders=false, fileMask, defaultPath, title, ...props }: FieldProps<string>) {
    const large = useBreakpoint('md')
    return h(StringField, {
        ...props,
        value,
        onChange,
        InputProps: {
            endAdornment: h(InputAdornment, { position: 'end' },
                h(IconBtn, {
                    icon: Eject,
                    title: "Browse files...",
                    edge: 'end',
                    onClick() {
                        const close = newDialog({
                            title: title ?? (files ? "Pick a file" : "Pick a folder"),
                            dialogProps: {
                                fullScreen: !large,
                                sx: { minWidth: 'min(90vw, 40em)', minHeight: 'calc(100vh - 9em)' }
                            },
                            Content() {
                                return h(FilePicker, {
                                    multiple: false,
                                    folders,
                                    files,
                                    fileMask,
                                    from: value || defaultPath,
                                    async onSelect(sel) {
                                        let one = sel?.[0]
                                        if (!one) return
                                        const cwd = (await apiCall('get_cwd'))?.path
                                        if (one.startsWith(cwd))
                                            one = one.slice(cwd.length+1)
                                        onChange(one, { was: value, event: 'picker' })
                                        close()
                                    }
                                })
                            },
                        })
                    },
                }))
        }
    })
}
