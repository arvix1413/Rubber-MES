'use client'

import { useEffect, useState } from 'react'
import { formatDecimal, parseDecimalInput } from '@/lib/numberFormat'

type DecimalInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value?: number | null
  digits?: number
  onValueChange: (value: number | undefined) => void
}

export default function DecimalInput({
  value,
  digits = 3,
  onValueChange,
  onBlur,
  onFocus,
  inputMode = 'decimal',
  type = 'text',
  ...props
}: DecimalInputProps) {
  const [text, setText] = useState(value == null ? '' : formatDecimal(value, digits))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (focused) return
    setText(value == null ? '' : formatDecimal(value, digits))
  }, [digits, focused, value])

  return (
    <input
      {...props}
      type={type}
      inputMode={inputMode}
      value={text}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      onChange={(event) => {
        const raw = event.target.value
        setText(raw)
        const parsed = parseDecimalInput(raw)
        if (parsed === undefined) {
          onValueChange(undefined)
        } else if (parsed !== null) {
          onValueChange(parsed)
        }
      }}
      onBlur={(event) => {
        setFocused(false)
        const parsed = parseDecimalInput(text)
        if (parsed === undefined) {
          setText('')
          onValueChange(undefined)
        } else if (parsed === null) {
          setText(value == null ? '' : formatDecimal(value, digits))
        } else {
          const normalized = formatDecimal(parsed, digits)
          setText(normalized)
          onValueChange(parsed)
        }
        onBlur?.(event)
      }}
    />
  )
}
