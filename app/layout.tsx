import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mobipium Offer Monitor',
  description: 'Monitor Mobipium CPA offers and track conversion times',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
