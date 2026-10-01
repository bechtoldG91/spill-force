/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./client/index.html', './client/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        tactical: {
          ink: '#002244',
          pitch: '#3f8f29',
          pitchDark: '#2d6d1e',
          bone: '#f4f7f5',
          mist: '#dbe3e2',
          line: '#a5acaf',
          ash: '#607487',
          ember: '#1b5e9b'
        }
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0, 34, 68, 0.05), 0 8px 24px rgba(0, 34, 68, 0.06)',
        glow: '0 6px 18px rgba(0, 34, 68, 0.12)'
      },
      borderRadius: {
        xl2: '1.25rem'
      },
      fontFamily: {
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
