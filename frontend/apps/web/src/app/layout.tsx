import { Inter } from "next/font/google";
import { MuiThemeProvider } from './components/theme-provider';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { QueryProvider } from '@/lib/providers/QueryProvider';
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="no-transition">
      <head>
        <title>TechOffice - Affordable workspace operations for small teams</title>
        <meta name="description" content="TechOffice gives small and midsize businesses one secure workspace for chat, tasks, schedules, docs, files, and daily follow-up without enterprise complexity." />
      </head>
      <body
        className={`${inter.variable} antialiased`}
      >
        <AuthProvider>
          <QueryProvider>
            <MuiThemeProvider>
              {children}
            </MuiThemeProvider>
          </QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
