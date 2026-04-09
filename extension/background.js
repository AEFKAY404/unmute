const DEFAULT_SETTINGS = {
  enabled: true,
  displayName: "",
};

chrome.runtime.onInstalled.addListener(async () => {
  const syncSettings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({
    enabled: syncSettings.enabled,
    displayName: syncSettings.displayName,
  });

  const localState = await chrome.storage.local.get(["sessionId"]);
  if (!localState.sessionId) {
    await chrome.storage.local.set({ sessionId: crypto.randomUUID() });
  }
});
