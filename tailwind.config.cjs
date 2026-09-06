/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx}"],
  theme: {
    // The UI is monospace throughout and takes every colour from the CSS
    // variables in track.css, so this is the only extension it needs.
    extend: {
      fontFamily: {
        mono: ["Roboto Mono", "Sarabun", "monospace"],
      },
    },
  },
};
