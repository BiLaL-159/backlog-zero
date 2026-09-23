// OAuth token handling. The sign-in MUST run in an extension context
// (service worker or popup) — a content script cannot call chrome.identity.

// Ask Chrome for an access token for the signed-in Google account.
// interactive:true shows the consent/account-picker UI the first time;
// after that Chrome returns a cached token silently.
export function getToken({ interactive = true } = {}) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "No token returned"));
        return;
      }
      resolve(token);
    });
  });
}

// Drop a token Chrome has cached (e.g. after a 401) so the next getToken()
// fetches a fresh one instead of handing back the dead one.
export function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}
