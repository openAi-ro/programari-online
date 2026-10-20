/**
 * Timeout pentru locație care pornește DOAR după ce permisiunea e acordată.
 * Timpul petrecut de utilizator în dialogul de permisiune nu se numără.
 * `granted` care nu se rezolvă niciodată = fără timer de siguranță (rămâne timeout-ul nativ).
 */
export function timeoutAfterGrant<T>(
  position: Promise<T>,
  granted: Promise<unknown>,
  ms: number,
  code = 'location_timeout'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      done = true;
      if (timer) clearTimeout(timer);
    };
    position.then(
      (v) => {
        if (done) return;
        finish();
        resolve(v);
      },
      (e) => {
        if (done) return;
        finish();
        reject(e);
      }
    );
    granted.then(
      () => {
        if (done || timer) return;
        timer = setTimeout(() => {
          if (done) return;
          finish();
          reject(new Error(code));
        }, ms);
      },
      () => {}
    );
  });
}

type PermissionStatusLike = {
  state: string;
  addEventListener?: (type: 'change', cb: () => void) => void;
  removeEventListener?: (type: 'change', cb: () => void) => void;
};

/**
 * Semnal „permisiunea de locație a fost acordată” pe web (Permissions API).
 * Se rezolvă imediat dacă e deja acordată sau când utilizatorul apasă „Allow”.
 */
export function grantSignal(query: (() => Promise<PermissionStatusLike>) | null): {
  granted: Promise<void>;
  dispose: () => void;
} {
  let dispose = () => {};
  const granted = new Promise<void>((resolve) => {
    if (!query) return; // fără Permissions API: rămâne doar timeout-ul nativ
    query().then(
      (st) => {
        if (st.state === 'granted') return resolve();
        const onChange = () => {
          if (st.state === 'granted') {
            st.removeEventListener?.('change', onChange);
            resolve();
          }
        };
        st.addEventListener?.('change', onChange);
        dispose = () => st.removeEventListener?.('change', onChange);
      },
      () => {}
    );
  });
  return { granted, dispose: () => dispose() };
}
