/** Tailwind v4 PostCSS config — required because Tailwind 4 ships a
 * dedicated PostCSS plugin and the traditional `tailwindcss` package
 * alone is no longer enough at the PostCSS layer. Stage 3 will move the
 * design tokens out of `app/globals.css` and into `@theme` blocks.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
