// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { hIcon } from './misc'
import { createElement as h, HTMLAttributes, ReactNode, useMemo } from 'react'

export function Spinner() {
    return hIcon('spinner', { className:'spinner' })
}

export function Flex({ gap='1em', vert=false, children=null }) {
    return h('div', {
        style: {
            display: 'flex',
            gap,
            flexDirection: vert ? 'column' : undefined,
        }
    }, children)
}

export function FlexV(props:any) {
    return h(Flex, { vert:true, ...props })
}

interface CheckboxProps { children?:ReactNode, value:any, onChange?:(v:boolean)=>void }
export function Checkbox({ onChange, value, children, ...props }:CheckboxProps) {
    return h('label', {},
        h('input',{
            type:'checkbox',
            onChange: ev => onChange?.(Boolean(ev.target.checked)),
            checked: Boolean(value),
            value: 1,
            ...props
        }),
        children
    )
}

type Options = { label:string, value:string }[]
interface SelectProps { value:any, onChange?:(v:string)=>void, options:Options }
export function Select({ onChange, value, options, ...props }:SelectProps) {
    return h('select', {
        onChange: ev => // @ts-ignore
            onChange?.(ev.target.value),
        value,
        ...props,
    }, options.map(({ value, label }) => h('option', { key:value, value }, label)))
}

export function Html({ code, ...rest }:{ code:string } & HTMLAttributes<any>) {
    const o = useMemo(() => ({ __html: code }), [code])
    if (!code)
        return null
    return h('span', { ...rest, dangerouslySetInnerHTML: o })
}
