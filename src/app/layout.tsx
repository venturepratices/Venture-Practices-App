import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Venture Practices",
  description: "Venture Practices agency operations platform",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Venture Practices",
  },
};

export const viewport: Viewport = {
  themeColor: "#2d94c0",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {children}
          <PwaRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
