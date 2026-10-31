import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { ReactNode } from 'react';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: ReactNode }) {
  // SSR: meta per rută (generateMetadata) ajung în headNodes.
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html lang="ro" translate="no" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        {/* Traducere proprie RO/EN (lib/i18n): oprim traducerea automată a browserului. */}
        <meta name="google" content="notranslate" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        {headNodes}

        {/* PWA / installable */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#0f766e" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Programări" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

        {/*
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native.
          However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
        */}
        <ScrollViewStyleReset />

        {/* Fundalul nu trebuie să clipească între scheme, înainte ca React să monteze tema. */}
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />

        {/* Register SW only on https or localhost — safe for Firebase Hosting / local web. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var h=location.hostname;var ok=location.protocol==='https:'||h==='localhost'||h==='127.0.0.1';if(!ok||!('serviceWorker' in navigator))return;window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(function(r){r.update();}).catch(function(){});});}catch(e){}})();`,
          }}
        />

        {/* Inspector de culori: se încarcă doar cu ?color-inspect=1 (sau steagul din localStorage) ori pe localhost. Pe producție, vizitatorii obișnuiți nu descarcă nimic și nu au scurtătura Alt+Shift+C. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var h=location.hostname;var dev=h==='localhost'||h==='127.0.0.1';var on=/[?&]color-inspect=1(&|$)/.test(location.search)||localStorage.getItem('promixt-color-inspect')==='1';if(!dev&&!on)return;var s=document.createElement('script');s.src='/color-inspector.js?v=20261014-drag-resize';s.defer=true;document.head.appendChild(s);}catch(e){}})();`,
          }}
        />
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}

// Keep in sync with palette.ink50 / palette.ink950 in constants/theme.ts
const responsiveBackground = `
body {
  background-color: #f5f8fb; /* palette.ink50 */
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #0c1222; /* palette.ink950 */
  }
}
/* Campurile isi deseneaza singure inelul de focus (accent), deci renuntam la conturul UA. */
input:focus,
textarea:focus {
  outline: none;
}
`;
