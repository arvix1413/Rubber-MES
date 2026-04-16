import type { Metadata } from 'next'
import './globals.css'
import { DialogProvider } from '@/components/Dialog'
import { IBM_Plex_Sans, Space_Grotesk } from 'next/font/google'

const bodyFont = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
})

const brandFont = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-brand',
})

export const metadata: Metadata = {
  title: 'Rubber MES',
  description: '橡胶制造执行与订单协同系统',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className={`${bodyFont.variable} ${brandFont.variable} bg-gray-50 text-gray-900`}>
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  )
}
