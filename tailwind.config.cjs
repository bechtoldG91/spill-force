/** @type {import('tailwindcss').Config} */
module.exports = {
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
        panel: '0 22px 60px rgba(0, 34, 68, 0.08)',
        glow: '0 18px 40px rgba(0, 34, 68, 0.14), 0 10px 24px rgba(63, 143, 41, 0.12)'
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
