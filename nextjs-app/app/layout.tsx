import './globals.css'
import type { Metadata } from 'next'
import { StoreHydrator } from '@/components/store-hydrator'
import { ThemeProvider } from '@/components/theme-provider'
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'SafeBill | Smart Warranty Vault',
  description: 'Scan invoices, track warranty deadlines, and manage claim-ready records with confidence.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", inter.variable)}>
      <body className="font-sans">
        <ThemeProvider>
          <StoreHydrator />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
