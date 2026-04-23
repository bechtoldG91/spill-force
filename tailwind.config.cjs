/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./client/index.html', './client/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        tactical: {
          ink: '#08161c',
          pitch: '#3f8f29',
          pitchDark: '#2c661b',
          bone: '#f3f1e8',
          mist: '#dfe5d8',
          line: '#c5ccbe',
          ash: '#69746d',
          ember: '#d7642e'
        }
      },
      boxShadow: {
        panel: '0 22px 60px rgba(8, 22, 28, 0.08)',
        glow: '0 18px 40px rgba(63, 143, 41, 0.18)'
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
