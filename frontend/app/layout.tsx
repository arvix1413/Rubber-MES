import type { Metadata } from 'next'
import './globals.css'
import { DialogProvider } from '@/components/Dialog'
import { Noto_Sans_TC, Noto_Serif_TC } from 'next/font/google'

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
  title: 'Rubber MES',
  description: '橡膠製造執行與訂單協同系統',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className={`${bodyFont.variable} ${brandFont.variable}`}>
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  )
}
