import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Beeper Auto-Reply',
    short_name: 'Auto-Reply',
    description: 'Control your Beeper AI auto-reply bot',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f1115',
    theme_color: '#0f1115',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
