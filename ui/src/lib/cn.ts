import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...c: (string | undefined | false)[]) => twMerge(clsx(c))
