import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Montserrat, Nunito } from "next/font/google";
import { ThemeProvider, type ThemeMode } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

const THEME_COOKIE = "faithform:theme";

function parseThemeCookie(value: string | undefined): ThemeMode {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

export const metadata: Metadata = {
  title: "FaithForm",
  description: "Tools for small churches.",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: ["/favicon.ico"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieTheme = parseThemeCookie(
    cookies().get(THEME_COOKIE)?.value,
  );
  const htmlClass =
    cookieTheme === "dark"
      ? cn(nunito.variable, montserrat.variable, "dark")
      : cookieTheme === "light"
        ? cn(nunito.variable, montserrat.variable)
        : cn(nunito.variable, montserrat.variable);

  return (
    <html lang="en" className={htmlClass} suppressHydrationWarning>
      <head>
        {cookieTheme === "system" && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(()=>{try{const c=document.cookie.match(/(?:^|; )faithform:theme=([^;]+)/)?.[1]??'system';const d=c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
            }}
          />
        )}
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider initialMode={cookieTheme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
