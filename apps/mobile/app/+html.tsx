import { ScrollViewStyleReset } from 'expo-router/html';
import type { ReactNode } from 'react';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="ro">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/*
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native.
          However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
        */}
        <ScrollViewStyleReset />

        {/* Fundalul nu trebuie să clipească între scheme, înainte ca React să monteze tema. */}
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// Keep in sync with palette.ink50 / palette.ink950 in constants/theme.ts
const responsiveBackground = `
body {
  background-color: #f6f8fc; /* palette.ink50 */
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #0b1120; /* palette.ink950 */
  }
}
/* Campurile isi deseneaza singure inelul de focus (accent), deci renuntam la conturul UA. */
input:focus,
textarea:focus {
  outline: none;
}
`;
