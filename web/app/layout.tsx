import type { Metadata, Viewport } from 'next'
import './globals.css'
import { RegisterSW } from '@/components/RegisterSW'

export const metadata: Metadata = {
  title: 'Auto-Reply',
  description: 'Control your Beeper AI auto-reply bot',
  appleWebApp: { capable: true, title: 'Auto-Reply', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/192', apple: '/icons/180' },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#0f1115',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  )
}
