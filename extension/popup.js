const DEFAULT_SETTINGS = {
  enabled: true,
  displayName: "",
};

const form = document.getElementById("settings-form");
const enabledInput = document.getElementById("enabled");
const displayNameInput = document.getElementById("display-name");
const status = document.getElementById("status");

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledInput.checked = Boolean(settings.enabled);
  displayNameInput.value = settings.displayName || "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const displayName = displayNameInput.value.trim().slice(0, 30);

  await chrome.storage.sync.set({
    enabled: enabledInput.checked,
    displayName,
  });

  status.textContent = "Saved.";
  window.setTimeout(() => {
    status.textContent = "";
  }, 1500);
});

loadSettings().catch((error) => {
  status.textContent = error.message;
});
