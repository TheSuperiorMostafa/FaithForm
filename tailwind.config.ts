import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

/**
 * Theme colours are CSS variables (so dark mode can swap them), and Tailwind
 * cannot add opacity to a bare `var(--x)`: classes like `bg-accent/10` or
 * `bg-primary/[0.07]` were silently never generated. Mixing with transparent
 * through Tailwind's `<alpha-value>` placeholder gives them real colours; a
 * class without a modifier mixes at 100%, which is the variable itself.
 */
function token(variable: string): string {
  return `color-mix(in srgb, var(${variable}) calc(<alpha-value> * 100%), transparent)`;
}

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        heading: ["var(--font-heading)", "var(--font-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        border: token("--border"),
        input: token("--input"),
        ring: token("--ring"),
        background: token("--background"),
        foreground: token("--foreground"),
        primary: {
          DEFAULT: token("--primary"),
          foreground: token("--primary-foreground"),
        },
        secondary: {
          DEFAULT: token("--secondary"),
          foreground: token("--secondary-foreground"),
        },
        destructive: {
          DEFAULT: token("--destructive"),
          foreground: token("--destructive-foreground"),
        },
        muted: {
          DEFAULT: token("--muted"),
          foreground: token("--muted-foreground"),
        },
        accent: {
          DEFAULT: token("--accent"),
          foreground: token("--accent-foreground"),
        },
        popover: {
          DEFAULT: token("--popover"),
          foreground: token("--popover-foreground"),
        },
        card: {
          DEFAULT: token("--card"),
          foreground: token("--card-foreground"),
        },
        sidebar: {
          DEFAULT: token("--sidebar-background"),
          foreground: token("--sidebar-foreground"),
          accent: token("--sidebar-accent"),
          border: token("--sidebar-border"),
        },
        brand: {
          navy: "#002D5F",
          gold: "#C5A059",
          lightGold: "#EBAA5F",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        card: "0 2px 12px rgba(0,45,95,0.07)",
        "card-hover": "0 10px 30px rgba(0,45,95,0.12)",
      },
      keyframes: {
        "skeleton-fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "skeleton-fade": "skeleton-fade-in 200ms ease-out 180ms both",
      },
    },
  },
  plugins: [tailwindAnimate],
};

export default config;
