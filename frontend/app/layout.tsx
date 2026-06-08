import type { Metadata } from 'next'
import './globals.css'
import { DialogProvider } from '@/components/Dialog'
import { Noto_Sans_TC, Noto_Serif_TC } from 'next/font/google'
import NumberInputWheelGuard from '@/components/NumberInputWheelGuard'
import HorizontalTableWheelBridge from '@/components/HorizontalTableWheelBridge'

const bodyFont = Noto_Sans_TC({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
})

const brandFont = Noto_Serif_TC({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-brand',
})

export const metadata: Metadata = {
  title: 'ERP',
  description: '橡膠製造執行與訂單協同系統',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/apple-touch-icon.svg', type: 'image/svg+xml' },
    ],
    shortcut: ['/favicon.svg'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className={`${bodyFont.variable} ${brandFont.variable}`}>
        <NumberInputWheelGuard />
        <HorizontalTableWheelBridge />
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  )
}
