import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '메디컨텐츠 QA 데모',
  description: '메디컨텐츠 포스팅 생성 및 검토를 위한 데모 웹페이지',
  icons: {
    icon: '/favicon.ico',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
